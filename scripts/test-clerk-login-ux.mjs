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
  assert.match(page,/location\.assign\(validReturnPath\(\)\)/);
  assert.match(page,/role="status" aria-live="polite"/);
  const loginScript=page.split('<script type="module">')[1]?.split('</script>')[0];
  assert.ok(loginScript);
  assert.doesNotThrow(()=>new Function(loginScript));
});
