import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';

test('AI choices save in the lobby, can change, remain host-only, and export with answers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bwt-ai-'));
  const app=await createApp({dataDir:dir,adminToken:'test-admin',origins:[]});
  const call=async(method:any,url:string,token='',payload?:any)=>{const r=await app.inject({method,url,headers:token?{authorization:'Bearer '+token}:{},payload});return {status:r.statusCode,data:r.json()};};
  try{
    const s=(await call('POST','/v1/sessions','test-admin',{title:'AI choice test',flowVersion:2})).data,root='/v1/sessions/'+s.id;
    const p=(await call('POST','/v1/join','',{code:s.code,joinKey:randomUUID()})).data;
    const legacy=(await call('POST','/v1/join','',{code:s.code,joinKey:randomUUID()})).data;
    const tools=['ChatGPT','Gemini','Claude','Copilot','Something else'];
    for(const [revision,aiTool] of tools.entries()){
      const saved=await call('PATCH',root+'/me',p.token,{operationId:randomUUID(),expectedRevision:revision,patch:{aiTool}});
      assert.equal(saved.status,200);assert.equal(saved.data.data.aiTool,aiTool);
      assert.equal(saved.data.consentVersion,0,'changing AI must not change gallery consent');
      assert.equal((await call('GET',root,p.token)).data.participant.data.aiTool,aiTool);
    }
    for(const aiTool of ['', 'Unrecognised app', null])assert.equal((await call('PATCH',root+'/me',p.token,{operationId:randomUUID(),expectedRevision:5,patch:{aiTool}})).status,400);
    const host=(await call('GET',root+'/snapshot',s.hostToken)).data;
    assert.equal(host.telemetry.participants.find((u:any)=>u.id===p.participant.id).aiTool,'Something else');
    assert.equal(host.telemetry.participants.find((u:any)=>u.id===legacy.participant.id).aiTool,null);
    const stage=(await call('GET',root+'/snapshot',s.stageToken)).data;
    assert.equal(JSON.stringify(stage).includes('aiTool'),false,'personal AI choices stay off the projection API');
    const exported=(await call('GET',root+'/export',s.hostToken)).data;
    assert.equal(exported.answers.filter((a:any)=>a.data.aiTool==='Something else').length,1);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
