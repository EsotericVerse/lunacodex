import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {publicCultureSourceModel} from '../app/loc/culture/public-source-river.mjs';

const catalog=publishedSourceTaxonomy();
const uid=name=>catalog.tree.find(row=>row.title===name)?.uid;
const daily=[
  {day:'2026-11-01',site:'Facebook',item_count:2},
  {day:'2026-11-01',site:'Threads',item_count:3},
  {day:'2026-11-01',site:'vocus',item_count:5},
  {day:'2026-11-01',site:'Suno',item_count:4},
  {day:'2026-11-01',site:'unmapped source',item_count:1}
];

test('public Culture Source river starts as saved Universe lanes',()=>{
  const model=publicCultureSourceModel(daily,catalog,[],'2026-11-01','2026-11-30');
  assert.deepEqual(model.groups.map(x=>x.label),[
    'Words (10)','Mutlimedia (4)','PastBy (0)','未分類來源 (1)'
  ]);
  assert.equal(model.groups.every(x=>x.depth===0),true);
  assert.equal(model.items.find(x=>x.group_key==='dual:source:'+uid('Words'))?.item_count,10);
  assert.deepEqual(model.sites.map(x=>x.label),['未分類來源']);
});

test('public Culture progressively expands Universe, Galaxy, Domain and From by UID',()=>{
  const expanded=[uid('Words'),uid('CMS'),uid('Meta')];
  const model=publicCultureSourceModel(daily,catalog,expanded,'2026-11-01','2026-11-30');
  const rows=model.groups.map(x=>[x.depth,x.label]);
  assert.deepEqual(rows.slice(0,7),[
    [0,'Words (10)'],[1,'CMS (5)'],[2,'Meta (5)'],
    [3,'Facebook (2)'],[3,'Threads (3)'],[3,'Instagram (0)'],
    [2,'X (0)']
  ]);
  // The new EsotericVerse Domain is a real sibling of Meta/X; do not
  // assume Article must occupy the eighth presentation row.
  assert.ok(rows.some(([depth,label])=>depth===2&&label==='EsotericVerse (0)'));
  assert.ok(rows.some(([depth,label])=>depth===1&&label==='Article (5)'));
  assert.equal(rows.some(([,label])=>label.includes(' / ')),false);
  assert.deepEqual(model.sites.map(x=>x.label),['Facebook','Threads','未分類來源']);
  const meta=model.items.find(x=>x.group_key==='dual:source:'+uid('Meta'));
  assert.equal(meta.item_count,5);
  assert.equal(meta.start_date,'2026-11-01');
});

test('public Culture keeps daily density and leaf sites scoped to the selected date range',()=>{
  const rows=[...daily,{day:'2026-12-01',site:'Facebook',item_count:90}];
  const model=publicCultureSourceModel(rows,catalog,[uid('Words'),uid('CMS'),uid('Meta')],
    '2026-11-01','2026-11-30');
  assert.equal(model.groups.find(x=>x.label.startsWith('Facebook'))?.label,'Facebook (2)');
  assert.deepEqual(model.sites.find(x=>x.label==='Facebook')?.sites,['Facebook']);
  assert.equal(model.items.some(x=>x.start_date==='2026-12-01'),false);
  assert.equal(model.groups.find(x=>x.label.startsWith('PastBy'))?.label,'PastBy (0)');
});

test('MCP Domain exposes exactly its five saved From children, not a site=mcp',()=>{
 const domain=catalog.tree.find(row=>row.title==='MCP'&&row.type==='domain');
 assert.ok(domain);
 const children=catalog.tree.filter(row=>row.parentUid===domain.uid);
 assert.deepEqual(children.map(row=>row.title),[
  'web','Github','ChatGPT','Claude','Gemini'
 ]);
 assert.ok(children.every(row=>row.type==='from'));
});
