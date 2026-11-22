import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertZModelAnchorFeatureRows} from '../packages/zenstack/import-validation.mjs';
import {schema} from '../packages/zenstack/schema.mjs';

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
