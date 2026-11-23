import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocAccountAdapter} from '../app/loc/auth/loc-browser.mjs';

test('LOC sign-in redirects to LAS Google OAuth without Cloudflare SSO',async()=>{
  const original=globalThis.window;
  const redirects=[];
  globalThis.window={location:{assign(url){redirects.push(url);}}};
  try{
    const {auth}=createLocAccountAdapter();
    const signedIn=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:'/admin/'}
    });
    assert.equal(signedIn.error,null);
    assert.equal(redirects[0],'https://auth.lo3rwang.cc/login?return_to=%2Fadmin%2F');
    const rejected=await auth.signInWithOAuth({
      provider:'cloudflare',options:{redirectTo:'/admin/'}
    });
    assert.ok(rejected.error);
    assert.equal(redirects.length,1);
    const external=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:'https://invalid.example/admin/'}
    });
    assert.equal(external.error,null);
    assert.equal(redirects[1],
      'https://auth.lo3rwang.cc/login?return_to=%2Flocal%2Fsettings%2F');
  }finally{
    if(original===undefined)delete globalThis.window;
    else globalThis.window=original;
  }
});

test('retired SSO package and client plugin are absent',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const adapter=readFileSync(new URL('../app/loc/auth/loc-browser.mjs',import.meta.url),'utf8');
  assert.equal(manifest.dependencies['@better-auth/sso'],undefined);
  assert.equal(lock.packages['node_modules/@better-auth/sso'],undefined);
  assert.equal(lock.packages[''].dependencies['@better-auth/sso'],undefined);
  assert.doesNotMatch(adapter,/@better-auth\/sso|signIn\.sso|cloudflare-access/);
});
