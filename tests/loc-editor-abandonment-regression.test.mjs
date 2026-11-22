import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEraRiver} from '../app/loc/culture/time-trace-river.mjs';
import {traceRouteHierarchy} from '../app/modular/features/trace/trace-route-hierarchy.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('BlockNote abandons asynchronous HTML work and releases its ProseMirror editor on exit',()=>{
  const editor=source('app/loc/editor/BlockNoteEditorClient.jsx');
  assert.match(editor,/mountedRef\.current=false/);
  assert.match(editor,/htmlEmitVersion\.current\+\+/);
  assert.match(editor,/epoch===editorEpoch\.current/);
  assert.match(editor,/tiptap\.destroy\?\.\(\)/);
  const drafts=source('app/loc/blocks/ScopeBlockDraftList.jsx');
  assert.doesNotMatch(drafts,/localStorage|sessionStorage|indexedDB/);
});

test('management section change abandons the old editors and transient reads',()=>{
  const sections=source('app/modular/ManagementSectionNav.jsx');
  const dock=source('app/modular/edit-dock.jsx');
  assert.match(sections,/prepareTransientResourceAction\('management'\)/);
  assert.match(dock,/const switchSection=useCallback/);
  assert.match(dock,/clearEditor\(\);setNotice\(''\)/);
  assert.match(dock,/registeredEditors\.current\.clear\(\)/);
});

test('homepage six-key navigation retires old reads before full-document managers',()=>{
  const dock=source('app/modular/edit-dock.jsx');
  const resources=source('packages/zenstack/client-queries.js');
  // A static management entrypoint has no React route-key transition.
  assert.match(dock,/const documentExit=url\.origin/);
  assert.match(dock,/isManagementHref\(url\.href\)/);
  assert.match(dock,/releaseTransientPageResources\(\{documentExit\}\);[\s\S]*?window\.location\.assign\(url\.href\)/);
  assert.match(dock,/releaseTransientPageResources\(\{documentExit:true\}\);[\s\S]*?window\.location\.assign\(destination\.href\)/);
  assert.match(resources,/export function releaseTransientPageResources\(\{documentExit=false\}=\{\}\)/);
  assert.match(resources,/cancelTransientReads\(\);\s*abortInflight\(\);/);
  assert.match(resources,/if\(!documentExit&&retryBootstrap\.size\)/,
    'full-document exit must not queue bootstrap re-reads on old page');
  // Navigation cleanup is explicitly not a write or a Session revocation.
  const navigate=dock.slice(dock.indexOf('const navigate='),dock.indexOf('const complete='));
  assert.doesNotMatch(navigate,/transactionWrites\(|clearEditorSession\(/);
});

test('Culture orders Era > Period > Date anchors, then the next Era',()=>{
  const scope='lo3rwang',a='AAAA0001',b='BBBB0001';
  const records=[
    {uid:a,entry_type:'era',scope_id:scope,title:'Era 1',anchor_ids:['PPPP0001'],
      ranges:[{start_date:'2000-01-01',end_date:'2010-12-31'}]},
    {uid:'PPPP0001',entry_type:'period',scope_id:scope,title:'Period 1',
      ranges:[{start_date:'2001-01-01',end_date:'2009-12-31'}]},
    {uid:'DDDD0001',entry_type:'anchor',scope_id:scope,title:'Date 1',
      start_date:'2005-01-01'},
    {uid:b,entry_type:'era',scope_id:scope,title:'Era 2',anchor_ids:[],
      ranges:[{start_date:'2011-01-01',end_date:'2020-12-31'}]},
    {uid:'DDDD0002',entry_type:'anchor',scope_id:scope,title:'Unassigned',
      start_date:'2024-01-01'}
  ];
  const first='trace:'+scope+':'+a;
  const second='trace:'+scope+':'+b;
  const periodId=first+':period:PPPP0001';
  for(const editorOnly of [true,false]){
    const expanded=editorOnly?[first,periodId,second]:[first,second];
    const river=buildEraRiver(records,expanded,{editorOnly,scopeId:scope});
    const ordered=river.groups.map(row=>row.id);
    const era=ordered.indexOf(first);
    const period=ordered.findIndex(id=>id.includes('PPPP0001'));
    const date=ordered.findIndex(id=>id.includes('anchors:')||
      id.endsWith(':anchors')||id.endsWith(':dates'));
    const nextEra=ordered.indexOf(second);
    assert.ok(era>=0&&era<period&&period<date&&date<nextEra,
      'must sort Era, its Period, its Date anchor group, then next Era');
    assert.ok(river.groups.some(row=>row.id==='time-undefined:'+scope));
  }
});

test('Trace selection is authored parent-child relation, not flattened mixed routes',()=>{
  const scope='lo3rwang',trace={uid:'TTTT0001',source_scope:scope,
    trace_type:'trace',title:'Trace',route_list:{routes:['PPPP0001']}};
  const path={uid:'PPPP0001',source_scope:scope,trace_type:'path',title:'Path'};
  const hierarchy=traceRouteHierarchy([path,trace]);
  assert.equal(hierarchy.groups.length,1);
  assert.deepEqual(hierarchy.groups[0].paths,[path]);
  assert.equal(hierarchy.orphans.length,0);
  const preview=source('app/modular/features/LocTracePreview.jsx');
  assert.match(preview,/aria-label="痕跡圖選擇"/);
  assert.match(preview,/aria-label="所屬路徑圖選擇"/);
});
