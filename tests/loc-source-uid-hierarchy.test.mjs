import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {sourceOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {sourceEditorOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {PUBLISHED_SOURCE_ANCHORS} from '../app/modular/published-source-taxonomy.js';
import {rollupCultureSourceDays} from '../app/loc/culture/source-tree-lanes.mjs';
import {ITEM_LANE_OPTIONS} from '../app/loc/statistics/item-confluence-model.mjs';
import {validateItemLane} from '../app/loc/statistics/item-confluence-model.mjs';
import {publicCultureSourceModel} from '../app/loc/culture/public-source-river.mjs';

{
const catalog=publishedSourceTaxonomy();
const byTitle=new Map(catalog.tree.map(row=>[row.title,row]));
const sample=[
  {key:'system:'+byTitle.get('Facebook')?.uid,sites:['Facebook'],item_count:2},
  {key:'system:'+byTitle.get('Vocus')?.uid,sites:['vocus'],item_count:5},
  {key:'custom:others',sites:['Unmatched source'],item_count:4}
];

test('daily counts roll up by saved parent UID without treating site as a node type',()=>{
  const counts=rollupCultureSourceDays([
    {start_date:'2026-11-22',category:'Facebook',item_count:2},
    {start_date:'2026-11-22',category:'vocus',item_count:5},
    {start_date:'2026-11-22',category:'Unmatched source',item_count:4}
  ],sample,catalog);
  const total=name=>counts.days.get(byTitle.get(name).uid+'\u0000'+'2026-11-22');
  assert.equal(total('Facebook'),2);
  assert.equal(total('Meta'),2);
  assert.equal(total('CMS'),2);
  assert.equal(total('Vocus'),5);
  assert.equal(total('Post'),5);
  assert.equal(total('Article'),5);
  assert.equal(total('Words'),7);
  assert.equal(counts.days.get('unassigned\u00002026-11-22'),4);
});





test('protected Source editor preserves hidden saved UID nodes; public projection does not',async()=>{
  const target=PUBLISHED_SOURCE_ANCHORS.find(row=>row.type==='from'&&row.title==='Vocus');
  const modified=PUBLISHED_SOURCE_ANCHORS.map(row=>row.uid===target.uid?{...row,invisible:true}:row);
  const editor=sourceEditorOutlineOptions(modified);
  assert.equal(editor.length,PUBLISHED_SOURCE_ANCHORS.length);
  assert.equal(sourceOutlineOptions(catalog).filter(row=>row.label==='LRS').length,1);
  assert.deepEqual(editor.filter(row=>row.path.includes(target.uid)).map(row=>[row.label,row.level]),[['Vocus',3]]);
  assert.equal(editor.find(row=>row.code===target.uid)?.path.length,4);
  // The public tree hides invisible nodes without changing the persisted UID.
  const {sourceTaxonomyFromAnchors}=await import('../app/loc/source/classification.mjs');
  const guest=sourceOutlineOptions(sourceTaxonomyFromAnchors(modified));
  assert.ok(!guest.some(row=>row.code===target.uid));
});
}

{

test('item confluence sources are only Galaxy.site selectors',()=>{
  assert.ok(ITEM_LANE_OPTIONS.every(item=>item.value.startsWith('galaxy:')));
  const scopes=[{id:'lo3rwang'}];
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'galaxy:all'},scopes).valid,true);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:all'},scopes).valid,false);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:exact',exact:'suno'},scopes).valid,false);
});
}

{
const catalog=publishedSourceTaxonomy();
const uid=name=>catalog.tree.find(row=>row.title===name)?.uid;
const daily=[
  {day:'2026-11-01',site:'Facebook',item_count:2},
  {day:'2026-11-01',site:'Threads',item_count:3},
  {day:'2026-11-01',site:'vocus',item_count:5},
  {day:'2026-11-01',site:'unmapped source',item_count:1}
];

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
}
