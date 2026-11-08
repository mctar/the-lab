import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {stageCue} from '../src/workshop-flow.js';

test('the six-step workshop gives the room time to capture, then starts one shared reflection clock',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'brick-flow-'));
  const app=await createApp({dataDir:dir,adminToken:'test-admin',origins:[]});
  const call=async(method:'GET'|'POST'|'PATCH',url:string,token='',payload?:Record<string,unknown>)=>{
    const response=await app.inject({method,url,headers:token?{authorization:'Bearer '+token}:{},payload});
    return {status:response.statusCode,data:response.json()};
  };
  try{
    const room=(await call('POST','/v1/sessions','test-admin',{title:'Rebuilt rehearsal'})).data;
    const root=`/v1/sessions/${room.id}`,joinKey=randomUUID();
    const joinResult=await call('POST','/v1/join','',{code:room.code,joinKey,aiTool:'Gemini',share:false});
    assert.equal(joinResult.status,200);
    const {participant,token}=joinResult.data;
    assert.equal(participant.data.aiTool,'Gemini');
    assert.equal(participant.data.share,false);
    const retry=await call('POST','/v1/join','',{code:room.code,joinKey,aiTool:'Claude',share:true});
    assert.deepEqual(retry.data.participant,participant);
    assert.equal(stageCue(joinResult.data.session).title,'Join The Lab');

    let hostRevision=0,participantRevision=0;
    const control=async(patch:Record<string,unknown>)=>{
      const response=await call('PATCH',root+'/control',room.hostToken,{expectedRevision:hostRevision, ...patch});
      assert.equal(response.status,200);
      hostRevision=response.data.revision;
      return response.data;
    };
    const save=async(patch:Record<string,unknown>,expected=200)=>{
      const response=await call('PATCH',root+'/me',token,{operationId:randomUUID(),expectedRevision:participantRevision,patch});
      assert.equal(response.status,expected);
      if(expected===200)participantRevision=response.data.revision;
    };
    await save({progress:2},403);
    await control({phase:0});
    await save({progress:3});
    await save({progress:4},403);
    await control({stageView:'gallery'});
    const build=await control({phase:1});
    assert.equal(build.stageView,'overview');
    assert.ok(Date.parse(build.endsAt)-Date.parse(build.serverTime)>295000);
    await save({progress:4});
    const capture=await control({phase:2});
    assert.equal(capture.endsAt,null);
    assert.equal(capture.remainingMs,null);
    assert.equal(stageCue(capture).title,'Photograph your build');
    await save({progress:5});
    const reflection=await control({timer:'reset'});
    assert.ok(Date.parse(reflection.endsAt)-Date.parse(reflection.serverTime)>115000);
    const stage=(await call('GET',root+'/snapshot',room.stageToken)).data;
    const phone=(await call('GET',root,token)).data;
    assert.equal(stage.session.endsAt,phone.session.endsAt);
    assert.equal(stageCue(stage.session).title,'Reflect on the first build');
    const paused=await control({timer:'pause'});
    assert.equal(paused.endsAt,null);
    assert.ok(paused.remainingMs>110000);
    assert.equal(stageCue(paused).title,'Reflect on the first build');
    const extended=await control({timer:'extend'});
    assert.equal(extended.remainingMs,paused.remainingMs+60000);
    assert.equal((await control({timer:'resume'})).remainingMs,null);
    await save({aiConcept:'Private note'},400);
    await save({instructionEase:'Some parts were hard'});
    assert.deepEqual((await call('GET',root+'/snapshot',room.stageToken)).data.instructionEase,{'Some parts were hard':1});
    const make=await control({phase:3});
    assert.ok(Date.parse(make.endsAt)-Date.parse(make.serverTime)>595000);
    await control({phase:4});
    const card={operationId:randomUUID(),expectedRevision:participantRevision,consentVersion:0,kind:'concept',title:'Brick choir',description:'A shared ritual for strangers.'};
    assert.equal((await call('POST',root+'/cards',token,card)).status,403);
    await save({share:true});
    assert.equal((await call('POST',root+'/cards',token,{...card,expectedRevision:participantRevision,consentVersion:1})).status,200);
    await control({phase:5});
    await save({progress:9});
    const finished=(await call('GET',root+'/snapshot',room.hostToken)).data;
    assert.equal(finished.telemetry.finished,1);
    assert.deepEqual(finished.after,[0,0,0],'finishing is independent of the optional poll');
  }finally{
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
