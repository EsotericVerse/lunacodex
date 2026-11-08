// Post-deployment, unauthenticated protocol check. This never exchanges
// credentials, registers an identity or reads any private state.
import assert from 'node:assert/strict';

const ORIGIN='https://auth.lo3rwang.cc';
const timeout=AbortSignal.timeout(12000);
async function get(path){
  const res=await fetch(ORIGIN+path,{method:'GET',redirect:'error',
    cache:'no-store',headers:{accept:'application/json'},signal:timeout});
  assert.equal(res.status,200,path+' must respond 200, got '+res.status);
  const type=res.headers.get('content-type')||'';
  assert.ok(type.toLowerCase().includes('application/json'),path+' must return JSON');
  return res.json();
}
// POST only a fixed dummy payload: no account can be created or accessed.
for(const path of ['/api/auth/sign-up/email','/api/auth/sign-in/email',
 '/api/auth/reset-password']){
 const blocked=await fetch(ORIGIN+path,{
  method:'POST',redirect:'error',cache:'no-store',
  headers:{'content-type':'application/json'},
  body:'{}',signal:AbortSignal.timeout(12000)
 });
 assert.equal(blocked.status,410,path+' must be permanently disabled');
}
const discovery=await get('/.well-known/oauth-authorization-server');
assert.equal(discovery.issuer,ORIGIN);
assert.equal(discovery.authorization_endpoint,ORIGIN+'/oauth/authorize');
assert.equal(discovery.token_endpoint,ORIGIN+'/oauth/token');
assert.deepEqual(discovery.code_challenge_methods_supported,['S256']);
assert.equal(discovery.jwks_uri,ORIGIN+'/.well-known/jwks.json');
const jwks=await get('/.well-known/jwks.json');
assert.ok(Array.isArray(jwks.keys)&&jwks.keys.some(x=>x.alg==='RS256'&&x.kty==='RSA'),
  'LOC native signing keys must be published');
const guest=await get('/v1/auth/session');
assert.equal(guest.session,null,'anonymous visitors must not be authenticated');
console.log('LOC OAuth only: password endpoints retired; discovery, JWKS and anonymous session verified.');
