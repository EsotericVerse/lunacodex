import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {delegationAudience,verifyDelegationBoundary,issueDelegation,
  canManageDelegation} from '../app/loc/auth/delegation-contract.mjs';

const source=readFileSync(new URL('../supabase/functions/loc-kysely/index.ts',import.meta.url),'utf8');
const start=source.indexOf('async function verifyLocDelegation(');
const end=source.indexOf('// The deployed function and browser',start);
assert.ok(start>0&&end>start,'LOC verifier exists in the active Edge entry');
const code=source.slice(start,end).replace('token:string,body:Record<string,unknown>','token,body');
function verifier(payload,{audience='loc-delegation',
  revoked='',cutoff='0'}={}){
  let calls=0;
  const jwtVerify=async(_token,_key,options)=>{
    calls++;
    assert.deepEqual(options,{issuer:'loc',audience,algorithms:['RS256']});
    return {payload:{...payload,aud:audience}};
  };
  const factory=new Function('Deno','jwtVerify','locDelegationJwks',
    'delegationAudience','verifyDelegationBoundary',code+';return verifyLocDelegation;');
  return {verify:factory({env:{get:key=>({
    LOC_DELEGATION_NOT_BEFORE:cutoff,LOC_DELEGATION_REVOKED_SIDS:revoked})[key]}},
    jwtVerify,()=>{},delegationAudience,verifyDelegationBoundary),calls:()=>calls};
}
const base=()=>({iss:'loc',aud:'loc-delegation',me:true,sub:'principal1',
  email:'owner@example.org',sid:'delegation-123',
  iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,
  grants:['lo3rwang:read','lo3rwang:write','lo3rwang:manage']});

test('one shared delegation contract validates issuance and Scope management',()=>{
  const issued=issueDelegation({sub:'portable_user',email:' USER@EXAMPLE.ORG ',
    grants:['lo3rwang:manage'],audience:'sql',sid:'s1',
    now:Math.floor(Date.now()/1000),seconds:600});
  assert.equal(issued.email,'user@example.org');
  assert.equal(issued.aud,'loc-delegation');
  assert.equal(canManageDelegation({...issued,provider:'loc'},'scope','lo3rwang'),true);
  assert.equal(canManageDelegation({...issued,provider:'loc'},'scope','lrunes'),false);
  assert.throws(()=>issueDelegation({sub:'portable_user',email:'u@example.org',
    grants:['global:admin'],audience:'sql',sid:'s2',
    now:Math.floor(Date.now()/1000),seconds:600}),/grants/);
});
test('LOC signs delegations only via Authority and a pinned public JWKS',()=>{
  assert.match(source,/createRemoteJWKSet/);
  assert.match(source,/\.well-known\/jwks\.json/);
  assert.match(source,/algorithms:\["RS256"\]/);
  assert.doesNotMatch(source,/LOC_DELEGATION_SECRET|algorithms:\["HS256"\]/);
});
test('the Edge no longer requires any external identity provider or publishable API key',()=>{
  assert.doesNotMatch(source,/clerkSqlClaims|verifyClerkForSql|\/v1\/identity|publishableKeys/i);
  assert.match(source,/verifyLocDelegation\(match\[1\],body\)/);
  assert.match(source,/if\(role!==["']authenticated["']\)/);
  assert.match(source,/checkSearchQos\(source\)/);
});
test('existing PostgreSQL RLS does not bypass LOC signed Scope mutation boundary',()=>{
  assert.match(source,/if\(body\.operation!=="select"&&body\.schema==="silver"\)\s*await authorizeCrossEngineQuery\(trx,body,\{role,claims\}\)/);
  assert.match(source,/await bindPostgresSession\(trx,role,claims,/);
});
test('PostgreSQL Edge session claims use one bridge, not duplicated provider logic',()=>{
  assert.equal((source.match(/set_config\('request\.jwt\.claims'/g)||[]).length,1);
  assert.equal((source.match(/set_config\('request\.jwt\.claim\.sub'/g)||[]).length,1);
  assert.equal((source.match(/set_config\('request\.jwt\.claim\.role'/g)||[]).length,1);
  assert.match(source,/async function bindPostgresSession\(/);
  assert.match(source,/await bindPostgresSession\(trx,role,claims,/);
  assert.equal((source.match(/await bindPostgresSession\(trx,"authenticated",claims\)/g)||[]).length,3);
});
test('LOC-signed delegation separates MCP from ordinary SQL audience',async()=>{
  const mcpVerifier=verifier(base(),{audience:'loc-mcp'});
  const mcp=await mcpVerifier.verify('loc-token',{kind:'mcp-read',scopeid:'lo3rwang'});
  assert.equal(mcp.verifiedMcp,true);
  assert.equal(mcp.claims.me,true);
  assert.equal(mcp.claims.provider,'loc');
  const sqlVerifier=verifier(base());
  const sql=await sqlVerifier.verify('loc-token',{kind:'query'});
  assert.equal(sql.verifiedMcp,false);
  assert.equal(mcpVerifier.calls(),1);
  assert.equal(sqlVerifier.calls(),1);
});
test('MCP-only scope write receives a one-request internal manage grant',async()=>{
  const token={...base(),grants:['lo3rwang:write']};
  const mcp=await verifier(token,{audience:'loc-mcp'}).verify('loc-token',
    {kind:'mcp-sync',scopeid:'lo3rwang'});
  assert.ok(mcp.claims.grants.includes('lo3rwang:manage'));
  assert.ok(!token.grants.includes('lo3rwang:manage'));
});
test('LOC can transfer or revoke delegation without calling a provider or database',async()=>{
  const first=base();
  const valid=await verifier(first).verify('signed',{kind:'query'});
  assert.equal(valid.claims.sub,'principal1');
  const transferred={...first,sub:'principal2',sid:'delegation-456'};
  assert.equal((await verifier(transferred).verify('signed',{kind:'query'})).claims.sub,'principal2');
  await assert.rejects(verifier(first,{revoked:'delegation-123'}).verify('signed',{kind:'query'}),
    /revoked/);
  await assert.rejects(verifier(first,{revoked:'other, delegation-123; third'})
    .verify('signed',{kind:'query'}),/revoked/);
  await assert.rejects(verifier(first,{cutoff:String(first.iat+1)})
    .verify('signed',{kind:'query'}),/revoked/);
  await assert.rejects(verifier({...first,exp:first.iat+90000})
    .verify('signed',{kind:'query'}),/revoked/);
  assert.equal((await verifier(transferred,{revoked:'delegation-123'})
    .verify('signed',{kind:'query'})).claims.sub,'principal2');
});
test('LOC delegation fails closed for missing Scope grants, false ME and invalid email',async()=>{
  await assert.rejects(verifier(base(),{audience:'loc-mcp'}).verify('token',{kind:'mcp-read',scopeid:'lrunes'}));
  await assert.rejects(verifier({...base(),me:false}).verify('token',{kind:'query'}));
  await assert.rejects(verifier({...base(),email:'not-email'}).verify('token',{kind:'query'}));
  await assert.rejects(verifier({...base(),grants:['lo3rwang:read']},{audience:'loc-mcp'}).verify('token',
    {kind:'mcp-update-pr',scopeid:'lo3rwang'}));
});
