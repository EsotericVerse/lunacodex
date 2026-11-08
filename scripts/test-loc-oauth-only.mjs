import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNativeOAuthPath} from '../workers/loc-authority/native-oauth.mjs';
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
 assert.match(auth,/\/api\/auth\/(?:sign-up/);
 assert.match(native,/googleViaBetter\(request,url,stub,env\)/);
 assert.match(native,/sessionFromBetter\(request,env,stub\)/);
 assert.match(native,/native-google-link/);
 assert.doesNotMatch(native,/if\(name==='google'\)return googleViaSupabase/);
 for(const p of ['/oauth/login','/oauth/complete','/oauth/callback/oidc','/oauth/callback/github','/oauth/register'])
  assert.equal(isNativeOAuthPath(p),true,p);
});
