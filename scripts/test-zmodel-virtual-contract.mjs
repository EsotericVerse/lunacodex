import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schema} from '../zenstack/schema.mjs';
import {indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';
import {locGlobalUid,qualifyLocAnchorLinks} from '../zenstack/global-identity.mjs';

const zmodel=readFileSync(new URL('../zenstack/schema.zmodel',import.meta.url),'utf8');
const typeNames=['LocPrincipal','LocFederatedRef','LocAnchorLink'];
const fieldsFor=(type)=>{
  const body=zmodel.match(new RegExp('^type '+type+' \\{([\\s\\S]*?)^\\}','m'))?.[1];
  assert.ok(body,'missing ZModel virtual type '+type);
  return Object.fromEntries([...body.matchAll(/^\s+(\w+)\s+(String(?:\[\])?|Int|Boolean)\s*$/gm)]
    .map(([,name,kind])=>[name,kind]));
};
const row=(uid,type,attr={})=>({uid,type,attr});

test('ZModel declares only three nonphysical projection types, mirrored by runtime SchemaDef',()=>{
  const names=[...zmodel.matchAll(/^type (\w+) \{/gm)].map(x=>x[1]);
  assert.deepEqual(names,typeNames);
  assert.deepEqual(Object.keys(schema.typeDefs).sort(),[...typeNames].sort());
  for(const type of names){
    const declared=fieldsFor(type);
    const runtime=schema.typeDefs[type];
    assert.ok(runtime);
    assert.deepEqual(Object.keys(runtime.fields).sort(),Object.keys(declared).sort());
    for(const [field,kind] of Object.entries(declared)){
      const f=runtime.fields[field];
      assert.equal(f.type,kind.replace('[]',''),type+'.'+field);
      assert.equal(Boolean(f.array),kind.endsWith('[]'),type+'.'+field+' array');
    }
  }
  assert.deepEqual(Object.keys(fieldsFor('LocFederatedRef')),
    ['databaseId','scopeId','uid']);
  assert.deepEqual(Object.keys(fieldsFor('LocAnchorLink')),
    ['family','fromUid','toUid','fromType','toType','attrKey','resolved']);
  assert.deepEqual(schema.typeDefs.LocPrincipal.attributes,[{name:'@@auth'}]);
  for(const name of ['LocFederatedRef','LocAnchorLink'])
    assert.deepEqual(schema.typeDefs[name].attributes,[]);
});

test('existing physical 17-model and policy boundary is unchanged',()=>{
  assert.equal(Object.keys(schema.models).length,17);
  assert.equal(schema.provider.type,'postgresql');
  assert.match(zmodel,/^model Lo3rwangAnchor \{/m);
  assert.match(zmodel,/^model LrunesAnchor \{/m);
  assert.match(zmodel,/^model Manage \{/m);
  assert.match(zmodel,/^    @@schema\("api"\)$/m);
  assert.doesNotMatch(zmodel,/^\s*generator\s+\w+/m);
  assert.doesNotMatch(zmodel,/^\s*(?:model|type) (?:LocFederatedRefTable|LocAnchorLinkTable)\b/m);
  const attrs=zmodel.match(/^\s*@@allow\([^\n]*\)\s*$/gm)||[];
  assert.equal(attrs.length,6,'each policy attribute occupies one line');
  assert.equal((zmodel.match(/^\s*@@allow\('update,delete', auth\(\)\.roleLevel >= 4\)\s*$/gm)||[]).length,2);
  for(const name of ['Lo3rwangGalaxy','LrunesGalaxy','Lo3rwangAnchor','LrunesAnchor']){
    assert.equal(schema.models[name].attributes.some(a=>a.name==='@@allow'),false,
      'dynamic content policy remains at verified Kysely/Gateway boundary');
  }
});

test('keyword link projection preserves child type and attr key without a database query',()=>{
  const graph=indexZModelAnchorHierarchy([
    row('AAAA1111','category',{uid:['BBBB2222']}),
    row('BBBB2222','class',{uid:['CCCC3333']}),
    row('CCCC3333','group',{uid:['DDDD4444']}),
    row('DDDD4444','item',{keyword:['foo']})
  ],{family:'keyword',strict:true});
  assert.deepEqual(graph.links(),[
    {family:'keyword',fromUid:'AAAA1111',toUid:'BBBB2222',
      fromType:'category',toType:'class',attrKey:'uid',resolved:true},
    {family:'keyword',fromUid:'BBBB2222',toUid:'CCCC3333',
      fromType:'class',toType:'group',attrKey:'uid',resolved:true},
    {family:'keyword',fromUid:'CCCC3333',toUid:'DDDD4444',
      fromType:'group',toType:'item',attrKey:'uid',resolved:true}
  ]);
  assert.deepEqual(graph.descendants('AAAA1111',{type:'item'}).uids,['DDDD4444']);
});

test('partially loaded time hierarchy reports unresolved edges instead of hiding them',()=>{
  const graph=indexZModelAnchorHierarchy([
    row('AAAA1111','era',{period:['BBBB2222']})
  ],{family:'time'});
  assert.deepEqual(graph.links(),[{
    family:'time',fromUid:'AAAA1111',toUid:'BBBB2222',
    fromType:'era',toType:'period',attrKey:'period',resolved:false
  }]);
  assert.equal(graph.descendants('AAAA1111').complete,false);
});

test('space is an intentional DAG: direct Trace→Point and indirect Trace→Path→Point coexist',()=>{
  const graph=indexZModelAnchorHierarchy([
    row('AAAA1111','trace',{path:['BBBB2222'],point:['CCCC3333']}),
    row('BBBB2222','path',{point:['CCCC3333']}),
    row('CCCC3333','point',{longitude:121.5,latitude:25.04})
  ],{family:'space',strict:true});
  assert.deepEqual(graph.parentsOf('CCCC3333'),['AAAA1111','BBBB2222']);
  assert.deepEqual(graph.links().map(x=>x.attrKey),['path','point','point']);
  assert.deepEqual(graph.descendants('AAAA1111',{type:'point'}).uids,['CCCC3333']);
});

test('cross-db links are qualified; identical UIDs never become one record',()=>{
  const graph=indexZModelAnchorHierarchy([
    row('AAAA1111','universe',{uid:['BBBB2222']}),
    row('BBBB2222','galaxy',{uid:[]})
  ],{family:'source',strict:true});
  const first=qualifyLocAnchorLinks(graph.links(),{databaseId:'db01',scopeId:'lo3rwang'});
  const second=qualifyLocAnchorLinks(graph.links(),{databaseId:'db02',scopeId:'lo3rwang'});
  assert.equal(first[0].from,locGlobalUid({databaseId:'db01',scopeId:'lo3rwang',uid:'AAAA1111'}));
  assert.equal(first[0].to,'db01:lo3rwang:BBBB2222');
  assert.equal(second[0].from,'db02:lo3rwang:AAAA1111');
  assert.notEqual(first[0].to,second[0].to);
  assert.notEqual(first[0].from,second[0].from);
});

test('nonphysical link formatting fails closed on invalid keys or metadata',()=>{
  assert.throws(()=>qualifyLocAnchorLinks(null,{databaseId:'db01',scopeId:'lo3rwang'}),/collection/);
  assert.throws(()=>qualifyLocAnchorLinks([{family:'keyword',fromType:'category',
    toType:'class',attrKey:'uid',resolved:true,fromUid:'bad',toUid:'BBBB2222'}],
    {databaseId:'db01',scopeId:'lo3rwang'}),/Invalid LOC UID/);
  assert.throws(()=>qualifyLocAnchorLinks([{family:'unknown',fromType:'category',
    toType:'class',attrKey:'uid',resolved:true,fromUid:'AAAA1111',toUid:'BBBB2222'}],
    {databaseId:'db01',scopeId:'lo3rwang'}),/Invalid LOC Anchor link/);
});
