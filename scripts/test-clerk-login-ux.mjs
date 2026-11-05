import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('standalone Clerk login follows LOC Theme and remains mobile-safe',()=>{
  const page=readFileSync(new URL('../public/login/index.html',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../public/login/appearance.css',import.meta.url),'utf8');
  assert.match(page,/class="auth-scene"/);
  assert.match(page,/class="auth-surface"/);
  assert.match(page,/colorPrimary:token\('--loc-accent'\)/);
  assert.match(page,/localization:/);
  assert.match(styles,/#login-root\s+\.cl-cardBox/);
  assert.match(styles,/@media\s*\(max-width:\s*760px\)/);
  assert.match(styles,/prefers-reduced-motion/);
  assert.match(page,/clerk\.mountSignIn\(byId\('login-root'\)\)/);
  assert.match(page,/location\.assign\(path\)/);
  assert.match(page,/sessionStorage\.setItem\(LOGIN_RETURN_KEY,path\)/);
  assert.match(page,/role="status" aria-live="polite"/);
  const loginScript=page.split('<script type="module">')[1]?.split('</script>')[0];
  assert.ok(loginScript);
  assert.doesNotThrow(()=>new Function(loginScript));
});

test('desktop settings sign-in and sign-out show the same scenic Clerk gateway',()=>{
  const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
  assert.match(settings,/LOC_LOGIN_GATEWAY='\\/login\\/index\\.html\\?return_to=/);
  assert.match(settings,/await account\\.signOut\\(\\);[\\s\\S]*window\\.location\\.assign\\(LOC_LOGIN_GATEWAY\\)/);
  assert.match(settings,/function login\\(\\)[\\s\\S]*window\\.location\\.assign\\(LOC_LOGIN_GATEWAY\\)/);
});

test('protected Management and Admin entries use scenic login and verify on return',()=>{
  const management=readFileSync(new URL('../app/loc/ManagementAccess.jsx',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../app/loc/views/AdminHomeView.jsx',import.meta.url),'utf8');
  for(const gate of [management,admin]){
    assert.match(gate,/window\\.location\\.replace\\('\/login\/index\\.html\\?return_to='/);
    assert.match(gate,/editorSessionStatus\\(window\\.sessionStorage\\)\\.expired/);
    assert.match(gate,/loc-management-login-return-v1/);
  }
  assert.match(management,/fromLogin&&result\\?\\.user&&granted\\(result\\.authorizer,scopeId,level\\)/);
  assert.match(admin,/!canManage\\|\\|!entryVerified/);
  assert.doesNotMatch(management,/編輯 Session 已鎖定|重新確認管理權限/);
  assert.doesNotMatch(admin,/UI_COPY\\.admin\\.denied/);
});
