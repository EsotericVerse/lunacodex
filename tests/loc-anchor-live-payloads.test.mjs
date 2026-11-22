import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelAnchorFeatureRows} from '../packages/zenstack/import-validation.mjs';
import {schema} from '../packages/zenstack/schema.mjs';
import {parseAnchorFeatureTransaction} from '../app/loc/model/anchor-feature-transactions.mjs';
import {indexZModelAnchorHierarchy,nextZModelAnchorType} from '../packages/zenstack/anchor-hierarchy.mjs';

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

test('culture never renders an HTTP 503 as an empty SiteAnchor taxonomy',()=>{
  const code=readFileSync(new URL('../app/loc/views/CulturePublicReader.jsx',
    import.meta.url),'utf8');
  assert.doesNotMatch(code,/setCatalog\(\{categories:\[\],aliases:\[\],tree:\[\],roots:\[\]\}\)/);
  assert.match(code,/setCatalog\(null\);/);
  assert.match(code,/!catalogLoading&&!catalogError/);
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
