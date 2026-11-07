import test from 'node:test';
import assert from 'node:assert/strict';
import {schema} from '../zenstack/schema.mjs';
import {validatePortableScopeSchema} from '../app/loc/providers/kysely-schema.mjs';

const fields=name=>Object.keys(schema.models[name].fields);
const base=[{name:'demo_galaxy',schema:'silver',columns:fields('Lo3rwangGalaxy').map(name=>({name}))},
  {name:'demo_anchor',schema:'silver',columns:fields('Lo3rwangAnchor').map(name=>({name}))}];

test('portable DB contract derives its required columns from the fixed ZModel',()=>{
  const result=validatePortableScopeSchema(base,{engine:'postgres',namespace:'silver',scopeId:'demo'});
  assert.ok(result.galaxy);
  assert.ok(result.anchor);
  assert.equal(fields('Lo3rwangGalaxy').length,23);
  assert.equal(fields('Lo3rwangAnchor').length,7);
  assert.deepEqual([...fields('Lo3rwangGalaxy')].sort(),[...fields('LrunesGalaxy')].sort());
  assert.deepEqual([...fields('Lo3rwangAnchor')].sort(),[...fields('LrunesAnchor')].sort());
});
test('a missing Galaxy or Anchor contract field fails before gateway data operations',()=>{
  const missing=[{...base[0],columns:base[0].columns.filter(x=>x.name!=='content')},base[1]];
  assert.throws(()=>validatePortableScopeSchema(missing,
    {engine:'postgres',namespace:'silver',scopeId:'demo'}),/missing columns: content/);
  const noAttr=[base[0],{...base[1],columns:base[1].columns.filter(x=>x.name!=='attr')}];
  assert.throws(()=>validatePortableScopeSchema(noAttr,
    {engine:'postgres',namespace:'silver',scopeId:'demo'}),/missing columns: attr/);
});
test('independent portable target contracts are only read-only metadata',()=>{
  const gateway=readModule('app/loc/providers/kysely-schema.mjs');
  assert.match(gateway,/schema as fixedZModel/);
  assert.match(gateway,/EXPECTED_SCOPE_FIELDS/);
  assert.doesNotMatch(gateway,/\b(?:createTable|alterTable|dropTable|createIndex|migrat\w*|\.rpc\()\s*\(/i);
});
function readModule(path){
  return requireText(new URL('../'+path,import.meta.url));
}
import {readFileSync as requireText} from 'node:fs';
