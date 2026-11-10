import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {database} from '../server/db.js';
import {purgeExpiredData} from '../server/retention.js';
import {stageCue} from '../src/workshop-flow.js';

test('revised rooms time the handoff and exchange, reveal opted-in pairs, and isolate write-up consent',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lab-revised-'));
  const db=await database();
  const app=await createApp({db,dataDir:dir,adminToken:'test-admin',origins:[]});
  async function call(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,token:string,payload?:Record<string,unknown>){
    const response=await app.inject({method,url,headers:{authorization:'Bearer '+token},payload});
    return {status:response.statusCode,data:response.json()};
  }
  try{
    const room=(await call('POST','/v1/sessions','test-admin',{title:'Revised rehearsal'})).data;
    const root='/v1/sessions/'+room.id;
    const {participant,session,token}=(await call('POST','/v1/join','',{code:room.code,joinKey:randomUUID(),aiTool:'Claude'})).data;
    assert.equal(session.flowVersion,2);
    let hostRevision=0,revision=0;
    async function control(patch:Record<string,unknown>,expected=200){
      const result=await call('PATCH',root+'/control',room.hostToken,{expectedRevision:hostRevision,...patch});
      assert.equal(result.status,expected,JSON.stringify(result.data));
      if(expected===200)hostRevision=result.data.revision;
      return result.data;
    }
    async function save(patch:Record<string,unknown>){
      const result=await call('PATCH',root+'/me',token,{operationId:randomUUID(),expectedRevision:revision,patch});
      assert.equal(result.status,200,JSON.stringify(result.data));
      revision=result.data.revision;
      return result.data;
    }
    const submit=(kind:string,consentVersion:number,values:Record<string,unknown>)=>
      call('POST',root+'/cards',token,{operationId:randomUUID(),expectedRevision:revision,kind,consentVersion,...values});
    const snapshot=async(role:'host'|'stage')=>(await call('GET',root+'/snapshot',room[role+'Token'])).data;
    const image=await sharp({create:{width:24,height:24,channels:3,background:'#2e63f0'}}).jpeg().toBuffer();
    async function upload(purpose:string,version:number){
      const boundary='revised-workshop-photo';
      const payload=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="photo"; filename="build.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),image,Buffer.from('\r\n--'+boundary+'--\r\n')]);
      const response=await app.inject({method:'POST',url:root+'/photos?purpose='+purpose+'&consentVersion='+version,
        headers:{authorization:'Bearer '+token,'content-type':'multipart/form-data; boundary='+boundary},payload});
      return {status:response.statusCode,data:response.json()};
    }
    const fetchPhoto=async(asset:string,credential:string)=>app.inject({method:'GET',url:root+'/assets/'+asset,headers:{authorization:'Bearer '+credential}});

    await control({stageView:'first-ideas'},403);
    const handoff=await control({phase:0});
    assert.ok(Date.parse(handoff.endsAt)-Date.parse(handoff.serverTime)>355000);
    await control({phase:1});
    const capture=await control({phase:2});
    assert.equal(capture.endsAt,null);
    await control({exchange:true},409);

    const publicationPermission=await save({writeup:true});
    assert.equal(publicationPermission.data.share,false);
    const photo=await upload('writeup',publicationPermission.writeupVersion);
    assert.equal(photo.status,200);
    const asset=photo.data.assetId;
    assert.equal((await submit('writeup-build',1,{assetId:asset})).status,200);
    assert.equal((await fetchPhoto(asset,room.stageToken)).statusCode,404);
    assert.equal((await fetchPhoto(asset,room.hostToken)).statusCode,200);
    assert.equal((await snapshot('host')).publication.length,1);
    assert.equal((await snapshot('stage')).publication,undefined);

    await save({share:true});
    assert.equal((await submit('build',1,{assetId:asset})).status,403,'publication approval alone cannot put an asset on stage');
    const first=await submit('first-idea',1,{title:'A bridge for strangers'});
    assert.equal(first.status,200);
    assert.equal((await snapshot('stage')).ideas,undefined);
    await control({stageView:'first-ideas'});
    const wall=await snapshot('stage');
    assert.equal(wall.ideas.first[0].title,'A bridge for strangers');
    assert.equal(wall.gallery.length,0);
    assert.equal(JSON.stringify(wall.ideas).includes(participant.id),false);
    await control({galleryPaused:true});
    assert.equal((await snapshot('stage')).ideas.first.length,0);
    await control({galleryPaused:false,timer:'reset',stageView:'overview'});
    const exchange=await control({exchange:true});
    assert.equal(stageCue(exchange).title,'Show your neighbour');
    assert.ok(Date.parse(exchange.endsAt)-Date.parse(exchange.serverTime)>115000);
    const develop=await control({phase:3});
    assert.equal(develop.exchange,false);
    assert.ok(Date.parse(develop.endsAt)-Date.parse(develop.serverTime)>355000);
    await control({phase:4});
    assert.equal((await submit('concept',1,{title:'Neighbour relay',description:'A game with turns for two people.'})).status,200);
    const finish=await control({phase:5});
    assert.equal(finish.stageView,'comparison');
    await save({biggestChange:'What people would do'});
    const comparison=await snapshot('stage');
    assert.equal(comparison.ideas.pairs[0].first,'A bridge for strangers');
    assert.equal(comparison.ideas.pairs[0].final,'Neighbour relay');
    assert.deepEqual(comparison.biggestChange,{'What people would do':1});
    await save({share:false});
    assert.equal((await snapshot('stage')).ideas.pairs.length,0);
    assert.equal((await snapshot('host')).publication.length,1,'room withdrawal leaves separate approval intact');
    await control({closed:true});
    await save({writeup:false});
    assert.equal((await snapshot('host')).publication.length,0);
    assert.equal((await fetchPhoto(asset,room.hostToken)).statusCode,404);

    assert.ok((await readFile(join(dir,'photos',asset+'.jpg'))).length>0);
    await db.query("UPDATE participants SET retain_until=now()-interval '1 day' WHERE id=$1",[participant.id]);
    await purgeExpiredData(db,join(dir,'photos'));
    assert.equal((await snapshot('host')).total,0);
    await assert.rejects(readFile(join(dir,'photos',asset+'.jpg')),{code:'ENOENT'});
    await assert.rejects(readFile(join(dir,'photos',asset+'-thumb.jpg')),{code:'ENOENT'});
    assert.deepEqual(await db.query('SELECT owner FROM operations WHERE owner=$1',[participant.id]),[]);
  }finally{
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
