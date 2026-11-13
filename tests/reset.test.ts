import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {database,type Database} from '../server/db.js';

test('confirmed reset isolates the previous run, rejects stale writes, preserves room links, and is retry-safe',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bwt-reset-')),db=await database(undefined,join(dir,'database'));
  let holdAuth=false,release!:()=>void,entered!:()=>void;
  const blocked=new Promise<void>(r=>release=r),authEntered=new Promise<void>(r=>entered=r);
  const wrapped:Database={...db,query:async(sql,values)=>{const rows=await db.query(sql,values);if(holdAuth&&sql.startsWith('SELECT c.*')&&rows[0]?.role==='participant'){holdAuth=false;entered();await blocked;}return rows;}};
  const app=await createApp({db:wrapped,dataDir:dir,adminToken:'test-admin',origins:[]});
  const call=async(method:any,url:string,token='',payload?:any)=>{const r=await app.inject({method,url,headers:token?{authorization:'Bearer '+token}:{},payload});return {status:r.statusCode,data:r.json()};};
  try{
    const s=(await call('POST','/v1/sessions','test-admin',{title:'Reset rehearsal',flowVersion:2})).data,root='/v1/sessions/'+s.id,joinKey=randomUUID();
    const p=(await call('POST','/v1/join','',{code:s.code,joinKey})).data;
    const other=(await call('POST','/v1/sessions','test-admin',{title:'Other room',flowVersion:2})).data;
    await call('POST','/v1/join','',{code:other.code,joinKey:randomUUID()});
    await call('PATCH',root+'/control',s.hostToken,{expectedRevision:0,phase:5});
    const answer={operationId:randomUUID(),expectedRevision:0,patch:{before:1,after:2,aiTool:'Gemini',progress:9,share:true,works:'Yes',feel:'Mixed'}};
    assert.equal((await call('PATCH',root+'/me',p.token,answer)).status,200);
    const image=await sharp({create:{width:24,height:24,channels:3,background:'#2151c6'}}).jpeg().toBuffer(),boundary='reset-photo';
    const photo=await app.inject({method:'POST',url:root+'/photos?consentVersion=1',headers:{authorization:'Bearer '+p.token,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),image,Buffer.from(`\r\n--${boundary}--\r\n`)])});
    assert.equal(photo.statusCode,200);const {assetId}=photo.json();
    const card={operationId:randomUUID(),expectedRevision:1,consentVersion:1,kind:'concept',title:'Old idea',description:'Old description',mine:'Old decision',assetId};
    assert.equal((await call('POST',root+'/cards',p.token,card)).status,200);
    await call('POST',root+'/telemetry',p.token,{step:9,visibility:'visible',pendingSaves:2,syncStatus:'queued',waitingForPhase:null,photos:{pile:true,build:true,concept:true},handedOff:true,cardReady:true});
    await call('PATCH',root+'/control',s.hostToken,{expectedRevision:1,phase:3,galleryPaused:true,stageView:'gallery'});
    await call('PATCH',root+'/control',s.hostToken,{expectedRevision:2,timer:'pause',closed:true});
    const reset={operationId:randomUUID(),expectedRevision:3,confirmation:s.code};
    assert.equal((await call('POST',root+'/reset',s.stageToken,reset)).status,401);
    assert.equal((await call('POST',root+'/reset',p.token,reset)).status,401);
    assert.equal((await call('POST',root+'/reset',other.hostToken,reset)).status,401);
    assert.equal((await call('POST',root+'/reset',s.hostToken,{...reset,confirmation:'WRONGCODE'})).status,400);
    assert.equal((await call('POST',root+'/reset',s.hostToken,{...reset,expectedRevision:0})).status,409);
    assert.equal((await call('GET',root+'/snapshot',s.hostToken)).data.total,1,'failed confirmations do not change the room');
    // Auth starts in the old run, then reset commits before the survey transaction starts.
    holdAuth=true;const staleWrite=call('PATCH',root+'/me',p.token,{operationId:randomUUID(),expectedRevision:1,patch:{aiTool:'Claude'}});await authEntered;
    const result=await call('POST',root+'/reset',s.hostToken,reset);assert.equal(result.status,200);release();assert.equal((await staleWrite).status,410);
    assert.equal(result.data.session.run,1);assert.equal(result.data.clearedParticipants,1);
    const fresh=(await call('GET',root+'/snapshot',s.stageToken)).data;
    assert.equal(fresh.session.code,s.code);assert.equal(fresh.session.phase,-1);assert.equal(fresh.session.closed,false);assert.equal(fresh.session.stageView,'overview');assert.equal(fresh.session.galleryPaused,false);assert.equal(fresh.session.endsAt,null);assert.equal(fresh.session.remainingMs,null);
    assert.equal(fresh.total,0);assert.equal(fresh.paired,0);assert.deepEqual(fresh.before,[0,0,0]);assert.deepEqual(fresh.after,[0,0,0]);assert.deepEqual(fresh.gallery,[]);assert.deepEqual(fresh.works,{});assert.deepEqual(fresh.feel,{});assert.ok(fresh.progress.every((n:number)=>n===0));
    const host=(await call('GET',root+'/snapshot',s.hostToken)).data;assert.equal(host.telemetry.participants.length,0);assert.equal(host.telemetry.connected,0);assert.equal(host.telemetry.waiting,0);assert.equal(host.telemetry.finished,0);
    assert.equal((await call('GET',root,p.token)).status,410);assert.equal((await call('PATCH',root+'/me',p.token,answer)).status,410,'old idempotency records cannot repopulate a reset');assert.equal((await call('POST',root+'/cards',p.token,card)).status,410);
    assert.equal((await app.inject({method:'GET',url:root+'/assets/'+assetId,headers:{authorization:'Bearer '+s.stageToken}})).statusCode,404);
    assert.equal((await call('GET',root+'/export',s.hostToken)).data.answers.length,0);
    const rejoined=(await call('POST','/v1/join','',{code:s.code,joinKey,aiTool:'Claude',share:false,writeup:false})).data;
    assert.notEqual(rejoined.token,p.token);assert.notEqual(rejoined.participant.id,p.participant.id);assert.equal(rejoined.participant.data.progress,0);assert.equal(rejoined.participant.data.share,false);assert.equal(rejoined.participant.data.aiTool,'Claude');assert.equal(rejoined.session.flowVersion,4);assert.equal(rejoined.participant.data.before,undefined);
    assert.deepEqual((await call('POST',root+'/reset',s.hostToken,reset)).data,result.data,'retry returns the original acknowledgement');assert.equal((await call('GET',root+'/snapshot',s.hostToken)).data.total,1,'retry must not reset a second time');
    assert.equal((await call('GET','/v1/sessions/'+other.id+'/snapshot',other.hostToken)).data.total,1);
    assert.equal((await db.query('SELECT data FROM participants WHERE id=$1 AND run=0',[p.participant.id]))[0].data.aiTool,'Gemini');await stat(join(dir,'photos',assetId+'.jpg'));
  }finally{release?.();await app.close();await rm(dir,{recursive:true,force:true});}
});
