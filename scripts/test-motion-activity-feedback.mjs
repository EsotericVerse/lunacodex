import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const parseComponent=path=>parse(read(path),{sourceType:'module',plugins:['jsx']});

test('new and updated motion components remain valid JSX',()=>{
  for(const path of [
    'app/modular/ActivityMotion.jsx',
    'app/modular/features/Trace.jsx',
    'app/modular/features/trace/TraceMap.jsx',
    'app/modular/features/trace/TraceTerritoryPanel.jsx',
    'app/modular/modules/culture-timeline/CultureTimeline.jsx',
    'app/modular/features/Search.jsx',
    'app/modular/features/Statistics.jsx',
    'app/loc/ManagementImportPanel.jsx',
    'app/loc/KeywordLibraryPanel.jsx',
    'app/modular/ManagementSectionNav.jsx'
  ])assert.ok(parseComponent(path).program.body.length>0,path);
});

test('vis-timeline river reveals on actual ready, without changing map geometry or data',()=>{
  const timeline=read('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  assert.match(timeline,/className='scope-river-reveal-shell'/);
  assert.match(timeline,/ready&&!reduceMotion\?<motion\.div className='scope-river-unfold-curtain'/);
  assert.match(timeline,/initial=\{\{scaleX:1\}\} animate=\{\{scaleX:0\}\}/);
  assert.match(timeline,/<div ref=\{containerRef\} data-anchor-gesture=/);
  assert.match(timeline,/instance\.destroy\(\)/);
  const css=read('app/styles/scope-system.css');
  assert.match(css,/\.scope-river-unfold-curtain\{/);
  assert.match(css,/pointer-events:none/);
});

test('map unfolds only after real MapLibre ready event, with one canvas at a time',()=>{
  const trace=read('app/modular/features/Trace.jsx');
  const territory=read('app/modular/features/trace/TraceTerritoryPanel.jsx');
  const map=read('app/modular/features/trace/TraceMap.jsx');
  assert.match(trace,/const \[readyMapMode,setReadyMapMode\]=useState\(''\)/);
  assert.match(trace,/readyMapMode===mapMode&&!reduceMotion/);
  assert.match(trace,/mapMode==='territory'\?<TraceTerritoryPanel scopeId=\{scopeId\} onMapReady=/);
  assert.match(trace,/<TraceMap publicTrace onReady=/);
  assert.match(trace,/<\/TraceMap>\}/);
  assert.match(territory,/onReady=\{onMapReady\}/);
  assert.match(map,/onReadyRef\.current\?\.\(\)/);
  assert.match(map,/if\(code==='ready'\)/);
  assert.doesNotMatch(trace,/<AnimatePresence/);
  const css=read('app/styles/loc-ui-refresh.css');
  assert.match(css,/\.loc-trace-map-unfold__leaf--left/);
  assert.match(css,/\.loc-trace-map-unfold__leaf--right/);
});

test('number wheels, hourglass, incoming packets and keyword glyphs animate only while mounted',()=>{
  const activity=read('app/modular/ActivityMotion.jsx');
  assert.match(activity,/useReducedMotion/);
  for(const kind of ['numbers','hourglass','import','keywords'])
    assert.match(activity,new RegExp("kind==='"+kind+"'"));
  assert.match(activity,/reduceMotion\?\{duration:0\}/);
  assert.match(activity,/repeat:Infinity/);
  assert.doesNotMatch(activity,/setInterval|setTimeout|fetch\(|useAsyncResource/);
  const style=read('app/styles/features.css');
  assert.match(style,/\.loc-work-activity__digit-window\{/);
  assert.match(style,/\.loc-work-activity--keywords\{/);
});

test('work animations use real pending states and preserve normal progress, no extra queries',()=>{
  const stats=read('app/modular/features/Statistics.jsx');
  assert.match(stats,/sourceRows\.isPending\|\|sourceCatalog\.isPending\|\|!adminSourceReady/);
  assert.match(stats,/統計中請稍後 <ActivityMotion kind="numbers"\/>/);
  assert.match(stats,/runeQuery\.isPending\?<p className="scope-status" role="status"><ActivityMotion kind="numbers"\/>/);

  const search=read('app/modular/features/Search.jsx');
  assert.match(search,/status==='搜尋中請稍後'\?<ActivityMotion kind="hourglass"\/>/);
  assert.match(search,/resultsRef\.current\?\.scrollIntoView/);

  const importer=read('app/loc/ManagementImportPanel.jsx');
  assert.match(importer,/busy&&!progress\?<p role="status"/);
  assert.match(importer,/busy\?<p className="scope-status"><ActivityMotion kind="import"\/>/);
  assert.match(importer,/className="scope-import-progress"/);
  assert.match(importer,/<progress value=\{progress\.percent\}/);

  const keywords=read('app/loc/KeywordLibraryPanel.jsx');
  assert.match(keywords,/busy&&!progress\?<p role="status"/);
  assert.match(keywords,/busy\?<ActivityMotion kind="keywords"\/>/);
  assert.match(keywords,/discoveryBusy\?<div className="scope-preview-links">/);
  assert.match(keywords,/role="status"><ActivityMotion kind="keywords"\/> 分析中/);
});
