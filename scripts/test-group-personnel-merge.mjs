import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Group owns the single personnel management entry, with admin-only advanced controls',()=>{
  const group=read('app/loc/LocSourceManagement.jsx');
  const admin=read('app/loc/views/AdminHomeView.jsx');
  assert.match(group,/value:'members',label:'人員'/);
  assert.match(group,/value:'systemPersonnel',label:'系統人員配置'/);
  assert.match(group,/const sections=isSystemAdmin\?\[\.\.\.OPTIONS,SYSTEM_PERSONNEL_OPTION\]:OPTIONS/);
  assert.match(group,/section==='members'\?<LocGroupMemberList groupId="loc"\/>/);
  assert.match(group,/section==='systemPersonnel'&&isSystemAdmin\?<AdminRegistry\/>:null/);
  assert.doesNotMatch(admin,/value:'registry',label:'人員'/);
  assert.doesNotMatch(admin,/<AdminRegistry\/>/);
  assert.match(admin,/registry:'lists'/);
  assert.match(admin,/<AdminReservedScopeIds\/>/);
});

test('Group editor hides global system destination without fetching authorization again',()=>{
  const shell=read('app/AppShell.jsx');
  const gate=read('app/loc/ManagementAccess.jsx');
  const dock=read('app/modular/edit-dock.jsx');
  const css=read('app/styles/bottom-navigation.css');
  assert.match(gate,/globalManage:Boolean\(verification\.authorizer\?\.canManageGlobalSync\(\)\)/);
  assert.match(dock,/canManageGlobal,hasSave,busy/);
  assert.match(shell,/editDock\?\.canManageGlobal\?\[\{id:'system'/);
  assert.match(shell,/data-action-count=\{editingDockVisible\?editTabs\.length:6\}/);
  assert.match(css,/data-action-count="5"/);
});
