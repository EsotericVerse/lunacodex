import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Cancel revokes the Dock before document navigation and cannot re-enter',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const access=read('app/loc/management/ManagementAccess.jsx');
  const shell=read('app/AppShell.jsx');
  assert.match(dock,/const \[exiting,setExiting\]=useState\(false\)/);
  assert.match(dock,/if\(!idText\|\|idText!==scopeId\|\|exiting\)return false/);
  assert.match(dock,/const discard=useCallback\(target=>\{[\s\S]*?setExiting\(true\);\s*end\(\);[\s\S]*?window\.location\.replace\(destination\.href\)/);
  assert.match(access,/if\(!allowed\|\|entered\|\|dock\?\.exiting\)return/);
  assert.match(shell,/editDock\.discard\(navigationHref\(navScopeId,isFeatureEditMode\?featureEditReturn:''/);
});

test('Cancel remains a discard-only action; Save is the only write action',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const discard=dock.split('const discard=useCallback(')[1]?.split('const switchTo=useCallback(')[0];
  assert.ok(discard);
  assert.doesNotMatch(discard,/transactionWrites|managedTransaction|\.save\(|commit\(/);
  assert.match(discard,/window\.location\.replace\(destination\.href\)/);
  const save=dock.split('const save=useCallback(')[1]?.split('const discard=useCallback(')[0];
  assert.ok(save);
  assert.match(save,/transactionWrites/);
});
