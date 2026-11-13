import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {database} from '../server/db.js';
import {CURRENT_FLOW_VERSION} from '../server/model.js';

for(const flowVersion of [3,CURRENT_FLOW_VERSION])test(`flow ${flowVersion} preserves submission requirements, phase gates and independent sharing permissions`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lab-required-'));
  const app=await createApp({db:await database(),dataDir:directory,adminToken:'test-admin',origins:[]});
  try{
    async function call(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,token:string,body?:Record<string,unknown>,status=200){
      const result=await app.inject({method,url,headers:{authorization:'Bearer '+token},payload:body});
      assert.equal(result.statusCode,status,result.body);
      return result.json();
    }
    const room=await call('POST','/v1/sessions','test-admin',{title:'Required flow rehearsal',...(flowVersion===3?{flowVersion}:{})},201);
    const root='/v1/sessions/'+room.id;
    const admission={code:room.code,aiTool:'Claude'};
    await call('POST','/v1/join','',{...admission,joinKey:randomUUID()},400);
    const joinKey=randomUUID();
    const builder=await call('POST','/v1/join','',{...admission,joinKey,share:true,writeup:false});
    const retried=await call('POST','/v1/join','',{...admission,joinKey,share:false,writeup:true});
    assert.equal(builder.session.flowVersion,flowVersion);
    assert.equal(retried.participant.data.share,true);
    assert.equal(retried.participant.data.writeup,false);
    const publicationOnly=await call('POST','/v1/join','',{...admission,joinKey:randomUUID(),share:false,writeup:true});
    const privateBuilder=await call('POST','/v1/join','',{...admission,joinKey:randomUUID(),share:false,writeup:false});
    let hostRevision=0;
    async function control(patch:Record<string,unknown>){
      const s=await call('PATCH',root+'/control',room.hostToken,{expectedRevision:hostRevision,...patch});
      hostRevision=s.revision;
      return s;
    }
    type Builder={token:string;participant:{revision:number}};
    async function save(who:Builder,patch:Record<string,unknown>,status=200){
      const result=await call('PATCH',root+'/me',who.token,{operationId:randomUUID(),expectedRevision:who.participant.revision,patch},status);
      if(status===200)who.participant.revision=result.revision;
    }
    const image=await sharp({create:{width:24,height:24,channels:3,background:'#2151c6'}}).jpeg().toBuffer();
    async function upload(who:Builder){
      const boundary='required-flow-photo';
      const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="build.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),image,Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const response=await app.inject({method:'POST',url:root+'/photos?purpose=workshop&consentVersion=0',headers:{authorization:'Bearer '+who.token,'content-type':'multipart/form-data; boundary='+boundary},payload});
      assert.equal(response.statusCode,200,response.body);
      return response.json().assetId as string;
    }
    const submit=(who:Builder,kind:string,fields:Record<string,unknown>,status=200)=>call('POST',root+'/cards',who.token,{operationId:randomUUID(),expectedRevision:who.participant.revision,consentVersion:0,kind,...fields},status);
    const stage=()=>call('GET',root+'/snapshot',room.stageToken);
    const host=()=>call('GET',root+'/snapshot',room.hostToken);
    async function access(asset:string,token:string,status:number,publication=false){
      const response=await app.inject({method:'GET',url:root+'/assets/'+asset+(publication?'?publication=1':''),headers:{authorization:'Bearer '+token}});
      assert.equal(response.statusCode,status);
    }

    await control({phase:0});
    await save(privateBuilder,{share:true},403);
    await save(builder,{handoff:'ready'},flowVersion===3?400:200);
    await submit(builder,'first-idea',{title:'A bridge'},400);
    if(flowVersion===4){
      assert.equal((await host()).collection.firstIdeas,0);
      await control({phase:1});
      await save(builder,{progress:4});
      await save(privateBuilder,{progress:4});
      await control({phase:2});
      await save(builder,{progress:5});
    }
    const original=await upload(builder);
    await submit(builder,'first-idea',{title:'A bridge',assetId:original});
    await save(builder,{handoff:'ready'});
    const privateOriginal=await upload(privateBuilder);
    await submit(privateBuilder,'first-idea',{title:'A table',assetId:privateOriginal});
    await save(privateBuilder,{handoff:'idea-only'});
    await save(publicationOnly,{handoff:'no-plan'});
    assert.deepEqual((await host()).collection,{instructions:1,noPlan:2,firstIdeas:2,builds:0,concepts:0,
      ...(flowVersion===4?{conceptReached:0,buildsWithConcepts:0}:{})});
    assert.equal((await stage()).collection,undefined);
    await access(original,room.stageToken,404);
    await access(privateOriginal,room.hostToken,404);
    await access(privateOriginal,builder.token,403);

    if(flowVersion===3){
      await control({phase:1});
      await control({phase:2});
    }
    const build=await upload(builder);
    await submit(builder,'build',{title:'First build',assetId:build});
    const approved=await upload(publicationOnly);
    await submit(publicationOnly,'build',{title:'First build',assetId:approved});
    assert.deepEqual((await stage()).gallery.map((card:{assetId:string})=>card.assetId),[build]);
    await access(build,room.stageToken,200);
    await access(original,room.stageToken,404);
    await control({stageView:'first-ideas',timer:'reset'});
    assert.equal((await stage()).ideas.firstBuilds.length,1);
    assert.equal((await stage()).ideas.firstBuilds[0].first.assetId,original);
    await access(original,room.stageToken,200);
    await access(approved,room.stageToken,404);
    await access(approved,room.hostToken,200,true);
    assert.deepEqual((await host()).publication.map((entry:{assetId:string})=>entry.assetId),[approved]);
    await call('DELETE',root+'/publication/'+approved,room.hostToken);
    await access(approved,room.hostToken,404,true);
    assert.equal((await host()).collection.builds,2);
    await control({galleryPaused:true});
    await access(original,room.stageToken,404);
    await control({stageView:'overview',galleryPaused:false,timer:'reset'});
    await save(builder,{instructionEase:'Easy',ideaLiking:'A lot'});
    await control({exchange:true});
    await control({phase:3});
    await save(privateBuilder,{progress:6,instructionEase:'I had no instructions',ideaLiking:'Somewhat'},400);
    await save(builder,{progress:6});
    const cardRound=await control({phase:4});
    if(flowVersion===4){
      assert.ok(Date.parse(cardRound.endsAt)-Date.parse(cardRound.serverTime)>235000);
      await save(builder,{progress:7});
      await save(builder,{progress:6});
      assert.equal((await host()).collection.conceptReached,1);
      assert.equal((await host()).collection.buildsWithConcepts,0);
    }else assert.equal(cardRound.endsAt,null);
    const final=await upload(builder);
    await submit(builder,'concept',{title:'Neighbour relay',description:'A game for two.',assetId:final},400);
    await submit(builder,'concept',{title:'Neighbour relay',description:'A game for two.',mine:'I added turns.',assetId:final});
    if(flowVersion===4)assert.equal((await host()).collection.buildsWithConcepts,1);
    assert.deepEqual((await stage()).gallery.map((card:{assetId:string})=>card.assetId),[final]);
    await access(final,room.stageToken,200);
    await access(original,room.stageToken,404);
    const last=await control({phase:5});
    assert.equal(last.stageView,'comparison');
    assert.equal(last.endsAt,null);
    assert.equal((await stage()).ideas.comparisons[0].final.mine,'I added turns.');
    await access(final,room.stageToken,200);
    await save(builder,{progress:9},400);
    await save(builder,{biggestChange:'What people would do',progress:9});
    assert.deepEqual((await stage()).biggestChange,{'What people would do':1});
    const exchange=await control({stageView:'final-exchange'});
    assert.ok(Date.parse(exchange.endsAt)-Date.parse(exchange.serverTime)>115000);
    assert.equal((await control({stageView:'results'})).endsAt,null);
  }finally{
    await app.close();
    await rm(directory,{recursive:true,force:true});
  }
});
