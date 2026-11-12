import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyModeledSqlFields,normalizeModeledTypeDifferences}
  from '../zenstack/model-column-guard.mjs';
import {parsePortableOrExpression}
  from '../app/loc/providers/portable-search.mjs';

const modeled=(query={})=>verifyModeledSqlFields({
  schema:'silver',table:'lo3rwang_galaxy',columns:['uid'],
  filters:[],orders:[],...query
});

test('nested OR and AND fields are checked by the Galaxy ZModel',()=>{
  const tree=parsePortableOrExpression(
    'uid.eq.Ab12Cd34,and(site.eq.threads,or(culture.eq.true,statics.eq.false))');
  assert.equal(modeled({orFilters:[tree]}),true);
  assert.throws(()=>modeled({orFilters:[
    parsePortableOrExpression('uid.eq.Ab12Cd34,or(unknown_field.eq.x,title.eq.y)')
  ]}),/Column is not defined in the LOC ZModel: unknown_field/);
  assert.throws(()=>modeled({orFilters:[
    parsePortableOrExpression('uid.eq.Ab12Cd34'),
    parsePortableOrExpression('not_a_galaxy_column.eq.y')
  ]}),/not_a_galaxy_column/);
});

test('one modeled predicate check handles fixed, scoped, and composite keys',()=>{
  const predicate=parsePortableOrExpression('record_id.eq.abc');
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'lrunes_daily',columns:['record_id'],orFilters:[predicate]
  }),true);
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'demo_galaxy',columns:['uid'],
    orFilters:[parsePortableOrExpression('statics.eq.true')]
  }),true);
  assert.throws(()=>verifyModeledSqlFields({
    schema:'silver',table:'demo_anchor',columns:['uid'],
    orFilters:[parsePortableOrExpression('nonexistent.eq.x')]
  }),/nonexistent/);
});

test('ZModel leaves existing unmodeled external SQL tables to their dialect',()=>{
  assert.equal(verifyModeledSqlFields({
    schema:'silver',table:'existing_external',columns:['custom'],
    orFilters:[parsePortableOrExpression('unknown_field.eq.y')]
  }),false);
  assert.throws(()=>modeled({orFilters:[{type:'and',items:'not an array'}]}),
    /Invalid LOC ZModel SQL predicate group/);
});

test('Boolean normalization retains the same parsed AST without re-parsing',()=>{
  const ast=parsePortableOrExpression('culture.eq.true,statics.eq.false');
  const adjusted=normalizeModeledTypeDifferences({
    schema:'silver',table:'lo3rwang_galaxy',orFilters:[ast]
  }).orFilters[0];
  assert.equal(adjusted.items[0].value,true);
  assert.equal(adjusted.items[1].value,false);
  const publicSource=readFileSync(new URL('../app/loc/server/native-public-query.mjs',import.meta.url),'utf8');
  const managedSource=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.match(publicSource,/const parsedOrFilters=orFilters.map\(parsePortableOrExpression\)/);
  assert.match(publicSource,/orFilters:\[source\]/);
  assert.match(managedSource,/verifyModeledSqlFields\(\{schema,table,columns,filters,orFilters,orders,/);
});
