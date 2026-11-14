import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createApp} from '../server/app.js';
import {database} from '../server/db.js';

test('timed activities use the room soundtrack shuffle and keep their track through timer controls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lab-soundtracks-'));
  const app=await createApp({db:await database(),dataDir:dir,adminToken:'test-admin',origins:[]});
  try{
    const tracks=['build-loop','loose-contact','soft-circuit','wooden-teeth'];
    const sounds=join(dir,'soundtracks');
    await Promise.all([...tracks.map(track=>writeFile(join(sounds,track+'.wav'),'test audio')),writeFile(join(sounds,'incoming.wav.part'),'partial upload')]);
    async function call(method:'GET'|'POST'|'PATCH',url:string,token='',payload?:object,status=200){
      const response=await app.inject({method,url,headers:{authorization:'Bearer '+token},payload});
      assert.equal(response.statusCode,status,response.body);
      return response;
    }
    const room=(await call('POST','/v1/sessions','test-admin',{title:'Soundtrack rehearsal'},201)).json();
    const root='/v1/sessions/'+room.id;
    const stage=async()=>(await call('GET',root+'/snapshot',room.stageToken)).json();
    assert.deepEqual((await call('GET',root+'/soundtracks',room.stageToken)).json().tracks,tracks);
    await call('GET',root+'/soundtracks/build-loop','',undefined,401);
    await call('GET',root+'/soundtracks/build-loop',room.hostToken,undefined,401);
    const audio=await call('GET',root+'/soundtracks/build-loop',room.stageToken);
    assert.equal(audio.headers['content-type'],'audio/wav');
    assert.equal(audio.body,'test audio');
    assert.equal((await stage()).soundtrack,null);
    let revision=0;
    async function control(patch:object){
      const response=await call('PATCH',root+'/control',room.hostToken,{...patch,expectedRevision:revision});
      revision=response.json().revision;
      return (await stage()).soundtrack;
    }
    const first=await control({phase:0});
    for(const patch of [{timer:'pause'},{timer:'extend'},{timer:'resume'},{timer:'reset'},{stageView:'gallery'}]){
      assert.equal(await control(patch),first);
    }
    const build=await control({phase:1});
    assert.equal(await control({phase:2}),build);
    const reflection=await control({timer:'reset',stageView:'first-ideas'});
    const exchange=await control({exchange:true});
    assert.deepEqual([first,build,reflection,exchange].sort(),tracks);
    const develop=await control({phase:3});
    assert.notEqual(develop,exchange);
    const concept=await control({phase:4});
    await control({phase:5});
    const final=await control({stageView:'final-exchange'});
    assert.equal(new Set([develop,concept,final]).size,3);
    await call('POST',root+'/reset',room.hostToken,{expectedRevision:revision,operationId:randomUUID(),confirmation:room.code});
    assert.equal((await stage()).soundtrack,null);
  }finally{
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
