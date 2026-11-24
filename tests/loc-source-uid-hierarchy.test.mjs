import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {sourceOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {sourceEditorOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {PUBLISHED_SOURCE_ANCHORS} from '../app/modular/published-source-taxonomy.js';
import {buildCultureSourceTreeLanes} from '../app/loc/culture/source-tree-lanes.mjs';
import {rollupCultureSourceDays} from '../app/loc/culture/source-tree-lanes.mjs';
import {ITEM_LANE_OPTIONS} from '../app/loc/statistics/item-confluence-model.mjs';
import {validateItemLane} from '../app/loc/statistics/item-confluence-model.mjs';
import {buildCultureRiverRootPayload} from '../app/loc/culture/river-roots.mjs';
import {buildCultureRiverRootTotals} from '../app/loc/culture/river-roots.mjs';
import {selectCultureRiverChildren} from '../app/loc/culture/river-roots.mjs';
import {availableMemberMeasures} from '../app/loc/statistics/member-intersection-model.mjs';
import {publicCultureSourceModel} from '../app/loc/culture/public-source-river.mjs';

{
const catalog=publishedSourceTaxonomy();
const byTitle=new Map(catalog.tree.map(row=>[row.title,row]));
const expandAll=catalog.tree.filter(row=>row.type!=='from').map(row=>row.uid);
const sample=[
  {key:'system:'+byTitle.get('Facebook')?.uid,sites:['Facebook'],item_count:2},
  {key:'system:'+byTitle.get('Vocus')?.uid,sites:['vocus'],item_count:5},
  {key:'media:'+byTitle.get('Youtube')?.uid,sites:['Youtube'],item_count:1},
  {key:'custom:others',sites:['Unmatched source'],item_count:4}
];

test('the 36 visible loc_anchor Source nodes render as exactly four UID-linked levels',()=>{
  const hierarchy=buildCultureSourceTreeLanes(catalog,sample,expandAll);
  assert.deepEqual(hierarchy.visible.filter(x=>x.uid).map(x=>[
    x.level,x.type,x.label
  ]),[
    [0,'universe','Words'],
    [1,'galaxy','CMS'],
    [2,'domain','Meta'],
    [3,'from','Facebook'],[3,'from','Threads'],[3,'from','Instagram'],
    [2,'domain','X'],[3,'from','X Twitter'],
    [2,'domain','EsotericVerse'],[3,'from','LOC'],[3,'from','LRS'],
    [1,'galaxy','Article'],
    [2,'domain','MCP'],[3,'from','web'],[3,'from','Github'],[3,'from','ChatGPT'],
    [3,'from','Claude'],[3,'from','Gemini'],
    [2,'domain','Post'],[3,'from','Vocus'],
    [0,'universe','Mutlimedia'],
    [1,'galaxy','Stream'],
    [2,'domain','Music'],[3,'from','Suno'],[3,'from','Spotify'],
    [2,'domain','Video'],[3,'from','Youtube'],
    [0,'universe','PastBy'],
    [1,'galaxy','SeeYou'],
    [2,'domain','Closed'],[3,'from','kkcity'],
    [3,'from','無名wretch'],[3,'from','MSN'],
    [2,'domain','NowON'],[3,'from','ptt'],[3,'from','pixnet']
  ]);
  assert.equal(hierarchy.visible.filter(x=>x.uid).length,36);
  assert.deepEqual(hierarchy.visible.filter(x=>!x.uid).map(x=>x.label),['未分類來源']);
  assert.equal(hierarchy.total,12);
});

test('one-child domains are not collapsed and do not inherit the child title',()=>{
  const hierarchy=buildCultureSourceTreeLanes(catalog,sample,expandAll);
  for(const [parentName,childName] of [['X','X Twitter'],['Post','Vocus'],['Video','Youtube'],['NowON','ptt']]){
    const i=hierarchy.visible.findIndex(x=>x.label===parentName);
    assert.ok(i>=0);
    assert.equal(hierarchy.visible[i].type,'domain');
    assert.equal(hierarchy.visible[i].collapsible,true);
    assert.equal(hierarchy.visible[i+1].label,childName);
    assert.equal(hierarchy.visible[i+1].level,3);
    assert.equal(hierarchy.visible[i+1].type,'from');
  }
  // Zero-count branches are structural nodes, not omitted as "empty labels".
  assert.equal(hierarchy.visible.find(x=>x.label==='Spotify').item_count,0);
  assert.equal(hierarchy.visible.find(x=>x.label==='PastBy').item_count,0);
});

test('collapsed river starts with three Universe rows, not three artificial buckets',()=>{
  const groups=buildCultureSourceTreeLanes(catalog,sample,[]).visible;
  assert.deepEqual(groups.map(x=>x.label),[
    'Words','Mutlimedia','PastBy','未分類來源'
  ]);
  assert.deepEqual(groups.map(x=>x.item_count),[7,1,0,4]);
});

test('source outline has one selectable option per real Source node and correct indentation',()=>{
  const options=sourceOutlineOptions(catalog);
  assert.equal(options.length,36);
  assert.deepEqual(options.slice(0,4).map(x=>[x.type,x.label,x.level]),[
    ['universe','Words',0],['galaxy','CMS',1],
    ['domain','Meta',2],['from','Facebook',3]
  ]);
  assert.ok(options.every(x=>catalog.tree.some(node=>node.uid===x.code)));
  assert.ok(options.every(x=>!x.label.includes(' / ')));
});

test('daily counts roll up by saved parent UID without treating site as a node type',()=>{
  const counts=rollupCultureSourceDays([
    {start_date:'2026-11-22',category:'Facebook',item_count:2},
    {start_date:'2026-11-22',category:'vocus',item_count:5},
    {start_date:'2026-11-22',category:'Youtube',item_count:1},
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
  assert.equal(total('Video'),1);
  assert.equal(total('Stream'),1);
  assert.equal(total('Mutlimedia'),1);
  assert.equal(counts.days.get('unassigned\u00002026-11-22'),4);
});





test('protected Source editor preserves hidden saved UID nodes; public projection does not',async()=>{
  const target=PUBLISHED_SOURCE_ANCHORS.find(row=>row.type==='from'&&row.title==='Vocus');
  const modified=PUBLISHED_SOURCE_ANCHORS.map(row=>row.uid===target.uid?{...row,invisible:true}:row);
  const editor=sourceEditorOutlineOptions(modified);
  assert.equal(editor.length,37);
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
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('multimedia platforms belong to the one LOC-wide source taxonomy',()=>{
  const taxonomy=publishedSourceTaxonomy();
  const from=(taxonomy.categories||[]).filter(row=>row.root==='media'&&row.type==='from');
  const labels=from.map(row=>row.display_name);
  assert.ok(labels.includes('Suno'));
  assert.ok(labels.includes('Spotify'));
  assert.ok(labels.includes('Youtube'));
  assert.ok(!labels.includes('Facebook'));
  // Media classification is stored as source metadata, not media item counts.
  assert.ok(from.every(row=>typeof row.category_code==='string'));
});

test('item confluence sources are only Galaxy.site selectors',()=>{
  assert.ok(ITEM_LANE_OPTIONS.every(item=>item.value.startsWith('galaxy:')));
  const scopes=[{id:'lo3rwang'}];
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'galaxy:all'},scopes).valid,true);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:all'},scopes).valid,false);
  assert.equal(validateItemLane({scopeId:'lo3rwang',source:'media:exact',exact:'suno'},scopes).valid,false);
});
}

{
const fixture={
  text:[
    {day:'2026-11-20',category:'Suno',item_count:3},
    {day:'2026-11-20',category:'Facebook',item_count:5}
  ],
  // Retired MediaAnchor statistics must never create another root or count.
  media:[{day:'2026-11-20',category:'video',item_count:999}]
};

test('Culture multimedia sources are in loc_anchor taxonomy, not a parallel count',()=>{
  const taxonomy=publishedSourceTaxonomy();
  const {rootBuckets,groups,numericRows}=buildCultureRiverRootPayload(fixture,taxonomy);
  assert.deepEqual(rootBuckets.map(row=>[row.category,row.item_count]).sort(),
    [['media',3],['system',5]]);
  assert.equal(numericRows.length,2);
  assert.equal(groups.reduce((sum,row)=>sum+row.item_count,0),8);
  assert.ok(groups.every(row=>row.category_type==='source'));
  const mediaNodes=selectCultureRiverChildren(numericRows,taxonomy,['media']);
  assert.deepEqual(mediaNodes.map(row=>row.category),['Suno']);
  const totals=buildCultureRiverRootTotals(fixture,taxonomy);
  assert.equal(totals.groups.reduce((sum,row)=>sum+row.item_count,0),8);
});

test('cross-member statistics no longer offer independent media metrics',()=>{
  const metrics=availableMemberMeasures([[
    {kind:'media',category:'video',item_count:999},
    {kind:'source',category:'Suno',item_count:3}
  ]]);
  assert.equal(metrics.some(metric=>metric.id==='multimedia'||metric.id.startsWith('media:')),false);
});
}

{
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
}
