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
  }finally{
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
