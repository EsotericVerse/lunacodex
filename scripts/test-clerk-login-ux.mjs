import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('standalone Clerk login keeps the existing scenic design',()=>{
  const page=read('public/login/index.html');
  const styles=read('public/login/appearance.css');
  for(const marker of ['class="auth-scene"','class="auth-surface"',
    "colorPrimary:token('--loc-accent')",'localization:',
    "clerk.mountSignIn(byId('login-root'))",
    'role="status" aria-live="polite"','location.assign(path)'])
    assert.ok(page.includes(marker),marker);
  assert.match(styles,/#login-root\s+\.cl-cardBox/);
  assert.match(styles,/@media\s*\(max-width:\s*760px\)/);
  assert.match(styles,/prefers-reduced-motion/);
  const script=page.split('<script type="module">')[1]?.split('</script>')[0];
  assert.ok(script);
  assert.doesNotThrow(()=>new Function(script));
});

test('desktop Settings sign-in and sign-out use the scenic Clerk gateway',()=>{
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
