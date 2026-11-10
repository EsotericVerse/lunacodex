import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSupabaseSecretLocAuth} from '../workers/loc-authority/supabase-secret-check.mjs';
import {testSupabaseSecretViaAuthority} from '../functions/api/loc-auth-connectivity.js';

const secret='sb_secret_example-test-only';
const env={LOC_SUPABASE_SECRET_KEY:secret,
 LOC_SUPABASE_AUTH_ORIGIN:'https://example.supabase.co/'};

test('server-only secret performs a bounded REST read in silver, without returning secrets',async()=>{
 let calls=0;
 const result=await checkSupabaseSecretLocAuth(env,{fetchImpl:async(url,options)=>{
  calls++;
  const u=new URL(url);
  assert.equal(u.pathname,'/rest/v1/loc_auth');
  assert.equal(u.searchParams.get('uid'),'eq.001');
  assert.equal(u.searchParams.get('limit'),'1');
  assert.equal(options.headers.apikey,secret);
  assert.equal(options.headers['Accept-Profile'],'silver');
  assert.equal(options.headers.Authorization,undefined);
  return Response.json([{uid:'001',email:'sopa2306@gmail.com',
   scopeid:'lo3rwang',role:'admin'}]);
 }});
 assert.equal(calls,1);
 assert.equal(result.ok,true);
 assert.ok(!JSON.stringify(result).includes(secret));
 assert.ok(!JSON.stringify(result).includes('sopa2306@gmail.com'));
});

test('Supabase Data API schema rejection is reported without leaking the key',async()=>{
 const result=await checkSupabaseSecretLocAuth(env,{fetchImpl:async()=>Response.json({
  code:'PGRST106',message:'The schema must be exposed with key '+secret
 },{status:406})});
 assert.equal(result.ok,false);
 assert.equal(result.code,'PGRST106');
 assert.equal(result.status,406);
 assert.ok(!JSON.stringify(result).includes(secret));
});

test('a fixed Cloudflare profile secret invokes only the trusted Auth diagnostic',async()=>{
 const token='backend-only-service-token-longer-than-32';
 const result=await testSupabaseSecretViaAuthority({
  LOC_DB_PROFILE_SERVICE_TOKEN:token
 },async(url,options)=>{
  assert.equal(url,'https://auth.lo3rwang.cc/v1/internal/supabase/loc-auth-test');
  assert.equal(options.headers['x-loc-service-token'],token);
  return Response.json({ok:true,source:'supabase-rest',status:200,
   rowMatched:true,emailMatched:true,secret:'never-return'});
 });
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.ok,true);
 assert.equal(data.secret,undefined);
});

test('missing API secret never invokes provider',async()=>{
 const result=await checkSupabaseSecretLocAuth({LOC_SUPABASE_AUTH_ORIGIN:env.LOC_SUPABASE_AUTH_ORIGIN},
 {fetchImpl:async()=>{throw Error('Unexpected provider call')}});
 assert.equal(result.code,'SECRET_NOT_CONFIGURED');
});
