import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import type { ServerResponse, OutgoingHttpHeaders } from 'node:http';
import { database, type Database, type Query, type Row } from './db.js';
import { mutation, cardInput, activityInput, resetInput, answerPatch, CARD_PHASE, CURRENT_FLOW_VERSION, FIRST_IDEA_LIMIT, TWISTS, revisedFlow, requiredFlow, roundMinutes, isWriteupKind, type Session, type Participant, type Snapshot, type Card } from './model.js';
import { hostTelemetry } from './activity.js';
import { purgeExpiredData } from './retention.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = (statusCode: number, message: string) => { throw Object.assign(new Error(message), { statusCode }); };
const idParam = (req: FastifyRequest) => z.uuid().parse((req.params as any).id);
const personView = (r: Row): Participant => ({ id:r.id, revision:r.revision, consentVersion:r.consent_version, writeupVersion:r.writeup_version, data:r.data });
const cardView = (r: Row): Card => ({id:r.id,kind:r.kind,title:r.title,description:r.description,mine:r.mine,assetId:r.asset_id,hidden:r.hidden,updatedAt:new Date(r.updated_at).toISOString(),twist:r.twist});
const canShare = (p:Row,writeup:boolean,version:number) => writeup
  ? p.data.writeup===true && p.writeup_version===version
  : p.data.share===true && p.consent_version===version;
const workshopRun = (s:Row) => requiredFlow({flowVersion:s.flow_version});
function liveWallKind(s:Row){
  if(s.stage_view!=='overview'&&s.stage_view!=='gallery')return null;
  if(s.phase===2&&!s.ends_at&&s.remaining_ms==null)return 'build';
  if(s.phase===4)return 'concept';
  return null;
}
function onWorkshopWall(kind:string,s:Row){
  if(s.gallery_paused||s.closed)return false;
  const liveKind=liveWallKind(s);
  if(liveKind)return kind===liveKind;
  if(kind==='concept')return s.phase===5&&['comparison','gallery'].includes(s.stage_view);
  if(s.phase<2)return false;
  return s.stage_view==='first-ideas'||s.stage_view==='comparison'||s.stage_view==='gallery'&&s.first_revealed;
}
type Credential = { session_id: string; participant_id: string | null; role: string; expires_at: Date };
type Options = { db?: Database; databaseUrl?: string; dataDir: string; adminToken: string; origins: string[]; logger?: boolean };

export async function createApp(opts: Options) {
  const sessionView = (r: Row): Session => ({
    id:r.id, code:r.code, title:r.title, run:r.run, phase:r.phase, revision:r.revision, closed:r.closed, galleryPaused:r.gallery_paused,
    stageView:r.stage_view, endsAt:r.ends_at ? new Date(r.ends_at).toISOString() : null,
    remainingMs:r.remaining_ms == null ? null : Number(r.remaining_ms), serverTime:new Date().toISOString(),
    flowVersion:r.flow_version, firstRevealed:r.first_revealed, exchange:r.exchange, reusable:r.reusable
  });
  const db = opts.db || await database(opts.databaseUrl, join(opts.dataDir, 'database'));
  const photos = join(opts.dataDir, 'photos'); await mkdir(photos, { recursive:true });
  const app = Fastify({ bodyLimit: 16384, logger: opts.logger ? { redact: ['req.headers.authorization'], serializers: { req: r => ({ method:r.method, url:r.url?.split('?')[0] }) } } : false, requestTimeout: 30000 });
  await app.register(cors, { origin:opts.origins, methods:['GET','POST','PATCH','DELETE'], allowedHeaders:['Content-Type','Authorization'] });
  await app.register(multipart, { limits: { fileSize:2*1024*1024, files:1, fields:0 } });
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff'); return payload; });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & {statusCode?:number; code?:string};
    const status = error instanceof ZodError ? 400 : e.statusCode || 500;
    if(status >= 500) app.log.error(error);
    reply.code(status).send({ error: error instanceof ZodError ? 'Please check the submitted values.' : status >= 500 ? 'The server could not save this. Please try again.' : e.message });
  });
  const streams = new Set<{session:string; role:string; participant:string|null; res:ServerResponse}>();
  function notify(session: string, type = 'changed') {
    for (const s of streams) {
      if(s.session!==session || type==='telemetry'&&s.role!=='host' || type==='changed'&&s.role==='participant')continue;
      if(s.res.destroyed||s.res.writableEnded){streams.delete(s);continue;}
      if(s.res.writableLength > 65536) { s.res.destroy(); continue; }
      s.res.write(`event: ${type}\ndata: {}\n\n`);
    }
  }
  const buckets = new Map<string,{n:number; expires:number}>();
  function limit(key:string, max:number) { const now=Date.now(); let b=buckets.get(key); if(!b || b.expires<now) {b={n:0,expires:now+60000};buckets.set(key,b);} if(++b.n>max) fail(429,'Please wait a moment and try again.'); }
  const clean = setInterval(() => { for(const [k,b] of buckets) if(b.expires<Date.now()) buckets.delete(k); },60000); clean.unref();
  async function auth(req:FastifyRequest, session:string, roles:string[] = ['participant','host','stage']):Promise<Credential> {
    const token=req.headers.authorization?.replace(/^Bearer /,'') || '';
    const [c]=await db.query('SELECT c.*,p.run AS participant_run,s.run AS session_run FROM credentials c JOIN sessions s ON s.id=c.session_id LEFT JOIN participants p ON p.id=c.participant_id WHERE c.hash=$1 AND c.session_id=$2 AND c.expires_at>now()',[hash(token),session]);
    if(!c || !roles.includes(c.role)) fail(401,'This access link has expired or does not have permission.');
    if(c.role==='participant' && c.participant_run!==c.session_run) fail(410,'Your facilitator reset the session. Refresh this page to join again.');
    if(c.role==='participant' && !req.url.split('?')[0].endsWith('/telemetry')) await db.query("UPDATE participants SET last_seen_at=now() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at<now()-interval '20 seconds')",[c.participant_id]);
    limit(hash(token),c.role==='participant'?300:1500); return c as Credential;
  }
  async function session(q:Query,id:string) { const [s]=await q('SELECT * FROM sessions WHERE id=$1',[id]); if(!s) fail(404,'Session not found.'); return s; }
  async function activePerson(q:Query,id:string,participant:string){
    const [s]=await q('SELECT * FROM sessions WHERE id=$1 FOR SHARE',[id]);
    const [p]=await q('SELECT * FROM participants WHERE id=$1 AND session_id=$2 FOR UPDATE',[participant,id]);
    if(!p || p.run!==s.run) fail(410,'Your facilitator reset the session. Refresh this page to join again.');
    return {s,p};
  }
  async function writeOp<T>(q:Query, owner:string, op:string, body:unknown, fn:()=>Promise<T>):Promise<T> {
    const digest=hash(JSON.stringify(body));
    const [old]=await q('SELECT * FROM operations WHERE owner=$1 AND operation_id=$2',[owner,op]);
    if(old) { if(old.digest!==digest) fail(409,'This operation was already used with different values.'); return old.result; }
    const result=await fn();
    await q('INSERT INTO operations(owner,operation_id,digest,result) VALUES($1,$2,$3,$4)',[owner,op,digest,JSON.stringify(result)]); return result;
  }
  app.get('/health', async()=>{ await db.query('SELECT 1'); return {ok:true, service:'the-lab'}; });
  app.post('/v1/sessions',async(req,reply)=>{
    const token=req.headers.authorization?.replace(/^Bearer /,'') || '';
    if(!opts.adminToken || !timingSafeEqual(Buffer.from(hash(token)),Buffer.from(hash(opts.adminToken)))) fail(401,'Not authorized.');
    const b=z.object({title:z.string().trim().min(1).max(120),code:z.string().regex(/^[A-Z2-9]{6,12}$/).optional(),flowVersion:z.union([z.literal(1),z.literal(2),z.literal(CURRENT_FLOW_VERSION)]).default(CURRENT_FLOW_VERSION),reusable:z.boolean().default(false)}).parse(req.body);
    const id=randomUUID(), code=b.code || randomBytes(5).toString('hex').toUpperCase().replace(/[01]/g,'A');
    const hostToken=randomBytes(32).toString('base64url'),stageToken=randomBytes(32).toString('base64url');
    await db.transaction(async q=>{
      await q('INSERT INTO sessions(id,code,title,flow_version,reusable) VALUES($1,$2,$3,$4,$5)',[id,code,b.title,b.flowVersion,b.reusable]);
      for(const [role,t] of [['host',hostToken],['stage',stageToken]]) await q(`
        INSERT INTO credentials(hash,session_id,role,expires_at)
        VALUES($1,$2,$3,CASE WHEN $4::boolean AND $3='stage' THEN 'infinity'::timestamptz
          WHEN $4::boolean THEN now()+interval '1 year' ELSE now()+interval '30 days' END)`,[hash(t),id,role,b.reusable]);
    }); reply.code(201); return {id,code,title:b.title,reusable:b.reusable,hostToken,stageToken};
  });
  app.post('/v1/join',async(req)=>{
    // A venue NAT can carry every participant. Admission budget accommodates the whole room.
    limit('join:'+req.ip,1500);
    const b=answerPatch.pick({aiTool:true,share:true,writeup:true,before:true}).extend({code:z.string().trim().min(6).max(12),joinKey:z.uuid()}).strict().parse(req.body);
    const joined=await db.transaction(async q=>{
      const [s]=await q('SELECT * FROM sessions WHERE code=$1 FOR SHARE',[b.code.toUpperCase()]);
      if(!s || s.closed) fail(404,'That session is unavailable. Check the code with your facilitator.');
      const j=hash(s.run===0?s.id+b.joinKey:s.id+':'+s.run+':'+b.joinKey), token=createHmac('sha256',opts.adminToken).update(j).digest('base64url');
      if(workshopRun(s)&&(!b.aiTool||b.share===undefined||b.writeup===undefined))fail(400,'Choose your AI app and join again from the workshop opening screen.');
      const data={share:b.share??false,writeup:s.flow_version>=2?b.writeup??false:undefined,aiTool:b.aiTool,before:b.before,progress:0,twist:TWISTS[Math.floor(Math.random()*TWISTS.length)]};
      const [p]=await q("INSERT INTO participants(id,session_id,join_hash,data,run,retain_until) VALUES($1,$2,$3,$4,$5,now()+interval '90 days') ON CONFLICT(join_hash) DO UPDATE SET join_hash=EXCLUDED.join_hash RETURNING *",[randomUUID(),s.id,j,JSON.stringify(data),s.run]);
      await q("INSERT INTO credentials(hash,session_id,participant_id,role,expires_at) VALUES($1,$2,$3,'participant',now()+interval '2 days') ON CONFLICT(hash) DO NOTHING",[hash(token),s.id,p.id]);
      return {session:sessionView(s),participant:personView(p),token};
    });notify(joined.session.id);return joined;
  });
  app.get('/v1/sessions/:id',async req=>{const id=idParam(req),c=await auth(req,id);return db.transaction(async q=>{if(c.participant_id){const {s,p}=await activePerson(q,id,c.participant_id);return {session:sessionView(s),participant:personView(p)};}return {session:sessionView(await session(q,id)),participant:null};});});
  app.post('/v1/sessions/:id/telemetry',async req=>{
    const id=idParam(req),c=await auth(req,id,['participant']),body=activityInput.parse(req.body);
    await db.transaction(async q=>{
      await activePerson(q,id,c.participant_id!);
      await q(`UPDATE participants SET current_step=$1,
      step_started_at=CASE WHEN current_step IS DISTINCT FROM $1 THEN now() ELSE coalesce(step_started_at,now()) END,
      last_seen_at=now(),telemetry_at=now(),
      pending_since_at=CASE WHEN $2::integer>0 THEN coalesce(pending_since_at,now()) ELSE NULL END,
      client_status=$3 WHERE id=$4 AND session_id=$5`,[body.step,body.pendingSaves,JSON.stringify(body),c.participant_id,id]);
    });notify(id,'telemetry');return {ok:true};
  });
  app.patch('/v1/sessions/:id/me',async req=>{
    const id=idParam(req), c=await auth(req,id,['participant']),b=mutation.parse(req.body);
    const result=await db.transaction(async q=>{
      const {s,p}=await activePerson(q,id,c.participant_id!);
      return writeOp(q,p.id,b.operationId,b,async()=>{
        const withdrawing=Object.keys(b.patch).length>0 && Object.keys(b.patch).every(key=>
          key==='share' ? b.patch.share===false : key==='writeup' && b.patch.writeup===false);
        if(s.closed && !withdrawing) fail(409,'The session has closed. Your draft is still on this phone.');
        if(p.revision!==b.expectedRevision) fail(409,'Your answers changed in another tab. Reload before continuing.');
        const required=workshopRun(s);
        if(required&&(b.patch.share===true||b.patch.writeup===true))fail(403,'Sharing choices are recorded at join.');
        if(b.patch.writeup===true && s.flow_version!==2) fail(403,'Public write-up sharing is unavailable.');
        for(const [k,v] of Object.entries(b.patch)) {const phase=k==='before'||k==='handoff'?0:k==='after'||k==='biggestChange'?5:['works','feel','instructionEase','ideaLiking'].includes(k)?2:k==='twist'?1:k==='progress'?CARD_PHASE[v as number]:-1;if(phase>s.phase) fail(403,'Your facilitator has not opened this phase yet.');}
        const data={...p.data,...b.patch};
        if(required&&(b.patch.handoff&&b.patch.handoff!=='no-plan'||(b.patch.progress??0)>=4)){
          const cards=await q('SELECT kind FROM submissions WHERE participant_id=$1',[p.id]);
          const kinds=new Set(cards.map(row=>row.kind)),progress=b.patch.progress??0;
          if(!data.handoff||data.handoff!=='no-plan'&&!kinds.has('first-idea'))fail(400,'Save your first AI idea and image before continuing.');
          if(progress>=6&&(!kinds.has('build')||!data.instructionEase||!data.ideaLiking))fail(400,'Save your build photo and answer both reflection questions.');
          if(progress>=8&&!kinds.has('concept'))fail(400,'Save your complete concept card before continuing.');
          if(progress===9&&!data.biggestChange)fail(400,'Answer the closing question before finishing.');
        }
        const roomChanged=b.patch.share!==undefined && !!p.data.share!==b.patch.share;
        const writeupChanged=b.patch.writeup!==undefined && !!p.data.writeup!==b.patch.writeup;
        const [out]=await q('UPDATE participants SET data=$1,revision=revision+1,consent_version=consent_version+$2,writeup_version=writeup_version+$3 WHERE id=$4 RETURNING *',[JSON.stringify(data),Number(roomChanged),Number(writeupChanged),p.id]);
        if(!required&&roomChanged&&!data.share) await q("DELETE FROM submissions WHERE participant_id=$1 AND kind NOT IN ('writeup-build','writeup-concept')",[p.id]);
        if(!required&&writeupChanged&&!data.writeup) await q("DELETE FROM submissions WHERE participant_id=$1 AND kind IN ('writeup-build','writeup-concept')",[p.id]);
        return personView(out);
      });
    });notify(id);return result;
  });
  let processingPhotos=0;
  app.post('/v1/sessions/:id/photos',async req=>{
    const id=idParam(req),c=await auth(req,id,['participant']);limit('photo:'+c.participant_id,12);
    const {consentVersion:version,purpose}=z.object({consentVersion:z.coerce.number().int().nonnegative(),purpose:z.enum(['room','writeup','workshop']).default('room')}).parse(req.query);
    const writeup=purpose==='writeup';
    const canUpload=(s:Row,p:Row)=>workshopRun(s)?purpose==='workshop'&&version===0:purpose!=='workshop'&&canShare(p,writeup,version);
    const {s,p}=await db.transaction(q=>activePerson(q,id,c.participant_id!));
    if(!canUpload(s,p)) fail(403,'This photo upload is unavailable.');
    if(s.closed)fail(409,'The session has closed.');
    const file=await req.file();if(!file) fail(400,'Choose a photo.');
    if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file!.mimetype)) fail(400,'Choose a JPEG, PNG, or WebP photo.');
    const buffer=await file!.toBuffer();
    if(processingPhotos>=6)fail(503,'Photo processing is busy. Your photo will retry shortly.');
    processingPhotos++;
    const asset=randomUUID(),path=join(photos,asset+'.jpg');
    try {
      const image=sharp(buffer,{limitInputPixels:40_000_000,failOn:'error'}).rotate();
      const full=await image.clone().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
      const thumb=await image.resize(420,420,{fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();
      await writeFile(path+'.tmp',full);await rename(path+'.tmp',path);await writeFile(join(photos,asset+'-thumb.jpg'),thumb);
      await db.transaction(async q=>{
        const {s,p:current}=await activePerson(q,id,c.participant_id!);
        if(!canUpload(s,current)) fail(403,'This photo upload is unavailable.');
        if(s.closed) fail(409,'The session has closed.');
        const [count]=await q('SELECT count(*) AS n FROM assets WHERE participant_id=$1',[c.participant_id]);if(Number(count.n)>=12) fail(409,'Photo limit reached for this session.');
        await q('INSERT INTO assets(id,session_id,participant_id,consent_version,purpose) VALUES($1,$2,$3,$4,$5)',[asset,id,c.participant_id,version,purpose]);
      }); return {assetId:asset};
    } catch(e) {await Promise.all([unlink(path).catch(()=>{}),unlink(path+'.tmp').catch(()=>{}),unlink(join(photos,asset+'-thumb.jpg')).catch(()=>{})]); if((e as any).statusCode) throw e;fail(400,'This photo could not be opened. Try taking a new photo.');}finally{processingPhotos--;}
  });
  app.post('/v1/sessions/:id/cards',async req=>{
    const id=idParam(req),c=await auth(req,id,['participant']),b=cardInput.parse(req.body);
    const result=await db.transaction(async q=>{
      const {s,p}=await activePerson(q,id,c.participant_id!);
      return writeOp(q,p.id,b.operationId,b,async()=>{
        const required=workshopRun(s),writeup=isWriteupKind(b.kind),firstIdea=b.kind==='first-idea';
        const opensAt=required&&firstIdea?0:b.kind==='concept'||b.kind==='writeup-concept'?4:2;
        if(s.closed||s.phase<opensAt||writeup&&s.flow_version!==2||firstIdea&&s.flow_version<2)fail(403,'This phase is not open.');
        if(p.revision!==b.expectedRevision) fail(409,'Your answers changed. Reload before submitting.');
        if(required?b.consentVersion!==0:!canShare(p,writeup,b.consentVersion))fail(403,'This submission is unavailable.');
        if(b.kind==='concept' && (!b.title || !b.description)) fail(400,'Add a title and a short description.');
        if(required&&b.kind==='concept'&&!b.mine)fail(400,'Add a short note on what changed.');
        if((required||b.kind==='build'||writeup)&&!b.assetId)fail(400,'Add a photo first.');
        if(firstIdea&&(!b.title||b.title.length>FIRST_IDEA_LIMIT||b.description||b.mine||!required&&b.assetId))fail(400,'Enter a short name for the AI’s first idea.');
        if(writeup&&(b.title||b.description||b.mine)) fail(400,'Only the selected photo can be submitted for the write-up.');
        if(b.assetId) {
          const [a]=await q(`SELECT id FROM assets WHERE id=$1 AND participant_id=$2 AND session_id=$3 AND consent_version=$4 AND purpose=$5
            AND (purpose<>'workshop' OR NOT EXISTS (SELECT 1 FROM submissions WHERE asset_id=$1 AND kind<>$6))`,
          [b.assetId,p.id,id,b.consentVersion,required?'workshop':writeup?'writeup':'room',b.kind]);
          if(!a)fail(403,'This photo is unavailable. Upload it again.');
        }
        const [card]=await q('INSERT INTO submissions(id,session_id,participant_id,kind,title,description,mine,asset_id,consent_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(participant_id,kind) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,mine=EXCLUDED.mine,asset_id=EXCLUDED.asset_id,consent_version=EXCLUDED.consent_version,updated_at=now() RETURNING id',[randomUUID(),id,p.id,b.kind,b.title,b.description,b.mine,b.assetId,b.consentVersion]);return {id:card.id};
      });
    });notify(id);return result;
  });
  app.get('/v1/sessions/:id/assets/:asset',async(req,reply)=>{
    const id=idParam(req),c=await auth(req,id),asset=z.uuid().parse((req.params as any).asset);
    const [a]=await db.query(`SELECT a.*,p.data,p.consent_version AS room_version,p.writeup_version,
      s.phase,s.stage_view,s.gallery_paused,s.closed,s.first_revealed,s.ends_at,s.remaining_ms
      FROM assets a JOIN participants p ON p.id=a.participant_id JOIN sessions s ON s.id=a.session_id
      WHERE a.id=$1 AND a.session_id=$2 AND p.run=s.run`,[asset,id]);
    if(!a) fail(404,'Photo unavailable.');
    if(c.role==='participant' && a.participant_id!==c.participant_id) fail(403,'Photo unavailable.');
    if(c.role!=='participant'&&a.purpose==='workshop'){
      const [card]=await db.query('SELECT kind,hidden FROM submissions WHERE asset_id=$1 AND participant_id=$2',[asset,a.participant_id]);
      const publication=(req.query as any).publication==='1';
      const published=a.data.writeup===true&&!a.publication_withdrawn&&!card?.hidden;
      const available=c.role==='stage'
        ? !publication&&a.data.share===true&&!card?.hidden&&card&&onWorkshopWall(card.kind,a)
        : publication?published:a.data.share===true||published;
      if(!card||!available)fail(404,'Photo unavailable.');
    }else if(c.role!=='participant') {
      const writeup=a.purpose==='writeup',version=writeup?a.writeup_version:a.room_version;
      if(writeup&&c.role!=='host') fail(404,'Photo unavailable.');
      const [card]=await db.query('SELECT id FROM submissions WHERE asset_id=$1 AND hidden=false AND consent_version=$2',[asset,version]);
      if(!canShare({...a,consent_version:a.room_version},writeup,version) || !card) fail(404,'Photo unavailable.');
    }
    const path=join(photos,asset+((req.query as any).full==='1'?'':'-thumb')+'.jpg');await stat(path);
    reply.type('image/jpeg');return reply.send(createReadStream(path));
  });
  async function snapshot(id:string,host:boolean):Promise<Snapshot> {
    return db.transaction(async q=>{
      const [s]=await q('SELECT * FROM sessions WHERE id=$1 FOR SHARE',[id]);if(!s)fail(404,'Session not found.');
      const people=await q('SELECT * FROM participants WHERE session_id=$1 AND run=$2 ORDER BY created_at,id',[id,s.run]);
      const before=[0,0,0],after=[0,0,0],transitions=[[0,0,0],[0,0,0],[0,0,0]],progress=Array(10).fill(0);
      const works:Record<string,number>={},feel:Record<string,number>={},instructionEase:Record<string,number>={},ideaLiking:Record<string,number>={},biggestChange:Record<string,number>={};
      let paired=0,instructions=0,noPlan=0;
      for(const {data:d} of people) {
        if(d.before!=null) before[d.before]++;
        if(d.after!=null) after[d.after]++;
        if(d.before!=null && d.after!=null) {paired++;transitions[d.before][d.after]++;}
        progress[d.progress||0]++;
        if(d.works) works[d.works]=(works[d.works]||0)+1;
        if(d.feel) feel[d.feel]=(feel[d.feel]||0)+1;
        if(d.instructionEase) instructionEase[d.instructionEase]=(instructionEase[d.instructionEase]||0)+1;
        if(d.ideaLiking) ideaLiking[d.ideaLiking]=(ideaLiking[d.ideaLiking]||0)+1;
        if(d.biggestChange) biggestChange[d.biggestChange]=(biggestChange[d.biggestChange]||0)+1;
        if(d.handoff==='ready')instructions++;
        if(d.handoff==='no-plan'||d.handoff==='idea-only')noPlan++;
      }
      const showFirst=s.phase>=2&&s.stage_view==='first-ideas';
      const compare=s.phase===5&&s.stage_view==='comparison';
      const required=workshopRun(s);
      const uploadKind=liveWallKind(s);
      const collectingForStage=!s.gallery_paused&&!s.closed&&(uploadKind||['first-ideas','comparison','gallery'].includes(s.stage_view));
      const collected=required&&(host||collectingForStage)?await q(`
        SELECT sub.*,p.data,p.created_at AS joined_at,a.publication_withdrawn
        FROM submissions sub JOIN participants p ON p.id=sub.participant_id JOIN assets a ON a.id=sub.asset_id
        WHERE sub.session_id=$1 AND p.run=$2 AND a.purpose='workshop'
          AND ($3::boolean OR (p.data->>'share'='true' AND sub.hidden=false AND ($4::text IS NULL OR sub.kind=$4)))
        ORDER BY sub.updated_at DESC`,[id,s.run,host,uploadKind]):[];
      const rows=required?collected.filter(row=>row.data.share===true&&(host||onWorkshopWall(row.kind,s))):(!s.gallery_paused || host)?await q(`
        SELECT s.*,p.data->>'twist' AS twist FROM submissions s JOIN participants p ON p.id=s.participant_id
        WHERE s.session_id=$1 AND p.run=$2 AND (
          (s.kind NOT IN ('writeup-build','writeup-concept') AND p.data->>'share'='true' AND s.consent_version=p.consent_version
            AND ($3::boolean OR (s.hidden=false AND (s.kind<>'first-idea' OR $4::boolean))))
          OR ($3::boolean AND s.kind IN ('writeup-build','writeup-concept') AND p.data->>'writeup'='true' AND s.consent_version=p.writeup_version)
        ) ORDER BY s.updated_at DESC`,[id,s.run,host,showFirst||compare]):[];
      const concepts=rows.filter(row=>row.kind==='concept');
      const gallery=rows.filter(row=>row.kind==='build'||row.kind==='concept').map(cardView);
      const first=rows.filter(row=>row.kind==='first-idea');
      const finals=new Map(concepts.filter(row=>!row.hidden).map(row=>[row.participant_id,row]));
      const pairs=(host||compare)?first.flatMap(row=>{
        const final=finals.get(row.participant_id);
        return !row.hidden&&final?[{id:row.id,first:row.title,final:final.title,description:final.description}]:[];
      }):[];
      const ideas:Snapshot['ideas']=host||showFirst||compare?{first:first.map(cardView),final:compare?concepts.map(cardView):[],pairs}:undefined;
      if(required&&ideas&&(showFirst||compare)){
        const originals=new Map(first.filter(row=>!row.hidden).map(row=>[row.participant_id,cardView(row)]));
        if(showFirst)ideas.firstBuilds=rows.filter(row=>row.kind==='build'&&!row.hidden).map(row=>({first:originals.get(row.participant_id),build:cardView(row)}));
        if(compare)ideas.comparisons=[...finals.values()].map(row=>({first:originals.get(row.participant_id),final:cardView(row)}));
      }
      const allConcepts=(required?collected:concepts).filter(row=>row.kind==='concept');
      const telemetry=host?hostTelemetry(people,s.phase,new Set([...streams].filter(c=>c.session===id&&c.role==='participant').map(c=>c.participant!)),new Set(allConcepts.map(c=>c.participant_id))):undefined;
      const publication=host?(required?collected.filter(row=>row.data.writeup===true&&!row.publication_withdrawn):rows.filter(row=>isWriteupKind(row.kind))).filter(row=>!row.hidden&&row.asset_id).map(row=>({
        assetId:row.asset_id,label:row.kind==='first-idea'?'Original AI idea':row.kind.endsWith('build')?'First build photo':'Concept image',
        consentedAt:new Date(required?row.joined_at:row.updated_at).toISOString()
      })):undefined;
      const collection=host&&required?{instructions,noPlan,firstIdeas:collected.filter(row=>row.kind==='first-idea').length,builds:collected.filter(row=>row.kind==='build').length,concepts:allConcepts.length}:undefined;
      return {session:sessionView(s),total:people.length,before,after,paired,transitions,works,feel,instructionEase,ideaLiking,biggestChange,progress,gallery,ideas,publication,collection,capturedAt:new Date().toISOString(),...(telemetry?{telemetry}:{})};
    });
  }
  app.get('/v1/sessions/:id/snapshot',async req=>{const id=idParam(req),c=await auth(req,id,['host','stage']);return snapshot(id,c.role==='host');});
  app.post('/v1/sessions/:id/reset',async req=>{
    const id=idParam(req);await auth(req,id,['host']);const b=resetInput.parse(req.body);let changed=false;
    const out=await db.transaction(async q=>{
      const [s]=await q('SELECT * FROM sessions WHERE id=$1 FOR UPDATE',[id]);
      return writeOp(q,'reset:'+id,b.operationId,b,async()=>{
        if(s.revision!==b.expectedRevision)fail(409,'The session changed. Close this confirmation and try again.');
        if(b.confirmation!==s.code)fail(400,'Type the room code exactly to confirm the reset.');
        const [count]=await q('SELECT count(*) AS n FROM participants WHERE session_id=$1 AND run=$2',[id,s.run]);
        const [next]=await q("UPDATE sessions SET run=run+1,revision=revision+1,phase=-1,closed=false,gallery_paused=false,stage_view='overview',ends_at=NULL,remaining_ms=NULL,flow_version=$2,exchange=false,first_revealed=false WHERE id=$1 RETURNING *",[id,CURRENT_FLOW_VERSION]);
        changed=true;return {session:sessionView(next),previous:sessionView(s),clearedParticipants:Number(count.n)};
      });
    });
    if(changed){notify(id,'reset');for(const client of streams)if(client.session===id&&client.role==='participant')client.res.end();}
    return out;
  });
  const controls=z.object({expectedRevision:z.number().int().nonnegative(),phase:z.number().int().min(-1).max(5).optional(),timer:z.enum(['pause','resume','extend','reset']).optional(),galleryPaused:z.boolean().optional(),stageView:z.enum(['overview','results','gallery','reflections','first-ideas','comparison','final-exchange']).optional(),exchange:z.literal(true).optional(),closed:z.boolean().optional()}).strict();
  app.patch('/v1/sessions/:id/control',async req=>{
    const id=idParam(req);await auth(req,id,['host']);const b=controls.parse(req.body);
    const out=await db.transaction(async q=>{
      const [s]=await q('SELECT * FROM sessions WHERE id=$1 FOR UPDATE',[id]);if(s.revision!==b.expectedRevision) fail(409,'The session changed. Refresh the controls.');
      const phase=b.phase??s.phase,phaseChanged=phase!==s.phase,now=Date.now();
      const revised=revisedFlow({flowVersion:s.flow_version});
      if(b.exchange&&(!revised||s.closed||phaseChanged||phase!==2||s.exchange||(!s.ends_at&&s.remaining_ms==null))) fail(409,'Start reflection before opening the neighbour exchange.');
      if(b.stageView==='first-ideas'&&(!revised||phase<2) || b.stageView==='comparison'&&(!revised||phase!==5) || b.stageView==='final-exchange'&&(!workshopRun(s)||phase!==5||s.closed)) fail(403,'This activity is not open yet.');
      const stageView=b.stageView??(b.closed||b.exchange?'overview':phaseChanged?(revised&&phase===5?'comparison':'overview'):s.stage_view);
      const minutes=roundMinutes({flowVersion:s.flow_version,phase,stageView});
      const exchange=phase===2&&(!!b.exchange||!phaseChanged&&s.exchange);
      const firstRevealed=s.first_revealed||b.stageView==='first-ideas';
      let ends=s.ends_at?new Date(s.ends_at).getTime():null,remaining=s.remaining_ms==null?null:Number(s.remaining_ms);
      if(phaseChanged) {
        // Give the room time to photograph the build before the host starts reflection.
        ends=minutes && phase!==2 ? now+minutes*60000 : null;
        remaining=null;
      }
      if(stageView!==s.stage_view&&(stageView==='final-exchange'||s.stage_view==='final-exchange'&&!phaseChanged)){
        ends=stageView==='final-exchange'?now+minutes!*60000:null;
        remaining=null;
      }
      if(b.timer==='pause' && ends!==null) {remaining=Math.max(0,ends-now);ends=null;}
      if(b.timer==='resume' && remaining!==null) {ends=now+remaining;remaining=null;}
      if(b.timer==='extend') {
        if(ends!==null) ends=Math.max(ends,now)+60000;
        else if(remaining!==null) remaining+=60000;
      }
      if((b.timer==='reset'||b.exchange) && minutes) {ends=now+minutes*60000;remaining=null;}
      const [r]=await q('UPDATE sessions SET phase=$1,ends_at=$2,remaining_ms=$3,gallery_paused=$4,stage_view=$5,closed=$6,exchange=$7,first_revealed=$8,revision=revision+1 WHERE id=$9 RETURNING *',[phase,ends?new Date(ends):null,remaining,b.galleryPaused??s.gallery_paused,stageView,b.closed??s.closed,exchange,firstRevealed,id]);return sessionView(r);
    });notify(id,'session');return out;
  });
  app.patch('/v1/sessions/:id/cards/:card',async req=>{const id=idParam(req);await auth(req,id,['host']);const b=z.object({hidden:z.boolean()}).strict().parse(req.body);const card=z.uuid().parse((req.params as any).card);await db.transaction(async q=>{const [s]=await q('SELECT run FROM sessions WHERE id=$1 FOR SHARE',[id]);const rows=await q('UPDATE submissions SET hidden=$1 WHERE id=$2 AND session_id=$3 AND participant_id IN (SELECT id FROM participants WHERE session_id=$3 AND run=$4) RETURNING id',[b.hidden,card,id,s.run]);if(!rows.length)fail(404,'This card is no longer in the current session.');});notify(id);return {ok:true};});
  app.delete('/v1/sessions/:id/publication/:asset',async req=>{
    const id=idParam(req),asset=z.uuid().parse((req.params as any).asset);
    await auth(req,id,['host']);
    await db.transaction(async q=>{
      const [s]=await q('SELECT run FROM sessions WHERE id=$1 FOR SHARE',[id]);
      await q(`DELETE FROM submissions WHERE session_id=$1 AND asset_id=$2 AND kind IN ('writeup-build','writeup-concept')
        AND participant_id IN (SELECT id FROM participants WHERE session_id=$1 AND run=$3)`,[id,asset,s.run]);
      await q(`UPDATE assets SET publication_withdrawn=true WHERE session_id=$1 AND id=$2 AND purpose='workshop'
        AND participant_id IN (SELECT id FROM participants WHERE session_id=$1 AND run=$3)`,[id,asset,s.run]);
    });
    notify(id);
    return {ok:true};
  });
  app.get('/v1/sessions/:id/export',async(req,reply)=>{const id=idParam(req);await auth(req,id,['host']);reply.header('Content-Disposition','attachment; filename="workshop-results.json"');const out=await snapshot(id,true);return {...out,answers:await db.query('SELECT data FROM participants WHERE session_id=$1 AND run=$2',[id,out.session.run])};});
  app.get('/v1/sessions/:id/events',async(req,reply)=>{
    const id=idParam(req),c=await auth(req,id);if(streams.size>=1200) fail(503,'Live updates are busy. Retrying shortly.');
    reply.hijack();const res=reply.raw;
    res.writeHead(200,{...reply.getHeaders(),'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'} as OutgoingHttpHeaders);
    res.write('event: session\ndata: {}\n\n');const client={session:id,role:c.role,participant:c.participant_id,res};streams.add(client);if(c.role==='participant')notify(id,'telemetry');
    const beat=setInterval(()=>{if(Date.now()>new Date(c.expires_at).getTime()) res.end();else res.write(': heartbeat\n\n');},15000);
    res.on('close',()=>{clearInterval(beat);streams.delete(client);if(c.role==='participant')notify(id,'telemetry');});
  });
  let purge:Promise<void>|undefined;
  const maintainRetention=()=>{
    purge ??= purgeExpiredData(db,photos).catch(error=>app.log.error(error,'Workshop retention cleanup failed')).finally(()=>{purge=undefined;});
    return purge;
  };
  const retentionTimer=setInterval(maintainRetention,15*60000);retentionTimer.unref();
  app.addHook('onReady',async()=>{await maintainRetention();});
  app.addHook('preClose',async()=>{clearInterval(retentionTimer);for(const s of streams)s.res.end();});
  app.addHook('onClose',async()=>{clearInterval(clean);await purge;await db.close();});
  return app;
}
