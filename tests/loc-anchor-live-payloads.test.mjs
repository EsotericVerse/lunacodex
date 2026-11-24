import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelAnchorFeatureRows} from '../packages/zenstack/import-validation.mjs';
import {schema} from '../packages/zenstack/schema.mjs';
import {parseAnchorFeatureTransaction} from '../app/loc/model/anchor-feature-transactions.mjs';
import {anchorUidListCount,indexZModelAnchorHierarchy,nextZModelAnchorType} from '../packages/zenstack/anchor-hierarchy.mjs';

import {locAnchorToBlock,locBlockToAnchor} from '../app/loc/blocks/loc-block-anchor.mjs';

const anchor=(type,attr,uid='AAAA0001')=>({uid,type,attr,invisible:false,num:0});

test('persisted SiteAnchor count caches are accepted without redefining num',()=>{
  const types=['from','domain','galaxy','universe'];
  const rows=types.map(type=>anchor(type,{uid:[],counts:{lo3rwang:0,lrunes:0}}));
  assert.equal(assertZModelAnchorFeatureRows(rows),rows);
  for(const type of types){
    assert.equal(schema.typeDefs[type[0].toUpperCase()+type.slice(1)+'Anchor']
      .fields.counts.type,'Json');
  }
  assert.throws(()=>assertZModelAnchorFeatureRows([
    anchor('domain',{uid:[],counts:{lo3rwang:'999'}})
  ]),/counts/);
  assert.equal(rows[0].num,0);
});

test('SiteAnchor ZModel applies exact Universe > Galaxy > Domain > From links',()=>{
  assert.deepEqual(Object.keys(schema.typeDefs.SiteAnchor.fields),
    ['universe','galaxy','domain','from']);
  assert.equal(nextZModelAnchorType('source','universe'),'galaxy');
  assert.equal(nextZModelAnchorType('source','galaxy'),'domain');
  assert.equal(nextZModelAnchorType('source','domain'),'from');
  assert.equal(nextZModelAnchorType('source','from'),null);
  const rows=[
    anchor('universe',{uid:['BBBB0002']},'AAAA0001'),
    anchor('galaxy',{uid:['CCCC0003']},'BBBB0002'),
    anchor('domain',{uid:['DDDD0004']},'CCCC0003'),
    anchor('from',{uid:[],counts:{lo3rwang:0,lrunes:0}},'DDDD0004')
  ];
  assert.equal(assertZModelAnchorFeatureRows(rows),rows);
  const tree=indexZModelAnchorHierarchy(rows,{family:'source',strict:true});
  assert.deepEqual(tree.roots,['AAAA0001']);
  assert.deepEqual(tree.descendants('AAAA0001'),{
    uids:['AAAA0001','BBBB0002','CCCC0003','DDDD0004'],missing:[],complete:true
  });
  assert.throws(()=>assertZModelAnchorFeatureRows([
    anchor('from',{uid:['EEEE0005']})
  ]),/FromAnchor.*terminal/);
  assert.throws(()=>indexZModelAnchorHierarchy([
    anchor('from',{uid:['EEEE0005']})
  ],{family:'source'}),/FromAnchor.*terminal/);
});

test('PointAnchor preserves stored text or text aliases without coercion',()=>{
  const single=anchor('point',{longitude:121.5,latitude:25.03,location:'臺北'});
  const aliases=anchor('point',{longitude:121.5,latitude:25.03,
    location:['臺北','Taipei','台北市']});
  assert.equal(assertZModelAnchorFeatureRows([single])[0].attr.location,'臺北');
  assert.deepEqual(assertZModelAnchorFeatureRows([aliases])[0].attr.location,
    ['臺北','Taipei','台北市']);
  assert.throws(()=>assertZModelAnchorFeatureRows([
    anchor('point',{location:['臺北',101]})
  ]),/location/);
});

test('Keyword GroupAnchor numeric total is a stored payload field',()=>{
  const row=anchor('group',{uid:['ABCD1234'],total:2488});
  assert.equal(assertZModelAnchorFeatureRows([row])[0].attr.total,2488);
  assert.throws(()=>assertZModelAnchorFeatureRows([
    anchor('group',{uid:[],total:'2488'})
  ]),/total/);
});

test('unrecognized Anchor attr fields still fail strict ZModel validation',()=>{
  assert.throws(()=>assertZModelAnchorFeatureRows([
    anchor('group',{uid:[],bogus:'value'})
  ]),/bogus/);
});

test('source taxonomy is LOC-global only, never a Scope anchor source',()=>{
  const body={kind:'transaction',operation:'anchor-feature',
    family:'source',scope:'loc',result:'rows'};
  assert.equal(parseAnchorFeatureTransaction(body).family,'source');
  assert.throws(()=>parseAnchorFeatureTransaction({...body,scope:'lo3rwang'}),
    /Invalid Anchor feature selection/);
  assert.throws(()=>parseAnchorFeatureTransaction({...body,scope:'lrunes'}),
    /Invalid Anchor feature selection/);
  assert.throws(()=>parseAnchorFeatureTransaction({...body,scope:'loc',family:'time'}),
    /Invalid Anchor feature selection/);
});

test('Pattern attr.total stores occurrence counts without changing terminal num',()=>{
  const rows=[
    anchor('pattern',{},'PATT0001'),
    anchor('pattern',{total:0},'PATT0002'),
    anchor('pattern',{total:142},'PATT0003')
  ];
  assert.equal(assertZModelAnchorFeatureRows(rows),rows);
  assert.equal(rows[2].num,0);
  for(const bad of [{total:-1},{total:1.5},{total:'142'},
    {uid:['GALAXY01']},{total:2,hits:['GALAXY01']}]){
    assert.throws(()=>assertZModelAnchorFeatureRows([
      anchor('pattern',bad)
    ]),/Pattern.attr/);
  }
});

test('LOC Block order lives in attr.order, not in num',()=>{
  const original={uid:'ABCD1234',page_name:'index',block_order:5,
    block_title:'Example',block_text:'',block_entity:[3,{uid:'AAAA0001',text:'a'}]};
  const anchor=locBlockToAnchor(original);
  assert.equal(anchor.attr.order,5);
  assert.equal(anchor.num,1);
  assert.equal(locAnchorToBlock({...anchor,num:99}).block_order,5);
});
test('num counts the UID references in each semantic Anchor payload',()=>{
  assert.equal(anchorUidListCount('universe',{uid:['AAAA0001','BBBB0002']}),2);
  assert.equal(anchorUidListCount('period',{uid:['AAAA0001']}),1);
  assert.equal(anchorUidListCount('era',{period:['AAAA0001','BBBB0002']}),2);
  assert.equal(anchorUidListCount('trace',{path:['AAAA0001'],point:['BBBB0002','CCCC0003']}),3);
  assert.equal(anchorUidListCount('pattern',{}),0);
  assert.equal(anchorUidListCount('from',{uid:[],counts:{lo3rwang:123}}),0);
  assert.equal(anchorUidListCount('index',{order:2,uidlist:[3,{uid:'AAAA0001'}]}),1);
  assert.equal(anchorUidListCount('date',{date:'2026-11-23'}),0);
});
