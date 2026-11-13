import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createApp} from '../server/app.js';
import {database} from '../server/db.js';
import {staffRoute,staffUrl} from '../src/staff-routes.js';

test('short staff routes round-trip credentials and accept older hash links',()=>{
  const base='https://brick.example/project/',id=randomUUID(),access='example-access';
  for(const role of ['host','stage'] as const){
    const full=new URL(staffUrl(base,role,id,access));
    assert.equal(full.search,'');
    assert.deepEqual(staffRoute(full),{role,id,access,base});
    assert.deepEqual(staffRoute(new URL(base+'#/'+role+'/'+id+'?access='+access)),{role,id,access,base});
    assert.deepEqual(staffRoute(new URL(staffUrl(base,role))),{role,id:'',access:null,base});
  }
  assert.equal(staffUrl(base,'stage'),base+'bigscreen/');
  assert.deepEqual(staffRoute(new URL(base+'bigscreen')),{role:'stage',id:'',access:null,base});
  assert.deepEqual(staffRoute(new URL(base+'big-screen/#/'+id+'?access='+access)),{role:'stage',id,access,base});
  assert.equal(staffRoute(new URL(base+'#/join?code=ABCDEF')),null);
});

test('a reusable room retains its role-limited staff links through a confirmed reset',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lab-staff-'));
  const db=await database();
  const app=await createApp({db,dataDir:dir,adminToken:'test-admin',origins:[]});
  async function call(method:'GET'|'POST'|'PATCH',url:string,token:string,body?:Record<string,unknown>,status=200){
    const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},payload:body});
    assert.equal(result.statusCode,status,result.body);
    return result.json();
  }
  try{
    const room=await call('POST','/v1/sessions','test-admin',{title:'Reusable rehearsal',reusable:true},201);
    const regular=await call('POST','/v1/sessions','test-admin',{title:'Standard rehearsal'},201);
    const root='/v1/sessions/'+room.id;
    const expiration=await db.query(`SELECT role,NOT isfinite(expires_at) AS permanent,expires_at>now()+interval '364 days' AS long_lived
      FROM credentials WHERE session_id=$1 ORDER BY role`,[room.id]);
    assert.deepEqual(expiration,[{role:'host',permanent:false,long_lived:true},{role:'stage',permanent:true,long_lived:true}]);
    const regularCredentials=await db.query("SELECT isfinite(expires_at) AND expires_at<now()+interval '31 days' AS short_lived FROM credentials WHERE session_id=$1",[regular.id]);
    assert.deepEqual(regularCredentials,[{short_lived:true},{short_lived:true}]);
    assert.equal((await call('GET',root+'/snapshot',room.stageToken)).session.reusable,true);
    const reset={expectedRevision:0,operationId:randomUUID(),confirmation:room.code};
    await call('POST',root+'/reset',room.stageToken,reset,401);
    const result=await call('POST',root+'/reset',room.hostToken,reset);
    assert.equal(result.session.reusable,true);
    assert.equal(result.session.run,1);
    const stage=await call('GET',root+'/snapshot',room.stageToken);
    assert.equal(stage.session.code,room.code);
    assert.equal(stage.telemetry,undefined);
    assert.equal((await call('GET',root+'/snapshot',room.hostToken)).total,0);

    const pair=(code:string,role:'host'|'stage',claim=randomUUID(),status=200)=>
      call('POST','/v1/staff/pair','',{code,role,claim},status);
    const issue=(role:'host'|'stage',token=room.hostToken,status=201)=>
      call('POST',root+'/pairing',token,{role},status);
    await issue('stage',room.stageToken,401);
    const projector=await issue('stage');
    assert.match(projector.code,/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    assert.ok(Date.parse(projector.expiresAt)>Date.now());
    await pair(projector.code,'host',randomUUID(),404);
    const claim=randomUUID();
    const paired=await pair(projector.code.toLowerCase().replace('-',' '),'stage',claim);
    assert.equal(paired.id,room.id);
    assert.equal(paired.reusable,true);
    assert.equal((await pair(projector.code,'stage',claim)).token,paired.token);
    await pair(projector.code,'stage',randomUUID(),404);
    await call('GET','/v1/sessions/'+regular.id+'/snapshot',paired.token,undefined,401);
    await call('PATCH',root+'/control',paired.token,{expectedRevision:result.session.revision,phase:0},401);
    await call('GET',root+'/export',paired.token,undefined,401);
    await issue('host',paired.token,401);
    assert.equal((await call('GET',root+'/snapshot',paired.token)).projectorsOnline,undefined);
    assert.equal((await call('GET',root+'/snapshot',room.hostToken)).projectorsOnline,0);

    const hostCode=await issue('host');
    const claims=await Promise.all([randomUUID(),randomUUID()].map(claim=>
      app.inject({method:'POST',url:'/v1/staff/pair',payload:{code:hostCode.code,role:'host',claim}})));
    assert.deepEqual(claims.map(response=>response.statusCode).sort(),[200,404]);
    const coHost=claims.find(response=>response.statusCode===200)!.json();
    const newPhase=await call('PATCH',root+'/control',coHost.token,{expectedRevision:result.session.revision,phase:0});
    assert.equal((await call('GET',root+'/snapshot',paired.token)).session.phase,0);
    const nextRun=await call('POST',root+'/reset',coHost.token,{expectedRevision:newPhase.revision,operationId:randomUUID(),confirmation:room.code});
    assert.equal((await call('GET',root+'/snapshot',paired.token)).session.run,nextRun.session.run);

    const expired=await issue('stage');
    await db.query("UPDATE staff_pairings SET expires_at=now()-interval '1 second'");
    await pair(expired.code,'stage',randomUUID(),404);
  }finally{
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
