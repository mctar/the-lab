import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {CURRENT_FLOW_VERSION,type Answers,type CardKind,type Session,type Snapshot} from '../server/model.js';

const api=process.env.API_URL||'http://127.0.0.1:4181';
const admin=process.env.ADMIN_TOKEN||(await readFile('.runtime/admin-token','utf8')).trim();
const count=Number(process.env.USERS||400);
const largePhotoCount=Math.min(count,Number(process.env.PHOTOS||0));
if(!Number.isInteger(count)||count<1||!Number.isInteger(largePhotoCount)||largePhotoCount<0)throw new Error('Set USERS and PHOTOS to valid counts.');
const latencies:number[]=[];
let photoRetries=0,photoSuccess=0,liveConnections=0;

async function call<T>(path:string,token='',body?:unknown,method=body?'POST':'GET'){
  const start=performance.now();
  const response=await fetch(api+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  latencies.push(performance.now()-start);
  if(!response.ok)throw new Error(`${response.status} ${path}: ${(await response.json()).error}`);
  return await response.json() as T;
}

const room=await call<{id:string;code:string;hostToken:string;stageToken:string}>('/v1/sessions',admin,{title:'LOAD TEST — '+new Date().toISOString(),flowVersion:CURRENT_FLOW_VERSION});
const root='/v1/sessions/'+room.id,abort=new AbortController();
let hostRevision=0;
const streams:Promise<void>[]=[];
async function control(patch:Record<string,unknown>){
  const state=await call<Session>(root+'/control',room.hostToken,{expectedRevision:hostRevision,...patch},'PATCH');
  hostRevision=state.revision;
}
type Client={token:string;revision:number;index:number};
async function save(client:Client,patch:Answers){
  const person=await call<{revision:number}>(root+'/me',client.token,{operationId:randomUUID(),expectedRevision:client.revision,patch},'PATCH');
  client.revision=person.revision;
}
const small=await sharp({create:{width:64,height:64,channels:3,background:'#83c9ff'}}).jpeg().toBuffer();
const large=largePhotoCount?await sharp(randomBytes(900*900*3),{raw:{width:900,height:900,channels:3}}).jpeg({quality:78}).toBuffer():small;
async function submit(client:Client,kind:CardKind,fields:Record<string,string>){
  for(let attempt=0;attempt<40;attempt++){
    const form=new FormData(),image=client.index<largePhotoCount?large:small;
    form.append('photo',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'test.jpg');
    const response=await fetch(api+root+'/photos?consentVersion=0&purpose=workshop',{method:'POST',headers:{Authorization:'Bearer '+client.token},body:form});
    const data=await response.json();
    if(response.status===429||response.status===503){
      photoRetries++;
      await new Promise(resolve=>setTimeout(resolve,1500+Math.random()*2500));
      continue;
    }
    if(!response.ok)throw new Error('Photo: '+data.error);
    await call(root+'/cards',client.token,{operationId:randomUUID(),expectedRevision:client.revision,consentVersion:0,kind,assetId:data.assetId,...fields});
    photoSuccess++;
    return;
  }
  throw new Error('Photo retries exhausted.');
}

try{
  const clients=await Promise.all(Array.from({length:count},async(_,index)=>{
    const joined=await call<{token:string}>('/v1/join','',{code:room.code,joinKey:randomUUID(),aiTool:'Gemini',share:index%2===0,writeup:false});
    return {token:joined.token,revision:0,index};
  }));
  await Promise.all(clients.map(async client=>{
    const response=await fetch(api+root+'/events',{headers:{Authorization:'Bearer '+client.token},signal:abort.signal});
    if(!response.ok)throw new Error('SSE '+response.status);
    liveConnections++;
    const reader=response.body!.getReader();
    streams.push((async()=>{try{while(!(await reader.read()).done){}}catch(error){if(!abort.signal.aborted)throw error;}})());
  }));
  await control({phase:0});
  await Promise.all(clients.map(client=>save(client,{handoff:'ready',progress:3})));
  const activity={step:3,visibility:'visible',pendingSaves:0,syncStatus:'saved',waitingForPhase:1,photos:{pile:true,build:false,concept:false},handedOff:true,cardReady:false};
  await Promise.all(clients.map(client=>call(root+'/telemetry',client.token,activity)));
  const waiting=await call<Snapshot>(root+'/snapshot',room.hostToken);
  await control({phase:1});
  await control({phase:2});
  await Promise.all(clients.map(client=>submit(client,'build',{title:'First build'})));
  await Promise.all(clients.map(client=>submit(client,'first-idea',{title:'A bridge'})));
  await control({stageView:'first-ideas'});
  const first=await call<Snapshot>(root+'/snapshot',room.stageToken);
  await control({stageView:'overview',timer:'reset'});
  await Promise.all(clients.map(client=>save(client,{progress:5,instructionEase:'Easy',ideaLiking:'A lot'})));
  await control({exchange:true});
  await control({phase:3});
  await Promise.all(clients.map(client=>save(client,{progress:6})));
  await control({phase:4});
  await Promise.all(clients.map(client=>save(client,{progress:7})));
  await Promise.all(clients.map(client=>submit(client,'concept',{title:'Neighbour relay',description:'A game for two people.',mine:'I added turns.'})));
  await control({phase:5});
  await Promise.all(clients.map(client=>save(client,{progress:9,biggestChange:'What people would do'})));
  await Promise.all(clients.map(client=>call(root+'/telemetry',client.token,{...activity,step:9,waitingForPhase:null,cardReady:true,photos:{pile:true,build:true,concept:true}})));
  const finished=await call<Snapshot>(root+'/snapshot',room.hostToken);
  const stage=await call<Snapshot>(root+'/snapshot',room.stageToken);
  latencies.sort((a,b)=>a-b);
  const report={at:new Date().toISOString(),api,users:count,liveConnections,requests:latencies.length,
    ready:waiting.collection?.instructions,waiting:waiting.telemetry?.waiting,finished:finished.telemetry?.finished,
    photoSuccess,photoRetries,largePhotoCount,firstPairs:first.ideas?.firstBuilds?.length,finalPairs:stage.ideas?.comparisons?.length,
    conceptReached:finished.collection?.conceptReached,buildsWithConcepts:finished.collection?.buildsWithConcepts,
    closingVotes:stage.biggestChange?.['What people would do'],
    p50Ms:Math.round(latencies[Math.floor(latencies.length*.5)]),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)])};
  const reportDirectory=process.env.REPORT_DIRECTORY||'.runtime';
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(reportDirectory+'/load-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  const shared=Math.ceil(count/2);
  if([report.ready,report.waiting,report.finished,report.closingVotes,report.conceptReached,report.buildsWithConcepts,liveConnections].some(n=>n!==count)||
     report.firstPairs!==shared||report.finalPairs!==shared||photoSuccess!==count*3)process.exitCode=1;
}finally{
  abort.abort();
  await Promise.allSettled(streams);
  await control({closed:true});
}
