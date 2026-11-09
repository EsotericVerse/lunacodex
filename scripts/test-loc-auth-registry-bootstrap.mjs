import test from 'node:test';
import assert from 'node:assert/strict';
import {locRegistryRoles,isLocRegistryAdmin,canLocRegistryManage}
 from '../workers/loc-authority/manage-role.mjs';

const env={
 LOC_DB_PROFILE_SERVICE_TOKEN:'a-trusted-test-service-token-with-enough-entropy',
 LOC_SUPABASE_AUTH_ORIGIN:'https://example.supabase.co',
 LOC_SUPABASE_PUBLIC_KEY:'sb_publishable_local_test'
};
const owner='owner@example.test';
const role=(email=owner)=>({id:'lo3rwang',email,manage_role:'admin',active:true});
const lookup=async({pages=503,rows=[role()],publicStatus=200}={})=>{
 const requests=[];
 const fetchImpl=async(input,init)=>{
  const url=new URL(String(input));
  requests.push({url,init});
  if(url.origin==='https://loc.lo3rwang.cc')
   return Response.json(pages===200?{rows:rows.map(r=>({
    id:r.id,email:r.email,role:r.manage_role,active:r.active
   }))}:{error:'backend-unavailable'},{status:pages});
  if(url.origin==='https://example.supabase.co')
   return Response.json(publicStatus===200?rows:{error:'unavailable'},
    {status:publicStatus});
  throw Error('Unrecognized service endpoint');
 };
 return {requests,roles:()=>locRegistryRoles(env,owner,{fetchImpl})};
};
test('verified LOC owner recovers api.manage roles when native Kysely profile is missing',async()=>{
 const q=await lookup();
 const roles=await q.roles();
 assert.deepEqual(roles,[{id:'lo3rwang',role:'admin'}]);
 assert.equal(isLocRegistryAdmin(roles),true);
 assert.equal(q.requests.length,2);
 assert.equal(q.requests[1].url.pathname,'/rest/v1/manage');
 assert.equal(q.requests[1].url.searchParams.get('select'),'id,email,manage_role,active');
 assert.equal(q.requests[1].url.searchParams.get('email'),'ilike.'+owner);
 assert.equal(q.requests[1].init.headers['accept-profile'],'api');
 assert.equal(q.requests[1].init.headers.apikey,env.LOC_SUPABASE_PUBLIC_KEY);
 assert.equal(q.requests[1].init.method,'GET');
});
test('a healthy trusted role lookup is never replaced by a public fallback',async()=>{
 const q=await lookup({pages:200});
 assert.equal(isLocRegistryAdmin(await q.roles()),true);
 assert.equal(q.requests.length,1);
});
test('service-token rejection never falls back to a public registry',async()=>{
 const q=await lookup({pages:403});
 await assert.rejects(q.roles(),/registry lookup failed \(403\)/);
 assert.equal(q.requests.length,1);
});
test('the public registry recovery does not manufacture a role for another email',async()=>{
 const q=await lookup({rows:[role('stranger@example.test'),{
  id:'lrunes',email:owner,manage_role:'scope',active:true
 },{
  id:'lo3rwang',email:owner,manage_role:'admin',active:false
 }]});
 const roles=await q.roles();
 assert.deepEqual(roles,[{id:'lrunes',role:'scope'}]);
 assert.equal(isLocRegistryAdmin(roles),false);
 assert.equal(canLocRegistryManage(roles,'lrunes'),true);
});
test('a failing public registry recovery denies owner authority',async()=>{
 const q=await lookup({publicStatus:401});
 await assert.rejects(q.roles(),/public registry recovery failed \(401\)/);
});
