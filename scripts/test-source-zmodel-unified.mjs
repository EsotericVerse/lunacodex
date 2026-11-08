import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sourceTaxonomyFromCatalog,sourceTreeFromCatalog,sourceLabelMatchesSite} from '../app/loc/source-classification.mjs';
import {publishedSourceTaxonomy,publishedSourceCategoryCatalog,PUBLISHED_SOURCE_DOMAINS} from '../app/modular/published-source-taxonomy.js';
import {administrativeSourceTrend} from '../app/loc/statistics-admin-source.mjs';

const source=readFileSync(new URL('../app/loc/views/CulturePublicReader.jsx',import.meta.url),'utf8');
const start=source.indexOf('function sourceModel(');
const end=source.indexOf('async function analytics(',start);
assert.ok(start>=0&&end>start,'Culture Source renderer must be present');
const sourceModel=vm.runInNewContext(`(() => {
  const list=value=>Array.isArray(value)?value:[];
  ${source.slice(start,end)}
  return sourceModel;
})()`,{sourceLabelMatchesSite});
const names=['Facebook','Threads','Instagram'];
const entries=[
  {uid:'e62b0fc7',name:'suno',label:'suno'},
  {uid:'47dc42c2',name:'kkcity',label:'kkcity'},
  {uid:'2e6241eb',name:'others',label:'其他'},
  {uid:'8c55398d',name:'vocus',label:'方格子vocus'},
  {uid:'d7a85670',name:'ptt',label:'ptt'},
  {uid:'69dcacc1',name:'wretch',label:'無名wretch'},
  {uid:'1ae7168c',name:'pixnet',label:'pixnet'}
];
const published=publishedSourceTaxonomy('lo3rwang');
const row=key=>published.tree.find(node=>node.key===key);
const from=name=>published.tree.find(node=>node.type==='from'&&node.name===name);
const domain=name=>published.tree.find(node=>node.type==='domain'&&node.name===name);

test('Source hierarchy uses EXACT loc → loc → Default/lo3rwang → From',()=>{
  const [universe,galaxy]=published.tree;
  assert.deepEqual([universe.type,universe.name,galaxy.type,galaxy.name],
    ['universe','loc','galaxy','loc']);
  assert.equal(galaxy.parent,universe.key);
  const defaultDomain=domain('Default'),scopeDomain=domain('lo3rwang');
  assert.ok(defaultDomain&&scopeDomain);
  assert.equal(defaultDomain.parent,galaxy.key);
  assert.equal(scopeDomain.parent,galaxy.key);
  for(const name of names){
    assert.equal(from(name).parent,defaultDomain.key);
    assert.equal(from(name).uid,undefined,'System From must not invent a physical UID');
  }
  assert.equal(defaultDomain.uid,undefined);
  assert.equal(scopeDomain.uid,'5dfdb539');
  assert.equal(PUBLISHED_SOURCE_DOMAINS.lo3rwang,'5dfdb539');
  assert.equal(from('kkcity').uid,'47dc42c2');
  assert.equal(from('kkcity').parent,scopeDomain.key);
  assert.equal(row(scopeDomain.parent),galaxy);
  assert.equal(published.tree.filter(node=>node.type==='domain').length,2);
  assert.equal(published.tree.filter(node=>node.type==='from').length,10);
});

test('rebuild from authenticated catalog preserves physical UIDs and display labels',()=>{
  const recomputed=sourceTaxonomyFromCatalog(names,entries,{
    scopeId:'lo3rwang',domainUid:'5dfdb539'
  });
  assert.deepEqual(recomputed.tree,published.tree);
  assert.equal(recomputed.groups.find(group=>group.group_code==='vocus').display_name,
    '方格子vocus');
  assert.equal(recomputed.groupAliases.find(row=>row.source_key==='kkcity').group_code,
    'kkcity');
  assert.equal(recomputed.categories.find(x=>x.category_code==='facebook').display_name,
    'Facebook');
  assert.equal(publishedSourceCategoryCatalog('lo3rwang').aliases.length,10);
  const other=publishedSourceTaxonomy('lrunes');
  assert.ok(other.tree.some(node=>node.type==='domain'&&node.name==='lrunes'&&
    node.uid==='9d3452a3'));
  assert.ok(!other.tree.some(node=>node.type==='from'&&node.name==='kkcity'));
});

test('domain grouping in Culture counts Galaxy.site rows, never Source Anchor UIDs',()=>{
  const counts=[
    {day:'2026-11-01',site:'Facebook',item_count:4},
    {day:'2026-11-01',site:'Threads',item_count:3},
    {day:'2026-11-01',site:'kkcity',item_count:9},
    {day:'2026-11-02',site:'kkcity',item_count:2},
    {day:'2026-11-01',site:'not-yet-catalogued',item_count:5}
  ];
  const startDate='2026-11-01',endDate='2026-11-02';
  const model=sourceModel(counts,published,[],startDate,endDate);
  const groups=Array.from(model.groups);
  const def=groups.find(node=>node.id==='root:'+domain('Default').key);
  const own=groups.find(node=>node.id==='root:'+domain('lo3rwang').key);
  assert.ok(def&&own);
  assert.match(def.label,/Default \(7\)/);
  assert.match(own.label,/lo3rwang \(11\)/);
  assert.ok(groups.some(node=>node.label==='未分類 (5)'));
  const open=sourceModel(counts,published,[domain('lo3rwang').key],
    startDate,endDate);
  const kkcity=Array.from(open.sites).find(item=>item.site==='kkcity');
  assert.equal(kkcity.count,11);
  assert.ok(open.items.some(item=>item.entry_type==='source'&&
    item.title.includes('kkcity')));
});

test('Statistics totals still derive from Galaxy site aggregates and are unchanged by UID',()=>{
  const raw=[
    {day:'2026-11-01',kind:'total',category:'文字作品',item_count:16},
    {day:'2026-11-01',kind:'source',category:'Facebook',item_count:4},
    {day:'2026-11-01',kind:'source',category:'Threads',item_count:3},
    {day:'2026-11-01',kind:'source',category:'kkcity',item_count:9}
  ];
  const taxonomy=publishedSourceCategoryCatalog('lo3rwang');
  const span={startDate:'2026-11-01',endDate:'2026-11-01'};
  const whole=administrativeSourceTrend(raw,taxonomy,span);
  const facebook=administrativeSourceTrend(raw,taxonomy,
    {...span,sourceCategory:'facebook'});
  const kkcity=administrativeSourceTrend(raw,taxonomy,
    {...span,sourceCategory:'kkcity'});
  assert.equal(whole.total,16);
  assert.equal(facebook.total,4);
  assert.equal(kkcity.total,9);
  assert.equal(whole.distribution.reduce((sum,row)=>sum+row.value,0),16);
  assert.equal(published.tree.filter(node=>node.type==='from').length,10);
});

test('management graph consumes existing ZModel tree and edit ownership is bounded',()=>{
  const code=readFileSync(new URL('../app/loc/FlatClassificationEditor.jsx',import.meta.url),'utf8');
  const s=code.slice(code.indexOf('function sourceNodes('),
    code.indexOf('// LOC and Scope have different'));
  const sourceNodes=vm.runInNewContext('(() => {'+s+'return sourceNodes;})()');
  const owned=sourceNodes({tree:published.tree},'lo3rwang',entries);
  assert.equal(owned.find(node=>node.name==='kkcity').uid,'47dc42c2');
  assert.ok(owned.some(node=>node.type==='domain'&&node.name==='Default'));
  assert.ok(owned.some(node=>node.type==='domain'&&node.name==='lo3rwang'));
  assert.equal(owned.filter(node=>node.type==='from').length,10);
  assert.match(code,/node\.source_scope===scopeId/);
  assert.doesNotMatch(code,/Eosteric|domain:system/);
});

test('no physical Source UID or database column is created for virtual parents',()=>{
  const rows=sourceTreeFromCatalog(names,entries,{
    scopeId:'lo3rwang',domainUid:'5dfdb539'
  });
  for(const node of rows){
    if(['universe','galaxy'].includes(node.type)||
      node.type==='domain'&&node.name==='Default')
      assert.equal(Object.hasOwn(node,'uid'),false);
  }
  const src=readFileSync(new URL('../app/loc/source-classification.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/insertInto|updateTable|createTable|count\(/);
});
