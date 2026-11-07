import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler
} from 'kysely';
import {schema as fixed} from '../zenstack/schema.mjs';
import {scopedZModelSchema,scopedZModelColumns} from '../zenstack/scoped-schema.mjs';
import {createScopedLocClient} from '../zenstack/client.mjs';
import {validatePortableScopeSchema} from '../app/loc/providers/kysely-schema.mjs';

const source=readFileSync(new URL('../zenstack/scoped-schema.mjs',import.meta.url),'utf8');
const expectedKeys=kind=>Object.keys(fixed.models['Lo3rwang'+kind].fields);
const mapAttr=(model,name)=>model.attributes.find(x=>x.name===name)?.args?.[0]?.value?.value;

test('native ZenStack scope schema derives all three fixed physical models',()=>{
  const scope=scopedZModelSchema({scopeId:'lo3rwang',namespace:'silver'});
  assert.equal(scope.provider.type,'postgresql');
  assert.equal(Object.keys(scope.models).length,3);
  assert.deepEqual(Object.keys(scope.models).sort(),['Anchor','Blocks','Galaxy']);
  for(const kind of ['Galaxy','Anchor','Blocks']){
    const actual=scope.models[kind];
    assert.deepEqual(Object.keys(actual.fields).sort(),expectedKeys(kind).sort());
    assert.deepEqual(actual.idFields,['uid']);
    assert.equal(mapAttr(actual,'@@map'),'lo3rwang_'+kind.toLowerCase());
    assert.equal(mapAttr(actual,'@@schema'),'silver');
    assert.deepEqual(actual.attributes.map(x=>x.name),['@@map','@@schema'],
      'scoped ORM never invents public/policy permissions');
  }
  assert.equal(Object.keys(fixed.models).length,17);
});

test('two independent databases can project identical scope names without modifying fixed models',()=>{
  const a=scopedZModelSchema({scopeId:'lo3rwang',namespace:'silver'});
  const b=scopedZModelSchema({scopeId:'lo3rwang',namespace:'custom'});
  const c=scopedZModelSchema({scopeId:'lrunes',namespace:'silver'});
  assert.equal(mapAttr(a.models.Galaxy,'@@map'),mapAttr(b.models.Galaxy,'@@map'));
  assert.notEqual(mapAttr(a.models.Galaxy,'@@schema'),mapAttr(b.models.Galaxy,'@@schema'));
  assert.notEqual(mapAttr(a.models.Galaxy,'@@map'),mapAttr(c.models.Galaxy,'@@map'));
  assert.equal(mapAttr(fixed.models.Lo3rwangGalaxy,'@@map'),'lo3rwang_galaxy');
  assert.equal(mapAttr(fixed.models.Lo3rwangGalaxy,'@@schema'),'silver');
});

test('Scope and namespace identifiers are validated before any dialect is instantiated',()=>{
  for(const scopeId of ['', 'LOC','bad.scope','bad_scope','../loc'])
    assert.throws(()=>scopedZModelSchema({scopeId}),/Invalid trusted LOC Scope/);
  for(const namespace of ['','BAD','s;drop','db.name','../schema'])
    assert.throws(()=>scopedZModelSchema({scopeId:'lo3rwang',namespace}),/Invalid trusted LOC Scope/);
  assert.throws(()=>createScopedLocClient({scopeId:'lo3rwang',dialect:{}}),
    /trusted Kysely dialect/);
});

test('portable schema validation reuses scoped ZModel field lists',()=>{
  const columns=scopedZModelColumns({scopeId:'demo',namespace:'silver'});
  assert.deepEqual(columns.galaxy,expectedKeys('Galaxy'));
  assert.deepEqual(columns.anchor,expectedKeys('Anchor'));
  assert.deepEqual(columns.blocks,expectedKeys('Blocks'));
  const tables=[
    {name:'demo_galaxy',schema:'silver',columns:columns.galaxy.map(name=>({name}))},
    {name:'demo_anchor',schema:'silver',columns:columns.anchor.map(name=>({name}))}
  ];
  const result=validatePortableScopeSchema(tables,{
    engine:'postgres',namespace:'silver',scopeId:'demo'
  });
  assert.ok(result.galaxy);assert.ok(result.anchor);
  assert.throws(()=>validatePortableScopeSchema(
    [tables[0],{...tables[1],columns:tables[1].columns.filter(x=>x.name!=='attr')}],
    {engine:'postgres',namespace:'silver',scopeId:'demo'}),/missing columns: attr/);
});

test('real ZenStack V3 client compiles bounded native scope queries using one injected Kysely dialect',async()=>{
  let connections=0;
  const executed=[];
  const driver=new DummyDriver();
  const original=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    connections++;
    const connection=await original();
    const execute=connection.executeQuery.bind(connection);
    connection.executeQuery=async query=>{
      executed.push(query);
      return execute(query);
    };
    return connection;
  };
  const dialect={
    createDriver:()=>driver,
    createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  };
  const db=createScopedLocClient({scopeId:'lo3rwang',dialect});
  await db.galaxy.findMany({
    where:{culture:true},
    select:{uid:true,title:true,date:true},
    take:7
  });
  await db.anchor.findMany({
    where:{type:'era',invisible:false},
    select:{uid:true,type:true,title:true,attr:true},
    take:5
  });
  await db.blocks.findMany({
    where:{page_name:'index'},
    select:{uid:true,block_title:true},
    take:3
  });
  assert.equal(executed.length,3,'one SQL operation per native ORM read');
  assert.ok(connections>=3,'all operations use the supplied driver, never a new pool');
  assert.match(executed[0].sql,/"silver"\."lo3rwang_galaxy"/);
  assert.match(executed[1].sql,/"silver"\."lo3rwang_anchor"/);
  assert.match(executed[2].sql,/"silver"\."lo3rwang_blocks"/);
  assert.match(executed[0].sql,/limit|LIMIT/i);
  assert.ok(executed[0].parameters.includes(true));
  assert.ok(executed[0].parameters.includes(7));
});

test('scoped ZenStack model projection never performs DDL, auth checks or database I/O at load',()=>{
  assert.doesNotMatch(source,/\b(?:createTable|alterTable|dropTable|executeQuery|migrate|rpc|fetch)\s*\(/i);
  assert.doesNotMatch(source,/@@allow\(['"]read['"],\s*true\)/);
  assert.equal(Object.keys(scopedZModelSchema({scopeId:'lo3rwang'}).models).length,3);
});
