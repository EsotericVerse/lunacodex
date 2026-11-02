import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Four spatial tasks live in first-level management; no nested classification',()=>{
  const source=read('app/loc/PlaceManagement.jsx');
  const parent=read('app/loc/ScopeManagement.jsx');
  for(const label of ['空間定錨點','名稱整理','Timeline 地點整理','快速補打卡'])
    assert.ok(source.includes(label),label);
  assert.match(parent,/\.\.\.PLACE_OPTIONS\.filter/);
  assert.match(parent,/:PLACE_OPTIONS;/);
  assert.match(parent,/PLACE_KEYS\.has\(section\)\?<PlaceManagement scopeId=\{routeScopeId\} section=\{section\}/);
  assert.match(source,/section==='anchor'\?<TraceManagement scopeId=\{scopeId\} mode="anchor"/);
  assert.match(source,/section==='names'\?<TraceManagement scopeId=\{scopeId\} mode="cleanup"/);
  assert.match(source,/section==='timeline'\?<TimelinePlaceManager/);
  assert.match(source,/section==='quickFill'\?<PlaceBatchFill/);
  assert.doesNotMatch(source,/ManagementSectionNav|useState|<details/);
  assert.doesNotMatch(parent,/value:'placeManage'/);
});
test('Spatial task switching protects pending edits via the existing dock',()=>{
  const parent=read('app/loc/ScopeManagement.jsx');
  assert.match(parent,/editDock\.switchSection\(next,setSection\)/);
  assert.match(parent,/aria-labelledby=\{'scope-sections-option-'\+selectedOption\.value\}/);
  assert.match(parent,/ManagementSectionNav id="scope-sections"/);
  assert.match(parent,/\{traceAnchor:'anchor',placeManage:'anchor'\}/);
});
test('Top-level navigation keeps accessible focus and responsive theme styles',()=>{
  const css=read('app/styles/settings-select.css');
  assert.match(css,/\.management-section-nav__items/);
  assert.match(css,/\.management-section-nav__item\[aria-pressed="true"\]/);
  assert.match(css,/\.management-section-nav__item:focus-visible/);
});

test('Timeline analysis is isolated from initial management entry',()=>{
  const source=read('app/loc/PlaceManagement.jsx');
  // Timeline must be bundled with the management page. Loading its chunk
  // only after selecting the tab can show a 404 instead of the review panel.
  assert.match(source,/^import TimelinePlaceManager from '\.\/TimelinePlaceManager';/m);
  assert.doesNotMatch(source,/dynamic\(\(\)=>import\('\.\/TimelinePlaceManager'/);
  assert.doesNotMatch(source,/recoverChunkOnce/);
  const editor=read('app/loc/TraceManagement.jsx');
  assert.match(editor,/\{mapOpen\?<TraceMap/);
  assert.match(editor,/onClick=\{\(\)=>setMapOpen\(open=>!open\)\}/);
});

test('Service Worker never reuses stale management HTML after a deploy',()=>{
  const sw=read('public/sw.js');
  const self={location:{origin:'https://loc.example'},addEventListener(){}};
  const isPublicHtml=Function('self',sw+'\nreturn isPublicHtml')(self);
  const url=pathname=>({origin:self.location.origin,pathname,search:'',searchParams:new URLSearchParams()});
  const request={mode:'navigate'};
  assert.equal(isPublicHtml(request,url('/lo3rwang/manage/')),false);
  assert.equal(isPublicHtml(request,url('/lo3rwang/manage/search/')),false);
  assert.equal(isPublicHtml(request,url('/lrunes/manage/')),false);
  assert.equal(isPublicHtml(request,url('/lo3rwang/culture/')),true);
});

test('Timeline opens with the configured Auth SDK rather than the query-only database adapter',()=>{
  const timeline=read('app/loc/TimelinePlaceManager.jsx');
  const db=read('app/loc/db-client.mjs');
  const provider=read('app/loc/providers/supabase.mjs');
  const place=read('app/loc/PlaceManagement.jsx');
  assert.match(timeline,/import \{dbAuthClient,dbAuthEvents\} from '\.\/db-client\.mjs';/);
  assert.match(timeline,/dbAuthEvents\.getUser\(\)\.then\(\(\{data\}\)=>\{/);
  assert.doesNotMatch(timeline,/dbAuthClient\.auth/);
  assert.match(db,/export const dbAuthEvents=adapter\.auth;/);
  assert.match(provider,/auth:authenticatedSdk\.auth/);
  assert.match(place,/section==='timeline'\?<TimelinePlaceManager/);
});
