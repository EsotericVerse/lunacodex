import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpLocSession} from '../app/loc/mcp/loc-access.mjs';

const subject='loc_'+ 'A'.repeat(40);
test('MCP admin reads native LOC OAuth identity and signed site token',async()=>{
  const result=await mcpLocSession({account:{
    auth:{getVerifiedSession:async()=>({user:{id:subject,email:'owner@example.org'}})},
    getAccessToken:async()=> 'header.payload.signature'
  }});
  assert.deepEqual(result,{subject,token:'header.payload.signature'});
});
test('invalid subject or missing native OAuth session cannot use admin',async()=>{
  const fake=id=>({auth:{getVerifiedSession:async()=>id?{user:{id}}:null},
    getAccessToken:async()=> 'header.payload.signature'});
  await assert.rejects(mcpLocSession({account:fake('user_123')}),/LOC Auth login required/);
  await assert.rejects(mcpLocSession({account:fake(null)}),/LOC Auth login required/);
  await assert.rejects(mcpLocSession({account:{...fake(subject),
    getAccessToken:async()=>''}}),/token unavailable/);
});
