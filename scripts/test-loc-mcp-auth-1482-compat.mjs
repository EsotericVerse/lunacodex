import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeMcpBearer} from '../app/loc/mcp/access-roles.mjs';
import {privateGalaxyLink} from '../app/loc/mcp/private-galaxy.mjs';

const SUBJECT='loc_'+ 'A'.repeat(40);
const TOKEN='test-nonempty-bearer';
const cases=[[401,401],[403,401],[429,429],[500,503],[503,503]];
for(const [upstream,expected] of cases){
  test('MCP UserInfo '+upstream+' maps to '+expected+' without executing SQL',async()=>{
    const fetchImpl=async()=>Response.json({error:'Untrusted upstream detail'},{
      status:upstream});
    let dbCalls=0;
    const database=async()=>{dbCalls++;throw Error('Database MUST NOT be contacted')};
    await assert.rejects(authorizeMcpBearer(TOKEN,SUBJECT,{},{
      fetchImpl,database
    }),error=>error.httpStatus===expected&&
      !String(error.message).includes('Untrusted upstream detail'));
    await assert.rejects(privateGalaxyLink({
      action:'read',scopeid:'lo3rwang',uid:'Ab12Cd34'
    },TOKEN,SUBJECT,{},fetchImpl),error=>error.httpStatus===expected&&
      !String(error.message).includes('Untrusted upstream detail'));
    assert.equal(dbCalls,0);
  });
}
test('MCP UserInfo offline is service unavailable, not revoked credentials',async()=>{
  const offline=async()=>{throw Error('Network offline')};
  await assert.rejects(authorizeMcpBearer(TOKEN,SUBJECT,{},{
    fetchImpl:offline
  }),error=>error.httpStatus===503);
  await assert.rejects(privateGalaxyLink({
    action:'read',scopeid:'lo3rwang',uid:'Ab12Cd34'
  },TOKEN,SUBJECT,{},offline),error=>error.httpStatus===503);
});
test('LOC Auth PR #1482 response handling preserves OAuth discovery and native Queue',()=>{
  const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const router=file('app/loc/mcp/router.mjs');
  const native=file('app/loc/mcp/native-operations.mjs');
  const extension=file('extensions/loc-galaxy-link/background.js');
  assert.match(router,/status===401\?\{'WWW-Authenticate':oauthChallenge\(config\)\}/);
  assert.match(router,/status===429\?'LOC OAuth UserInfo rate limited'/);
  assert.match(native,/if\(response\?\.status===429\)throw refusal/);
  assert.match(native,/if\(!response\?\.ok\)throw refusal\('LOC OAuth UserInfo unavailable',503\)/);
  assert.match(extension,/if\(error\.httpStatus!==401\)throw error/);
  assert.match(extension,/await removeEvents\(group\)/);
  assert.match(extension,/const DB_NAME='loc-channel1-queue'/);
  assert.doesNotMatch(router+native,/setInterval\s*\(/);
});
