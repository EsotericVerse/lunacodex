import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  configureDbSourceLabels,getDbSourceStatus,
  isDatabaseConnectivityFailure,markPrimaryReadFailed,markPrimaryReadSucceeded
} from '../app/loc/db-source-status.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('RLS, SQL schema errors and search QoS never mark the public database offline',()=>{
  for(const error of [
    {status:403,code:'42501',message:'permission denied'},
    {status:400,code:'42703',message:'undefined column'},
    {status:500,code:'42703',message:'query compilation error'},
    {status:429,code:'SEARCH_RATE_LIMIT',message:'rate limited'}
  ])assert.equal(isDatabaseConnectivityFailure(error),false,JSON.stringify(error));
  for(const error of [
    new TypeError('Failed to fetch'),{name:'TimeoutError'},
    {status:503,message:'gateway unavailable'},
    {code:'08006',message:'connection failure'}
  ])assert.equal(isDatabaseConnectivityFailure(error),true,String(error.message));
});

test('one healthy SELECT clears a stale source-wide red Footer state',()=>{
  configureDbSourceLabels('Supabase','');
  markPrimaryReadFailed('silver.loc',new Error('network unavailable'));
  assert.equal(getDbSourceStatus().unavailable,true);
  markPrimaryReadSucceeded('silver.lo3rwang_galaxy');
  assert.equal(getDbSourceStatus().unavailable,false);
  assert.deepEqual(getDbSourceStatus().failingResources,[]);
});

test('ordinary authenticated navigation batches three preferences into one SELECT',()=>{
  const nav=read('app/loc/use-navigation-preferences.js');
  const storage=read('app/loc/user-storage.js');
  assert.match(nav,/getSettings\(keys\)/);
  assert.doesNotMatch(nav,/Promise\.all\(\[getSetting\(/);
  assert.match(storage,/export async function getSettings\(/);
  assert.match(storage,/\.in\('setting_key',names\)/);
});

test('protected management does not flash ordinary dock and never alters RLS',()=>{
  const shell=read('app/AppShell.jsx');
  const gate=read('app/loc/ManagementAccess.jsx');
  const admin=read('app/loc/views/AdminHomeView.jsx');
  assert.match(shell,/editDockPending\?<span role="status"/);
  assert.match(shell,/readHomeEditorAccess\(window\.sessionStorage\)/);
  assert.match(gate,/loc-management-entry-denied/);
  assert.match(admin,/loc-management-entry-denied/);
  const footer=read('app/loc/db-query.mjs');
  assert.match(footer,/if\(isDatabaseConnectivityFailure\(error\)\)markPrimaryReadFailed/);
});
