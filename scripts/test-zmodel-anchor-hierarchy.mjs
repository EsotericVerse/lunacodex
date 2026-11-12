import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schema} from '../zenstack/schema.mjs';
import {ANCHOR_HIERARCHY_FAMILIES,indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';

const uid=(s)=>String(s).padEnd(8,'0');
const row=(name,type,attr={})=>({uid:uid(name),type,title:name,attr});
const tree=(family,rows,options={})=>indexZModelAnchorHierarchy(rows,{family,...options});

test('all four virtual families use the eight-column ZModel Anchor',()=>{
  assert.deepEqual(ANCHOR_HIERARCHY_FAMILIES,['keyword','source','time','space']);
  for(const model of ['Lo3rwangAnchor','LrunesAnchor']){
    const cols=schema.models[model]?.fields;
    assert.ok(cols);
    assert.deepEqual(Object.keys(cols).sort(),
      ['uid','type','title','description','invisible','attr','createtime','num'].sort());
    assert.equal(cols.attr.type,'Json');
  }
  const contract=readFileSync(new URL('../zenstack/schema.zmodel',import.meta.url),'utf8');
  assert.doesNotMatch(contract,/model (?:KeywordGroup|SourceTree|TimeTree|SpaceTree)\b/);
});

test('Keyword category/class/group/item uses attr.uid, not article UID-list JOINs',()=>{
  const rows=[
    row('CAT','category',{uid:[uid('CLS')]}),
    row('CLS','class',{uid:[uid('GRP')]}),
    row('GRP','group',{uid:[uid('ITM')]}),
    row('ITM','item',{keyword:['水土','地'],total:13,class_counts:{}})
  ];
  const graph=tree('keyword',rows,{strict:true});
  assert.deepEqual(graph.roots,[uid('CAT')]);
  assert.deepEqual(graph.descendants(uid('CAT'),{type:'item'}),{
    uids:[uid('ITM')],missing:[],complete:true
  });
  assert.deepEqual(graph.parentsOf(uid('ITM')),[uid('GRP')]);
});

test('Source universe/galaxy/domain/from is a four-tier model, without Galaxy.site scans',()=>{
  const rows=[
    row('UNI','universe',{uid:[uid('GAL')]}),
    row('GAL','galaxy',{uid:[uid('DOM')]}),
    row('DOM','domain',{uid:[uid('FRM')]}),
    row('FRM','from',{})
  ];
  const graph=tree('source',rows,{strict:true});
  assert.deepEqual(graph.descendants(uid('UNI'),{type:'from'}).uids,[uid('FRM')]);
  assert.deepEqual(graph.childrenOf(uid('GAL')),[uid('DOM')]);
});

test('Time era/period/date preserves UID links; date strings are not foreign keys',()=>{
  const rows=[
    row('ERA','era',{period:[uid('PER')],date:['2025-01-01']}),
    row('PER','period',{uid:[uid('DAY')],date:['2025-01-01','2025-12-31']}),
    row('DAY','date',{date:'2025-05-01'})
  ];
  const graph=tree('time',rows,{strict:true});
  assert.deepEqual(graph.descendants(uid('ERA'),{type:'date'}).uids,[uid('DAY')]);
  assert.deepEqual(graph.parentsOf(uid('PER')),[uid('ERA')]);
});

test('Trace may reach Point by direct link and Path without duplicate false positives',()=>{
  const rows=[
    row('TRC','trace',{path:[uid('PTH')],point:[uid('PNT')]}),
    row('PTH','path',{point:[uid('PNT')]}),
    row('PNT','point',{longitude:121.5,latitude:25.04,times:['2026-11-07T00:00:00Z']})
  ];
  const graph=tree('space',rows,{strict:true});
  assert.deepEqual(graph.descendants(uid('TRC'),{type:'point'}).uids,[uid('PNT')]);
  assert.deepEqual(graph.parentsOf(uid('PNT')),[uid('TRC'),uid('PTH')]);
});

test('bounded stage reports missing links rather than claiming a full subtree',()=>{
  const graph=tree('keyword',[row('CAT','category',{uid:[uid('CLS')]})]);
  assert.deepEqual(graph.missing,[{from:uid('CAT'),uid:uid('CLS'),type:'class'}]);
  assert.equal(graph.descendants(uid('CAT')).complete,false);
  assert.throws(()=>tree('keyword',[row('CAT','category',{uid:[uid('CLS')]})],{strict:true}),/Incomplete/);
});

test('mixed Anchor types do not cross-link families or leak article content',()=>{
  const rows=[row('CAT','category',{uid:[]}),row('PNT','point',{location:'Taipei'}),
    row('GAL','galaxy',{uid:[]})];
  assert.equal(tree('keyword',rows).nodeCount,1);
  assert.equal(tree('space',rows).nodeCount,1);
  assert.equal(tree('source',rows).nodeCount,1);
});

test('reject invalid references, wrong type, duplicate parent, and fabricated UID',()=>{
  assert.throws(()=>tree('keyword',[
    row('CAT','category',{uid:[uid('CH1'),uid('CH1')]})
  ]),/unique Base62/);
  assert.throws(()=>tree('keyword',[
    row('CAT','category',{uid:[uid('GRP')]}),row('GRP','group')
  ]),/Invalid Anchor hierarchy/);
  assert.throws(()=>tree('keyword',[
    row('CAT','category',{uid:[uid('CLS')]}),
    row('CAT2','category',{uid:[uid('CLS')]}),
    row('CLS','class')
  ]),/multiple parents/);
  assert.throws(()=>tree('source',[{uid:'unsafe',type:'from',attr:{}}]),/Invalid or repeated Anchor UID/);
  assert.throws(()=>tree('time',[row('DAY','date',[]) ]),/Anchor attr must be a JSON object/);
});

test('no SQL, DDL, policy change or persistent index is introduced',()=>{
  const src=readFileSync(new URL('../zenstack/anchor-hierarchy.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/\b(?:selectFrom|insertInto|updateTable|deleteFrom|createTable|alterTable|executeQuery|ORDER BY|JOIN)\s*\(/i);
  assert.doesNotMatch(src,/\b(?:fetch|dbAuthClient|rpc|localStorage|KV)\s*\(/);
});

test('Trace manager resolves native Trace -> Path members through Space ZModel',()=>{
  const manager=readFileSync(new URL('../app/loc/TraceRouteManager.jsx',import.meta.url),'utf8');
  assert.match(manager,/indexZModelAnchorHierarchy\(mapped\.map\(row=>\(\{/);
  assert.match(manager,/family:'space'/);
  assert.match(manager,/spaceGraph\.childrenOf\(current\.uid\)/);
  // The actual map index loads Trace and Path rows, not all Point rows.
  // A partial graph resolves loaded routes without inventing missing Points.
  const rows=[
    row('TRC','trace',{path:[uid('PTH')],point:[uid('PNT')]}),
    row('PTH','path',{point:[uid('PNT')]})
  ];
  const graph=tree('space',rows);
  assert.deepEqual(graph.childrenOf(uid('TRC')),[uid('PTH')]);
  assert.equal(graph.descendants(uid('TRC'),{type:'point'}).complete,false);
});

test('public Source catalogue consumes actual Domain/From ZModel edges',()=>{
  const catalogue=readFileSync(new URL('../app/loc/source-catalog-public.mjs',import.meta.url),'utf8');
  assert.match(catalogue,/from\('loc_anchor'\)/);
  assert.match(catalogue,/sourceTaxonomyFromAnchors/);
  const graph=tree('source',[
    row('DOM','domain',{uid:[uid('FRM')]}),
    row('FRM','from',{})
  ]);
  assert.deepEqual(graph.childrenOf(uid('DOM')),[uid('FRM')]);
  assert.equal(graph.descendants(uid('DOM')).complete,true);
});
