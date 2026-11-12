import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validatePortableScopeSchema as validate} from '../app/loc/providers/kysely-schema.mjs';
import {scopedZModelColumns} from '../zenstack/scoped-schema.mjs';
import {createKyselyDialect,KyselyDialectConstructors} from '../app/loc/providers/kysely-dialects.mjs';

const source=fs.readFileSync('app/loc/providers/kysely-schema.mjs','utf8');

// Validate directly against the real frozen ZModel, not an eval'd function
// with a stale parameter list or duplicated physical field names.
const {galaxy,anchor}=scopedZModelColumns({scopeId:'writer',namespace:'silver'});
const entries=(schema)=>[
  {schema,name:'writer_galaxy',columns:galaxy.map(name=>({name}))},
  {schema,name:'writer_anchor',columns:anchor.map(name=>({name}))}
];

test('portable Scope validation supports existing PostgreSQL, MySQL, SQL Server without DDL',()=>{
  for(const [engine,namespace] of [['postgres','public'],['mysql','silver'],['mssql','dbo']]){
    assert.deepEqual(validate(entries(namespace),{engine,namespace,scopeId:'writer'}),{
      scopeId:'writer',
      galaxy:engine==='mysql'?'writer_galaxy':namespace+'.writer_galaxy',
      anchor:engine==='mysql'?'writer_anchor':namespace+'.writer_anchor'
    });
  }
});

test('validate rejects missing Galaxy permissions or Anchor creation time',()=>{
  for(const field of ['uid','statics','culture','search','trace','list','keyword',
    'extract','others']){
    const malformed=entries('dbo');
    malformed[0].columns=malformed[0].columns.filter(c=>c.name!==field);
    assert.throws(()=>validate(malformed,{engine:'mssql',namespace:'dbo',scopeId:'writer'}),
      new RegExp(field));
  }
  const noCreateTime=entries('public');
  noCreateTime[1].columns=noCreateTime[1].columns.filter(c=>c.name!=='createtime');
  assert.throws(()=>validate(noCreateTime,{engine:'postgres',scopeId:'writer'}),
    /createtime/);
});

test('portable validator rejects mismatched namespace and invalid Scope IDs',()=>{
  for(const engine of ['postgres','mssql']){
    const namespace=engine==='postgres'?'public':'dbo';
    assert.throws(()=>validate(entries('shadow'),{engine,namespace,scopeId:'writer'}),
      /Missing LOC table/);
  }
  assert.throws(()=>validate(entries('public'),{engine:'postgres',scopeId:'Invalid-Scope'}),
    /Invalid portable LOC Scope/);
});

test('the frozen portable adapter cannot create or migrate database objects',()=>{
  assert.match(source,/export function validatePortableScopeSchema/);
  assert.doesNotMatch(source,/\b(?:ensurePortableScopeSchema|createTable|createIndex|create\s+(?:table|index|policy)|alter\s+table|drop\s+table|grant\s+)\b/i);
  assert.doesNotMatch(source,/\.schema\.(?:createTable|createIndex)/);
});

test('the installed Kysely package supplies all three dialect constructors',()=>{
  for(const [engine,name] of [['postgres','PostgresDialect'],['mysql','MysqlDialect'],['mssql','MssqlDialect']]){
    const config=engine==='mssql'?{tarn:{},tedious:{}}:{pool:{}};
    const dialect=createKyselyDialect(engine,config);
    assert.equal(KyselyDialectConstructors[engine].name,name);
    assert.equal(dialect.constructor.name,name);
  }
});
