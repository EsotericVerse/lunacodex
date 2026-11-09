import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('standalone LOC Auth login preserves the original scenic design',()=>{
  const page=read('public/login/index.html');
  const styles=read('public/login/appearance.css');
  for(const marker of ['class="auth-scene"','class="auth-surface"',
    "AUTHORITY='https://auth.lo3rwang.cc'","使用 Google 繼續",
    "使用 GitHub 繼續",
    'role="status" aria-live="polite"','oauthContinuation()'])
    assert.ok(page.includes(marker),marker);
  assert.match(styles,/\.loc-login-choice/);
  assert.match(styles,/@media\s*\(max-width:\s*760px\)/);
  assert.match(styles,/prefers-reduced-motion/);
  const script=page.split('<script type="module">')[1]?.split('</script>')[0];
  assert.ok(script);
  assert.doesNotThrow(()=>new Function(script));
});

test('desktop Settings sign-in and sign-out use the scenic LOC Auth gateway',()=>{
  const settings=read('app/loc/GlobalSettings.jsx');
  assert.ok(settings.includes("const LOC_LOGIN_GATEWAY='/login/index.html?return_to="));
  assert.ok(settings.includes('await account.signOut()'));
  assert.ok(settings.includes('window.location.assign(LOC_LOGIN_GATEWAY)'));
  assert.ok(settings.includes('function login()'));
});

test('Management and Admin failures redirect to scenic login and verify return',()=>{
  const management=read('app/loc/ManagementAccess.jsx');
  const admin=read('app/loc/views/AdminHomeView.jsx');
  const login=read('public/login/index.html');
  for(const gate of [management,admin]){
    assert.ok(gate.includes("window.location.replace('/login/index.html?return_to='"));
    assert.ok(gate.includes('editorSessionStatus(window.sessionStorage).expired'));
    assert.ok(gate.includes('loc-management-login-return-v1'));
  }
  assert.ok(management.includes('fromLogin&&result?.user&&granted(result.authorizer,scopeId,level)'));
  assert.ok(management.includes('verifyManagementEntry(fromLogin?account.refresh:check)'));
  assert.ok(admin.includes('if(!canManage||!entryVerified)'));
  assert.ok(login.includes('sessionStorage.setItem(LOGIN_RETURN_KEY,path)'));
  assert.doesNotMatch(management,/編輯 Session 已鎖定|重新確認管理權限/);
  assert.doesNotMatch(admin,/UI_COPY\.admin\.denied/);
});

test('original scenic white Theme 7 stays intact beside native LOC Chrome launcher',()=>{
  const page=read('public/login/index.html');
  const styles=read('public/login/appearance.css');
  const extension=read('extensions/loc-galaxy-link/options.html');
  const manifest=JSON.parse(read('extensions/loc-galaxy-link/manifest.json'));
  assert.ok(page.includes('<html lang="zh-Hant" data-theme-id="theme-7" data-theme="light">'));
  assert.ok(styles.includes(':root[data-theme-id="theme-7"]'));
  assert.ok(styles.includes('--loc-bg:#ffffff'));
  assert.ok(extension.includes('連接 LOC'));
  assert.equal(manifest.name,'LOC galaxy-link｜LOC 彩虹橋');
  assert.match(page,/new URL\('\/oauth\/login',AUTHORITY\)/);
});

test('owner can copy only immutable LOC Subject, never an OAuth token, to authorize recovery setup',()=>{
 const page=read('public/login/index.html');
 assert.match(page,/id="copy-loc-subject"/);
 assert.match(page,/navigator\.clipboard\.writeText\(subject\)/);
 assert.match(page,/byId\('copy-loc-subject'\)\.dataset\.subject=signedIn\?user\.id:''/);
 assert.doesNotMatch(page,/navigator\.clipboard\.writeText\(.*access_token/);
 const script=page.split('<script type="module">')[1]?.split('</script>')[0];
 assert.doesNotThrow(()=>new Function(script));
});

test('Google sign-in uses Better Auth callback on the existing LOC Auth domain',()=>{
 const worker=read('workers/loc-authority/native-oauth.mjs');
 const auth=read('workers/loc-authority/better-auth-native.mjs');
 const wrangler=read('workers/loc-authority/wrangler.jsonc');
 const login=read('public/login/index.html');
 assert.match(worker,/if\(name==='google'\)return googleViaBetter\(request,url,stub,env\)/);
 assert.match(worker,/\/oauth\/complete/);
 assert.match(auth,/socialProviders:\{google:/);
 assert.match(auth,/basePath:'\/api\/auth'/);
 assert.match(login,/\['google','使用 Google 繼續'\]/);
 assert.doesNotMatch(worker,/LOC_SUPABASE_|supabaseCallback|googleViaSupabase/);
 assert.doesNotMatch(wrangler,/LOC_SUPABASE_/);
});
