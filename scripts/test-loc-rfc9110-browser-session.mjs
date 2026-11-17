import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedLocWebsiteSession} from '../app/loc/auth/verified-session.mjs';
import {editorSessionStatus,touchEditorSession,clearEditorSession,
  EDIT_IDLE_TTL_MS,EDIT_SESSION_TTL_MS} from '../app/loc/auth/edit-session-ttl.mjs';

const request=(withCookie=true)=>new Request('https://loc.lo3rwang.cc/api/loc-permissions',{
  headers:withCookie?{cookie:'loc-session=example'}:{}
});
const authResponse=(status,body={})=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'}
});

test('RFC 9110 LOC identity verifier preserves 401, 403, 429, 503 distinctions',async()=>{
  for(const [upstream,expected] of [[401,401],[403,403],[429,429],[503,503],[502,503]]){
    await assert.rejects(
      verifiedLocWebsiteSession(request(),{fetchImpl:async()=>authResponse(upstream)}),
      error=>error.httpStatus===expected&&error.reason==='auth_status_'+upstream
    );
  }
});

test('no Cookie is 401, without making a new HTTP request',async()=>{
  let requests=0;
  await assert.rejects(verifiedLocWebsiteSession(request(false),{
    fetchImpl:async()=>{requests++;return authResponse(200)}
  }),error=>error.httpStatus===401&&error.reason==='no_cookie');
  assert.equal(requests,0);
});

test('valid browser Cookie reuses the existing session verifier and identity',async()=>{
  let requests=0;
  const session=await verifiedLocWebsiteSession(request(),{fetchImpl:async(url,options)=>{
    requests++;
    assert.equal(url,'https://auth.lo3rwang.cc/api/auth/get-session');
    assert.equal(options.headers.cookie,'loc-session=example');
    return authResponse(200,{session:{id:'session'},user:{
      id:'loc-user',email:'owner@example.com',emailVerified:true
    }});
  }});
  assert.deepEqual(session,{userId:'loc-user',email:'owner@example.com'});
  assert.equal(requests,1);
});

test('existing LOC edit Session retains its original time boundaries',()=>{
  const map=new Map();
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)};
  assert.equal(touchEditorSession(storage,1000),true);
  assert.equal(editorSessionStatus(storage,1000+EDIT_IDLE_TTL_MS-1).expired,false);
  assert.equal(editorSessionStatus(storage,1000+EDIT_IDLE_TTL_MS).expired,true);
  clearEditorSession(storage);
  assert.equal(touchEditorSession(storage,1000),true);
  assert.equal(touchEditorSession(storage,1000+EDIT_IDLE_TTL_MS-1),true);
  assert.equal(editorSessionStatus(storage,1000+EDIT_SESSION_TTL_MS).expired,true);
});
