import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNativeOAuthPath} from '../workers/loc-authority/native-oauth.mjs';
import {directGoogleCallbackRedirect} from '../workers/loc-authority/better-auth-native.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC login is Google-first without any password UI or registration',()=>{
 const login=read('public/login/index.html');
 assert.match(login,/使用 Google 繼續/);
 assert.doesNotMatch(login,/id="loc-native-form"|native-password|native-signup-toggle|sign-up\/email|sign-in\/email/);
 assert.doesNotMatch(login,/LOC 不提供帳號註冊|LOC 不需要註冊或密碼/);
});
test('Better Auth is local to LOC; native MCP OAuth and SQL separation remain',()=>{
 const worker=read('workers/loc-authority/index.mjs');
 const auth=read('workers/loc-authority/better-auth-native.mjs');
 const native=read('workers/loc-authority/native-oauth.mjs');
 assert.match(worker,/handleFirstPartyAuth\(request,env\)/);
 assert.match(worker,/runBetterAuthStore\(this\.ctx\.storage,request\)/);
 assert.match(auth,/socialProviders:\{google:\{clientId,clientSecret/);
 assert.match(auth,/emailAndPassword:\{enabled:false\}/);
 assert.match(auth,/LOC password login and registration disabled/);
 assert.match(native,/googleViaBetter\(request,url,stub,env\)/);
 assert.match(native,/sessionFromBetter\(request,env,stub\)/);
 assert.match(native,/request\.headers\.get\('cf-connecting-ip'\)/);
 assert.match(native,/\.\.\.\(ip\?\{'cf-connecting-ip':ip\}:\{\}\)/);
 assert.match(native,/native-google-link/);
 assert.match(native,/export async function googleLocSubject/);
 assert.match(native,/Verified LOC registry management role required for import/);
 assert.match(native,/identity\.provider==='loc'&&identity\.emailVerified===true/);
 assert.match(native,/locRegistryRoles\(env,identity\.email\)/);
 assert.match(native,/!canLocRegistryManage\(roles,scope\)/);
 assert.doesNotMatch(native,/Google identity needs an existing signed LOC session link/);
 assert.doesNotMatch(native,/if\(name==='google'\)return googleViaSupabase/);
 for(const p of ['/oauth/login','/oauth/complete','/oauth/callback/oidc','/oauth/callback/github','/oauth/register'])
  assert.equal(isNativeOAuthPath(p),true,p);
});

test('direct Google callback without OAuth state opens the LOC login page',()=>{
 const request=new Request('https://auth.lo3rwang.cc/api/auth/callback/google');
 const response=directGoogleCallbackRedirect(request);
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),
  'https://loc.lo3rwang.cc/login/index.html?return_to=%2Flocal%2Fsettings%2F');
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('valid and failed Google OAuth callbacks still reach Better Auth unchanged',()=>{
 const base='https://auth.lo3rwang.cc/api/auth/callback/google';
 for(const suffix of ['?state=expected-state&code=authorization-code',
  '?error=access_denied&state=expected-state','?state=expected-state',
  '?code=authorization-code']){
  assert.equal(directGoogleCallbackRedirect(new Request(base+suffix)),null);
 }
 assert.equal(directGoogleCallbackRedirect(new Request(base,{method:'POST'})),null);
 assert.equal(directGoogleCallbackRedirect(
  new Request('https://auth.lo3rwang.cc/api/auth/callback/github')),null);
});
