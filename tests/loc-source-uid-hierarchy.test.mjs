import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTaxonomyFromLucus} from '../app/loc/source/classification.mjs';
import {SOURCE_LUCUS_FIXTURE} from './fixtures/source-lucus.mjs';
import {sourceOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {sourceEditorOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {rollupCultureSourceDays} from '../app/loc/culture/source-tree-lanes.mjs';
import {publicCultureSourceModel} from '../app/loc/culture/public-source-river.mjs';
import {parseLucusFeatureQuery} from '../app/loc/model/lucus-feature-queries.mjs';

{
const catalog=sourceTaxonomyFromLucus(SOURCE_LUCUS_FIXTURE);
test('SiteAnchor reads are global loc_lucus queries, never Scope Anchor queries',()=>{
  const request={kind:'query',operation:'lucus-feature',scope:'loc',family:'source'};
  assert.equal(parseLucusFeatureQuery(request).scope,'loc');
  assert.throws(()=>parseLucusFeatureQuery({...request,scope:'lo3rwang'}),
    /Invalid Anchor feature selection/);
});
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
  const target=SOURCE_LUCUS_FIXTURE.find(row=>row.type==='from'&&row.title==='Vocus');
  const modified=SOURCE_LUCUS_FIXTURE.map(row=>row.uid===target.uid?{...row,invisible:true}:row);
  const editor=sourceEditorOutlineOptions(modified);
  assert.equal(editor.length,SOURCE_LUCUS_FIXTURE.length);
  assert.deepEqual(editor.filter(row=>row.path.includes(target.uid)).map(row=>[row.label,row.level]),[['Vocus',3]]);
  assert.equal(editor.find(row=>row.code===target.uid)?.path.length,4);
  // The public tree hides invisible nodes without changing the persisted UID.
  const guest=sourceOutlineOptions(sourceTaxonomyFromLucus(modified));
  assert.ok(!guest.some(row=>row.code===target.uid));
});
}

{

}

{
const catalog=sourceTaxonomyFromLucus(SOURCE_LUCUS_FIXTURE);
const uid=name=>catalog.tree.find(row=>row.title===name)?.uid;
const daily=[
  {day:'2026-11-01',site:'Facebook',item_count:2},
  {day:'2026-11-01',site:'Threads',item_count:3},
  {day:'2026-11-01',site:'vocus',item_count:5},
  {day:'2026-11-01',site:'unmapped source',item_count:1}
];

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
