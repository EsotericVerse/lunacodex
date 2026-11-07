import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// LOC databases are frozen. The former portable schema installer was
// deliberately removed; validate existing Galaxy/Anchor tables instead.
const source=fs.readFileSync('app/loc/providers/kysely-schema.mjs','utf8');
const validate=new Function('portableRelation',source
  .replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  ';return validatePortableScopeSchema;')(
  (table,engine,namespace)=>engine==='mysql'?table:
    (namespace||(engine==='mssql'?'dbo':'public'))+'.'+table
);

const galaxy=['uid','title','content','createtime','location','UpdateTime',
  'url','source_id','target_id','ref_id','site','place_id','media_link',
  'date','site_id','statics','culture','search','trace','list','keyword',
  'extract','others'];
const anchor=['uid','type','title','description','invisible','attr','createtime'];
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
