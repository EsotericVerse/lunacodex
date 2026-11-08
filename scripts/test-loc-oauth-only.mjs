import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNativeOAuthPath} from '../workers/loc-authority/native-oauth.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC only offers OAuth links, not registration or a password',()=>{
 const login=read('public/login/index.html');
 assert.match(login,/使用 Google 繼續/);
 assert.match(login,/使用 GitHub 繼續/);
 assert.doesNotMatch(login,/id="loc-native-form"|native-password|native-signup-toggle|sign-up\/email|sign-in\/email/);
 assert.doesNotMatch(login,/LOC 不提供帳號註冊|LOC 不需要註冊或密碼/);
});
test('LOC Worker refuses legacy password endpoints; MCP OAuth client registration remains',()=>{
 const worker=read('workers/loc-authority/index.mjs');
 assert.match(worker,/target\.pathname\.startsWith\('\/api\/auth\/'\)/);
 assert.match(worker,/Google or GitHub OAuth login'\},410/);
 assert.doesNotMatch(worker,/runBetterAuthStore|handleFirstPartyAuth|betterAuthStorage/);
 const oauth=read('workers/loc-authority/native-oauth.mjs');
 assert.doesNotMatch(oauth,/better-auth-native|firstPartySession|sessionFromBetter|hasFirstPartyCookie/);
 for(const p of ['/oauth/login','/oauth/callback/oidc','/oauth/callback/github','/oauth/register'])
  assert.equal(isNativeOAuthPath(p),true,p);
});
