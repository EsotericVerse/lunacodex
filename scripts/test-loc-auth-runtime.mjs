import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocAuth,LOC_ISSUER} from '../workers/loc-authority/auth.mjs';
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
test('unauthenticated clients cannot mint LOC credentials without the authorization flow',async()=>{
 const res=await auth.handler(new Request(LOC_ISSUER+'/api/auth/oauth2/token',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:'grant_type=authorization_code&code=invalid&client_id=unregistered&redirect_uri=https%3A%2F%2Floc.lo3rwang.cc%2F'
 }));
 assert.ok(res.status===400||res.status===401);
});
