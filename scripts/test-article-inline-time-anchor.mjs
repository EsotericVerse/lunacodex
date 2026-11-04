import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('app/modular/ui.jsx');
const action=read('app/modular/ArticleTimeAnchorAction.jsx');

test('time-anchor action lives in the shared article detail Time section',()=>{
  assert.match(ui,/const ArticleTimeAnchorAction=dynamic\(/);
  assert.match(ui,/\{detailReading\?<ArticleRelationNavigation/);
  assert.match(ui,/<h3>時間<\/h3>/);
  assert.match(ui,/row\('定錨',<>/);
  assert.match(ui,/<ArticleTimeAnchorAction\s+scopeId=\{scope\} date=\{day\}/);
  assert.match(ui,/const day=String\(articleDate\|\|''\)\.slice\(0,10\)/);
});

test('action verifies Clerk Scope management on click and preserves guest reading',()=>{
  assert.match(action,/useAccount\(\{enabled:false\}\)/);
  assert.match(action,/const begin=async\(\)=>\{/);
  assert.match(action,/account\.refresh\(\{forceVerify:true\}\)/);
  assert.match(action,/verified\?\.authorizer\?\.canManageScopeSync\(scopeId\)/);
  assert.match(action,/setOpen\(true\)/);
});

test('new Time anchor uses article date, checks duplicates, saves description, and returns to reading',()=>{
  assert.match(action,/filters:\[\{column:'type',operator:'eq',value:'anchor'\},\{column:'address',operator:'eq',value:date\}\]/);
  assert.match(action,/const details=description\.trim\(\)/);
  assert.match(action,/const uid=allocateTimeUid\(\)/);
  assert.doesNotMatch(action,/readUnifiedAnchorUids|selectAllRowsBounded/);
  assert.match(action,/const record=\{uid,type:'anchor',title:chosen\?\.title\|\|date,description:details,/);
  assert.match(action,/address:date,anchor_ids:null,invisible:false/);
  assert.match(action,/await insertRows\(table,\[record\]\)/);
  assert.match(action,/setOpen\(false\)/);
  assert.doesNotMatch(action,/create_at|createtime|created_at/);
});

test('expired editor sessions require verified Clerk Scope grant before renewal',()=>{
  assert.match(action,/from '\.\.\/loc\/edit-session-ttl\.mjs'/);
  assert.match(action,/editorSessionStatus\(window\.sessionStorage\)\.expired/);
  assert.match(action,/clearEditorSession\(window\.sessionStorage\)/);
  assert.match(action,/touchEditorSession\(window\.sessionStorage\)/);
  const begin=action.slice(action.indexOf('const begin=async'),action.indexOf('const save=async'));
  assert.ok(begin.indexOf('canManageScopeSync(scopeId)')<
    begin.indexOf('clearEditorSession(window.sessionStorage)'));
  const save=action.slice(action.indexOf('const save=async'));
  assert.ok(save.indexOf('canManageScopeSync(scopeId)')<
    save.indexOf('clearEditorSession(window.sessionStorage)'));
});
test('article without an anchor shows anniversary hint and reuses supplied candidate',()=>{
  assert.match(ui,/anniversarySuggestions=activeAnchors\.length\?\[\]:/);
  assert.match(ui,/符合週年／生日/);
  assert.match(ui,/新增週年定錨/);
  assert.match(ui,/suggestions=\{anniversarySuggestions\}/);
  assert.match(action,/const provided=Array\.isArray\(suggestions\)/);
  assert.match(action,/setDescription\(provided\[0\]\?\.title\|\|''\)/);
  assert.match(action,/title:chosen\?\.title\|\|date/);
});
