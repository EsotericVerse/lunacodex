import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8')
 .replace(/^import[\s\S]*?;\s*$/gm,'')
 .replace('export class LocAuthorityState','class LocAuthorityState')
 .replace('export default {','const worker={');
const subject='loc_'+'A'.repeat(40);
const principal={provider:'loc',subject,email:'verified@example.org'};
const {handleMcpAuthority}=new Function('DurableObject','verifyNativeOAuth',
 'MCP_AUDIENCE','WEB_AUDIENCE',source+';return {handleMcpAuthority};')(
 class{constructor(ctx,env){this.ctx=ctx;this.env=env;}},
 async()=>principal,'https://mcp.lo3rwang.cc','https://loc.lo3rwang.cc');
let allowed=true,selectionCalls=0,grantCalls=0;
const authority={
 async mayAccess(p){grantCalls++;return allowed&&p.provider==='loc'&&p.subject===subject&&
  p.scope==='lo3rwang'&&p.action==='read';},
 async selectedDatabaseForDelegation(sub){selectionCalls++;assert.equal(sub,subject);return 'office_pg';}
};
const env={LOC_AUTHORITY_STATE:{idFromName:name=>name,get:()=>authority},
 LOC_RECOVERY_ROOT_LOC_SUBJECTS:''};
const url={pathname:'/v1/mcp/direct-permit/lo3rwang/read'};

test('LOC public read permit works without Scope grants or DB secrets',async()=>{
 allowed=true;grantCalls=selectionCalls=0;
 const res=await handleMcpAuthority({method:'GET'},env,url,'');
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{authorized:true,subject,scopeid:'lo3rwang',
  action:'read',db_target:'office_pg'});
 assert.equal(grantCalls,0);
 assert.equal(selectionCalls,1);
});
test('public read remains available when no Scope read grant exists',async()=>{
 allowed=false;grantCalls=selectionCalls=0;
 const res=await handleMcpAuthority({method:'GET'},env,url,'');
 assert.equal(res.status,200);
 assert.equal((await res.json()).authorized,true);
 assert.equal(grantCalls,0);
 assert.equal(selectionCalls,1);
});
test('the authorization-only permit cannot accept writes or SQL payloads',async()=>{
 allowed=true;
 await assert.rejects(handleMcpAuthority({method:'POST'},env,url,''),error=>
  error.status===405);
});
test('permit never exposes a generic SQL transport or database credentials',()=>{
 const index=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
 const start=index.indexOf('const directPermit='),end=index.indexOf('const quota=',start);
 assert.ok(start>0&&end>start);
 const permit=index.slice(start,end);
 assert.doesNotMatch(permit,/LOC_SQL_GATEWAY|\/v1\/sql|password|connection_url|sqlProfile/);
 assert.match(permit,/selectedDatabaseForDelegation/);
});
