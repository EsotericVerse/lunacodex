import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocAuth,LOC_ISSUER} from '../workers/loc-authority/auth.mjs';
import locAuthWorker from '../workers/loc-authority/index.mjs';
import {oauthProviderAuthServerMetadata,oauthProviderOpenIdConfigMetadata} from '@better-auth/oauth-provider';

// Executed ONLY against a disposable PostgreSQL service in GitHub Actions.
// No production credentials, no Neon schema mutations or live user data.
const env={
 LOC_AUTH_SCHEMA_GENERATION:'1',
 LOC_AUTH_DATABASE_URL:'postgresql://loc_ci:loc_ci_only@127.0.0.1:5432/loc_auth_schema',
 BETTER_AUTH_SECRET:'disposable-integration-test-secret-not-a-production-key',
 LOC_GOOGLE_CLIENT_ID:'integration-test-client',
 LOC_GOOGLE_CLIENT_SECRET:'integration-test-secret'
};
const {auth,pool}=createLocAuth(env);
test.after(async()=>{await pool.end()});
test('discovery is served by the official OAuth Provider metadata handler',async()=>{
 const fetchAuth=oauthProviderAuthServerMetadata(auth);
 const res=await fetchAuth(new Request(LOC_ISSUER+'/.well-known/oauth-authorization-server'));
 assert.equal(res.status,200); 
 const meta=await res.json();
 assert.ok(meta.authorization_endpoint.endsWith('/oauth2/authorize'));
 assert.ok(meta.token_endpoint.endsWith('/oauth2/token'));
 assert.ok(meta.registration_endpoint.endsWith('/oauth2/register'));
 assert.equal(meta.issuer,LOC_ISSUER+'/api/auth');
});
test('official OIDC discovery includes the Google-backed LOC issuer',async()=>{
 const fetchOidc=oauthProviderOpenIdConfigMetadata(auth);
 const res=await fetchOidc(new Request(LOC_ISSUER+'/.well-known/openid-configuration'));
 assert.equal(res.status,200);
 const meta=await res.json();
 assert.equal(meta.issuer,LOC_ISSUER+'/api/auth');
 assert.ok(meta.jwks_uri.endsWith('/jwks'));
});
test('Better Auth JWT plugin persists and exposes a public JWKS',async()=>{
 const res=await auth.handler(new Request(LOC_ISSUER+'/api/auth/jwks'));
 assert.equal(res.status,200);
 const body=await res.json();
 assert.ok(Array.isArray(body.keys)&&body.keys.length>0);
 assert.ok(body.keys.every(key=>!key.d&&!key.p&&!key.q));
});
test('third-party public clients can self-register using official RFC 7591 DCR',async()=>{
 const res=await auth.handler(new Request(LOC_ISSUER+'/api/auth/oauth2/register',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({
    client_name:'LOC protocol integration',
    redirect_uris:['https://integration.example/callback'],
    token_endpoint_auth_method:'none',
    grant_types:['authorization_code','refresh_token'],
    response_types:['code']
  })
 }));
 assert.equal(res.status,201,'Dynamic registration must not need owner manual setup');
 const data=await res.json();
 assert.equal(typeof data.client_id,'string');
 assert.equal(data.token_endpoint_auth_method,'none');
 assert.ok(data.redirect_uris.includes('https://integration.example/callback'));
});
test('unauthenticated clients cannot mint LOC credentials without the authorization flow',async()=>{
 const res=await auth.handler(new Request(LOC_ISSUER+'/api/auth/oauth2/token',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:'grant_type=authorization_code&code=invalid&client_id=unregistered&redirect_uri=https%3A%2F%2Floc.lo3rwang.cc%2F'
 }));
 assert.ok(res.status===400||res.status===401);
});

test('untrusted app domains can exchange OAuth codes but cannot access Better Auth sessions',async()=>{
 const origin='https://external-client.example';
 const tokenCors=await locAuthWorker.fetch(new Request(LOC_ISSUER+'/api/auth/oauth2/token',{
  method:'OPTIONS',headers:{origin,'access-control-request-method':'POST'}
 }),env);
 assert.equal(tokenCors.status,204);
 assert.equal(tokenCors.headers.get('access-control-allow-origin'),'*');
 assert.equal(tokenCors.headers.get('access-control-allow-credentials'),null);
 const blocked=await locAuthWorker.fetch(new Request(LOC_ISSUER+'/api/auth/get-session',{
  method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}
 }),env);
 assert.equal(blocked.status,403);
});

test('all four LOC Auth core tables persist independently in PostgreSQL',async()=>{
  // CI-only database: no live Google accounts, website role rows or Neon Auth tables.
  const {adapter}=await auth.$context;
  const suffix=crypto.randomUUID().replaceAll('-','');
  const now=new Date();
  const userId='test-user-'+suffix;
  const rows=[
    {model:'user',data:{id:userId,name:'LOC Auth storage check',
      email:'loc-auth-'+suffix+'@example.invalid',emailVerified:true,
      createdAt:now,updatedAt:now}},
    {model:'session',data:{id:'test-session-'+suffix,
      userId,token:'loc-auth-test-token-'+suffix,
      expiresAt:new Date(now.getTime()+3600000),createdAt:now,updatedAt:now}},
    {model:'account',data:{id:'test-account-'+suffix,
      userId,providerId:'storage-test',accountId:'external-'+suffix,
      createdAt:now,updatedAt:now}},
    {model:'verification',data:{id:'test-verification-'+suffix,
      identifier:'test-'+suffix,value:'test-value-'+suffix,
      expiresAt:new Date(now.getTime()+3600000),createdAt:now,updatedAt:now}}
  ];
  const tableResult=await pool.query(
    "SELECT table_name FROM information_schema.tables "+
    "WHERE table_schema='loc_auth' AND table_name=ANY($1::text[])",
    [['user','session','account','verification']]);
  assert.deepEqual(tableResult.rows.map(row=>row.table_name).sort(),
    ['user','session','account','verification'].sort());
  // Auth users and website users are separate registries. The isolated Auth
  // test database deliberately has no LOC Web api.manage relation.
  const {rows:websiteRelations}=await pool.query(
    "SELECT to_regclass('api.manage') AS relation");
  assert.equal(websiteRelations[0]?.relation,null,
    'Auth must persist even when LOC Web api.manage does not exist');
  const written=[];
  try{
    for(const {model,data} of rows){
      await adapter.create({model,data,forceAllowId:true});
      written.push({model,id:data.id});
      const persisted=await pool.query(
        'SELECT id FROM "loc_auth"."'+model+'" WHERE id=$1',[data.id]);
      assert.equal(persisted.rows[0]?.id,data.id,
        model+' must be stored in LOC Auth PostgreSQL');
    }
    // Verify Better Auth can UPDATE a real user record using its own adapter.
    // This must never query or mutate LOC Web business-user permissions.
    const updateName='LOC Auth updated independently of LOC Web';
    const changed=await adapter.update({
      model:'user',where:[{field:'id',value:userId}],
      update:{name:updateName,updatedAt:new Date()}
    });
    assert.equal(changed?.name,updateName);
    const {rows:updated}=await pool.query(
      'SELECT name FROM "loc_auth"."user" WHERE id=$1',[userId]);
    assert.equal(updated[0]?.name,updateName,
      'Auth UPDATE must be durably readable from its own PostgreSQL schema');
  }finally{
    for(const {model,id} of written.reverse()){
      await adapter.delete({model,where:[{field:'id',value:id}]});
    }
  }
});
