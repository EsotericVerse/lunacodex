import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
import {sourceOutlineOptions,sourceEditorOutlineOptions} from '../app/loc/source/outline-options.mjs';
import {PUBLISHED_SOURCE_ANCHORS} from '../app/modular/published-source-taxonomy.js';
import {buildCultureSourceTreeLanes,rollupCultureSourceDays}
  from '../app/loc/culture/source-tree-lanes.mjs';

const catalog=publishedSourceTaxonomy();
const byTitle=new Map(catalog.tree.map(row=>[row.title,row]));
const expandAll=catalog.tree.filter(row=>row.type!=='from').map(row=>row.uid);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sample=[
  {key:'system:'+byTitle.get('Facebook')?.uid,sites:['Facebook'],item_count:2},
  {key:'system:'+byTitle.get('Vocus')?.uid,sites:['vocus'],item_count:5},
  {key:'media:'+byTitle.get('Youtube')?.uid,sites:['Youtube'],item_count:1},
  {key:'custom:others',sites:['Unmatched source'],item_count:4}
];

test('the 30 saved loc_anchor Source nodes render as exactly four UID-linked levels',()=>{
  const hierarchy=buildCultureSourceTreeLanes(catalog,sample,expandAll);
  assert.deepEqual(hierarchy.visible.filter(x=>x.uid).map(x=>[
    x.level,x.type,x.label
  ]),[
    [0,'universe','Words'],
    [1,'galaxy','CMS'],
    [2,'domain','Meta'],
    [3,'from','Facebook'],[3,'from','Threads'],[3,'from','Instagram'],
    [2,'domain','X'],[3,'from','X Twitter'],
    [1,'galaxy','Article'],
    [2,'domain','MCP'],[3,'from','Github'],[3,'from','ChatGPT'],[3,'from','runes'],
    [2,'domain','Post'],[3,'from','Vocus'],
    [0,'universe','Mutlimedia'],
    [1,'galaxy','Stream'],
    [2,'domain','Music'],[3,'from','Suno'],[3,'from','Spotify'],
    [2,'domain','Video'],[3,'from','Youtube'],
    [0,'universe','PastBy'],
    [1,'galaxy','SeeYou'],
    [2,'domain','Yesterday'],[3,'from','kkcity'],[3,'from','ptt'],
    [3,'from','無名wretch'],[3,'from','pixnet'],[3,'from','MSN']
  ]);
  assert.equal(hierarchy.visible.filter(x=>x.uid).length,30);
  assert.deepEqual(hierarchy.visible.filter(x=>!x.uid).map(x=>x.label),['未分類來源']);
  assert.equal(hierarchy.total,12);
});

test('one-child domains are not collapsed and do not inherit the child title',()=>{
  const hierarchy=buildCultureSourceTreeLanes(catalog,sample,expandAll);
  for(const [parentName,childName] of [['X','X Twitter'],['Post','Vocus'],['Video','Youtube']]){
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
  assert.equal(options.length,30);
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

test('Culture UI respects ancestor expansion and uses each UID as a separate timeline group',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  const timeline=read('app/modular/modules/culture-timeline/CultureTimeline.jsx');
  assert.match(culture,/buildCultureSourceTreeLanes\(/);
  assert.match(culture,/sourceOutlineOptions\(sourceTaxonomy\)/);
  assert.match(culture,/const uid=id\.slice\('dual:source:'\.length\)/);
  assert.match(culture,/depth:node\.level/);
  assert.doesNotMatch(culture,/const onlyChild=|id:'dual:root:'\+parent\.id/);
  assert.match(timeline,/button\.style\.paddingInlineStart=depth/);
});

test('Culture, Statistics and protected Source editor use one UID-based outline',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  const statistics=read('app/modular/features/Statistics.jsx');
  const editor=read('app/loc/source/SourceCategoryEditor.jsx');
  assert.match(culture,/sourceOutlineOptions\(sourceTaxonomy\)/);
  assert.match(statistics,/sourceOutlineOptions\(sourceCatalog\.data\)/);
  assert.match(editor,/sourceEditorOutlineOptions\(nodes\)/);
  assert.match(editor,/sourceOutline\.filter\(row=>row\.path\[0\]===root\.code\)/);
  assert.doesNotMatch(statistics,/source\.domain\?source\.domain/);
  assert.doesNotMatch(editor,/children\(root\.uid\)\.flatMap/);
  const source=read('app/loc/source/outline-options.mjs');
  assert.match(source,/sourceTaxonomyFromAnchors\(anchorRows,\{includeHidden:true\}\)/);
});

test('protected Source editor preserves hidden saved UID nodes; public projection does not',async()=>{
  const target=PUBLISHED_SOURCE_ANCHORS.find(row=>row.type==='from'&&row.title==='Vocus');
  const modified=PUBLISHED_SOURCE_ANCHORS.map(row=>row.uid===target.uid?{...row,invisible:true}:row);
  const editor=sourceEditorOutlineOptions(modified);
  assert.equal(editor.length,30);
  assert.deepEqual(editor.filter(row=>row.path.includes(target.uid)).map(row=>[row.label,row.level]),[['Vocus',3]]);
  assert.equal(editor.find(row=>row.code===target.uid)?.path.length,4);
  // The public tree hides invisible nodes without changing the persisted UID.
  const {sourceTaxonomyFromAnchors}=await import('../app/loc/source/classification.mjs');
  const guest=sourceOutlineOptions(sourceTaxonomyFromAnchors(modified));
  assert.ok(!guest.some(row=>row.code===target.uid));
});
