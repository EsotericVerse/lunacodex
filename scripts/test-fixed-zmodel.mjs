import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schema as fixedSchema} from '../zenstack/schema.mjs';

const snapshot=JSON.parse(readFileSync(new URL('../zenstack/schema-contract.json',import.meta.url),'utf8'));
// Windows git checkouts may use CRLF; ZModel parsing is line-oriented.
const source=readFileSync(new URL('../zenstack/schema.zmodel',import.meta.url),'utf8')
  .replace(/\r\n?/g,'\n');
const native={
  text:['String','@db.Text'],
  varchar:['String','@db.VarChar'],
  bpchar:['String','@db.Char'],
  bool:['Boolean',''],
  int2:['Int','@db.SmallInt'],
  int4:['Int','@db.Integer'],
  int8:['BigInt','@db.BigInt'],
  timestamptz:['DateTime','@db.Timestamptz'],
  timestamp:['DateTime','@db.Timestamp'],
  date:['DateTime','@db.Date'],
  numeric:['Decimal','@db.Decimal'],
  jsonb:['Json','@db.JsonB'],
  json:['Json','@db.Json'],
  _text:['String[]','@db.Text'],
  _varchar:['String[]','@db.VarChar'],
  _int2:['Int[]','@db.SmallInt'],
  _int4:['Int[]','@db.Integer']
};
const modelName=table=>table.split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
const blocks=[...source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
const physical=new Map();
for(const [,name,body] of blocks){
  const table=body.match(/^\s+@@map\("([^"]+)"\)\s*$/m)?.[1];
  assert.ok(table,'missing physical table mapping for '+name);
  assert.ok(body.includes('@@schema("'+(table==='manage'?'api':'silver')+'")'),
    'Unexpected namespace for '+table);
  assert.equal(name,modelName(table),'unexpected model name');
  assert.ok(!physical.has(table),'duplicate physical model: '+table);
  const fields=new Map();
  for(const line of body.split('\n')){
    const m=line.match(/^\s{4}([A-Za-z_]\w*)\s+((?:String|Boolean|Int|BigInt|Float|Decimal|DateTime|Json|Bytes)(?:\[\]|\?)?)(?:[ \t]+(.*))?$/);
    if(m){
      assert.ok(!fields.has(m[1]),'duplicate field: '+table+'.'+m[1]);
      fields.set(m[1],{type:m[2],attributes:m[3]||''});
    }
  }
  physical.set(table,{body,fields});
}

test('ZModel maps exactly to the frozen silver physical table and column contract',()=>{
  assert.equal(snapshot.schema,'silver');
  assert.equal(snapshot.tables.length,17);
  assert.equal(physical.size,snapshot.tables.length);
  let total=0;
  for(const t of snapshot.tables){
    const model=physical.get(t.table);
    assert.ok(model,'missing table: '+t.table);
    assert.equal(model.fields.size,t.columns.length,'column count drift for '+t.table);
    assert.deepEqual([...model.fields.keys()].sort(),t.columns.map(x=>x.name).sort(),
      'column name drift for '+t.table);
    const ids=t.pk;
    if(ids.length===1)assert.match(model.fields.get(ids[0]).attributes,/(?:^|\s)@id(?:\s|$)/);
    else assert.ok(model.body.includes('@@id(['+ids.join(', ')+'])'));
    for(const keys of t.uniques||[])assert.ok(model.body.includes('@@unique(['+keys.join(', ')+'])'),
      'missing existing unique constraint on '+t.table);
    for(const col of t.columns){
      total++;
      const field=model.fields.get(col.name);
      assert.ok(field,'missing '+t.table+'.'+col.name);
      assert.ok(native[col.format],'unexpected source type '+col.format);
      const [kind,dbType]=native[col.format];
      // ZModel cannot express nullable SQL scalar lists (String[]?, Int[]?).
      // Those nullable arrays stay on Kysely's SQL/driver path.
      const optional=col.nullable&&!kind.endsWith('[]')?'?':'';
      assert.equal(field.type,kind+optional,t.table+'.'+col.name+' scalar type changed');
      if(dbType)assert.ok(field.attributes.includes(dbType),
        t.table+'.'+col.name+' native database type changed');
      if(col.generated)assert.ok(!field.attributes.includes('@default('),
        t.table+'.'+col.name+' is a stored generated column');
    }
  }
  assert.equal(total,snapshot.tables.reduce((sum,table)=>sum+table.columns.length,0));
});

test('Anchor remains the extension point; model does not declare migrations or bypass authorization',()=>{
  for(const table of ['lo3rwang_anchor','lrunes_anchor']){
    const anchor=physical.get(table);
    assert.ok(anchor);
    assert.equal(anchor.fields.get('uid').type,'String');
    assert.equal(anchor.fields.get('type').type,'String');
    assert.equal(anchor.fields.get('attr').type,'Json');
    assert.equal(anchor.fields.get('num').type,'BigInt');
    assert.match(anchor.fields.get('attr').attributes,/@db\.JsonB/);
    assert.equal(anchor.fields.size,8);
  }
  assert.doesNotMatch(source,/^\s*generator\s+/m);
  assert.equal((source.match(/^\s*@@allow\s*\(/gm)||[]).length,6);
  assert.match(source,/plugin policy \{/);
  assert.doesNotMatch(source,/^\s*@@deny\s*\(/m);
});

test('ZenStack V3 runtime schema bridge stays in sync with the frozen contract',async()=>{
  const {schema}=await import('../zenstack/schema.mjs');
  assert.equal(schema.provider.type,'postgresql');
  assert.equal(schema.provider.defaultSchema,'silver');
  assert.ok(schema.plugins.policy);
  for(const name of ['Manage','Loc','Lo3rwang','Lrunes']){
    const model=schema.models[name];
    assert.ok(model,'missing fixed policy model '+name);
    const rules=model.attributes.filter(attr=>attr.name==='@@allow');
    assert.equal(rules.length,['Manage','Loc'].includes(name)?2:1,
      'only global Registry models have administrator mutation policies');
    assert.equal(rules[0].args[0].value.value,'read');
    assert.equal(rules[0].args[1].value.value,true);
    if(['Manage','Loc'].includes(name)){
      assert.equal(rules[1].args[0].value.value,'update,delete');
      const guard=rules[1].args[1].value;
      assert.equal(guard.kind,'binary');
      assert.equal(guard.left.kind,'member');
      assert.equal(guard.left.receiver.function,'auth');
      assert.equal(guard.op,'>=');
      assert.deepEqual(guard.left.members,['roleLevel']);
      assert.equal(guard.right.value,4);
    }
  }
  assert.equal(schema.authType,'LocPrincipal');
  assert.deepEqual(Object.keys(schema.typeDefs.LocPrincipal.fields).sort(),
    ['groupIds','id','role','roleLevel','scopeIds']);
  assert.equal(schema.typeDefs.LocPrincipal.fields.roleLevel.type,'Int');
  assert.equal(schema.typeDefs.LocPrincipal.fields.scopeIds.array,true);
  assert.equal(schema.typeDefs.LocPrincipal.fields.groupIds.array,true);
  assert.equal(Object.values(schema.models).flatMap(model=>model.attributes)
    .filter(attr=>attr.name==='@@allow').length,6);
  assert.equal(Object.keys(schema.models).length,snapshot.tables.length);
  for(const table of snapshot.tables){
    const model=schema.models[modelName(table.table)];
    assert.ok(model,'missing generated model '+table.table);
    assert.deepEqual(model.idFields,table.pk);
    for(const keys of table.uniques||[])
      assert.deepEqual(Object.keys(model.uniqueFields[keys.join('_')]).sort(),[...keys].sort());
    assert.equal(Object.keys(model.fields).length,table.columns.length);
    for(const col of table.columns){
      const field=model.fields[col.name];
      assert.ok(field,'missing generated field '+table.table+'.'+col.name);
      assert.equal(field.type,native[col.format][0].replace('[]',''));
      assert.equal(Boolean(field.array),col.format.startsWith('_'));
      assert.equal(Boolean(field.optional),col.nullable&&!col.format.startsWith('_'));
      assert.equal(Boolean(field.default),col.hasDefault&&!col.generated,
        'physical default metadata drift on '+table.table+'.'+col.name);
    }
    assert.equal(model.attributes.find(a=>a.name==='@@map')?.args?.[0]?.value?.value,table.table);
    assert.equal(model.attributes.find(a=>a.name==='@@schema')?.args?.[0]?.value?.value,table.schema||'silver');
  }
});

test('ZenStack V3 compiles fixed-model Kysely reads without a database or stored procedure',async()=>{
  const {createFixedLocClient}=await import('../zenstack/client.mjs');
  const {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler}=await import('kysely');
  // Kysely's compile() is pre-ZenStack name mapping; capture the SQL
  // actually executed by ZenStack instead of checking a raw compile.
  const executed=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
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
  const client=createFixedLocClient({dialect});
  await client.$qb.selectFrom('Lo3rwangAnchor')
    .select(['uid','type']).where('type','=','date').limit(5).execute();
  assert.equal(executed.length,1,'one Kysely execution');
  assert.match(executed[0].sql,/"silver"\."lo3rwang_anchor"/);
  assert.deepEqual(executed[0].parameters,['date',5]);
  await client.$qb.selectFrom('Manage').select('id').limit(1).execute();
  assert.equal(executed.length,2,'Manage model should use existing dialect');
  assert.match(executed[1].sql,/from "api"\."manage"/i,
    'ZenStack Manage MUST map to api.manage, not public.manage or silver.manage');
});

test('active LOC browser and local providers have no SQL RPC transport',()=>{
  const active=[
    '../app/loc/providers/configured.mjs',
    '../app/loc/mcp/native-operations.mjs',
    '../app/loc/db-client.mjs'
  ];
  for(const path of active){
    const code=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(code,/\.rpc\s*\(/,path+' must not invoke a database RPC');
    assert.doesNotMatch(code,/kind:\s*['"]rpc['"]/,path+' must not send an RPC request');
  }
  const bridge=readFileSync(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  assert.match(bridge,/createKyselyPublicClient/);
  assert.doesNotMatch(bridge,/createDirectDataApiClient|rest\\/v1/);
});

test('unprovisioned Local Scope never falls through to remote SQL',()=>{
  const browser=readFileSync(new URL('../app/loc/db-client.mjs',import.meta.url),'utf8');
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  assert.match(browser,/function unavailableLocal\(/);
  assert.match(browser,/isUnprovisionedLocal\(table,schemaName\)/);
  assert.doesNotMatch(browser,/createLocalSqliteAdapter|local-sqlite\.mjs/);
  assert.match(native,/verifyDelegationBoundary/);
  assert.match(native,/executePortableMcp/);
});

test('existing keyword import retains canonical UID generator; Scope admin stays schema-frozen',async()=>{
  const management=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');
  assert.match(management,/import \{allocateAnchorUid\} from '\.\.\/unified-anchor-compat\.mjs';/);
  assert.doesNotMatch(management,/silver\.new_keyword_tree_uid|KEYWORD_UID_ALPHABET|randomKeywordUid/);
  assert.doesNotMatch(admin,/import \{allocateAnchorUid\}|async function provisionScope\(/);
  assert.match(admin,/schema is frozen: Scope provisioning and deletion are unavailable/);
  // Existing Scope: INSERT with ON CONFLICT retries only after a rare PK
  // collision; the normal path requires no SELECT or large comparison.
  const begin=management.indexOf('  const assigned=new Set();');
  const stop=management.indexOf('  const readChild=',begin);
  assert.ok(begin>=0&&stop>begin);
  assert.doesNotMatch(management.slice(begin,stop),/\.selectFrom\(/);
  let inserts=0,index=0;
  const proposed=['AAAA1111','BBBB2222','CCCC3333'];
  const trx={insertInto(){return {
    values(row){this.row=row;return this;},
    onConflict(fn){fn({column(){return {doNothing(){return null;}}}});return this;},
    returning(){return this;},
    async executeTakeFirst(){
      inserts++;
      return inserts===1?undefined:{uid:this.row.uid};
    }
  }}};
  const insertCopy=new Function('trx','target','allocateAnchorUid','reject',
    management.slice(begin,stop)+'\nreturn insertCopy;')(
      trx,'silver.lo3rwang_anchor',()=>proposed[index++],
      message=>{throw Error(message)});
  const row={title:'Keyword',description:'',invisible:false};
  assert.equal(await insertCopy('item',row,{keyword:['foo']}),'BBBB2222');
  assert.equal(await insertCopy('group',row,{uid:[]}),'CCCC3333');
  assert.equal(inserts,3);

});

test('exact api.manage cutover covers live JavaScript registry and both models',()=>{
  const files=[
    '../app/loc/authorization-runtime.mjs',
    '../app/loc/db-contract.mjs',
    '../app/loc/providers/kysely-analytics.mjs',
    '../app/loc/providers/kysely-anchor.mjs',
    '../app/loc/providers/kysely-management.mjs',
    '../app/loc/providers/kysely-public.mjs',
    '../app/loc/providers/kysely-scope-admin.mjs',
    '../app/loc/providers/loc-authorization.mjs',
    '../app/loc/scope-data.js',
    '../app/loc/views/admin-panels/AdminRegistry.jsx',
    '../app/loc/views/admin-panels/DatabaseTarget.jsx'
  ];
  for(const file of files){
    const code=readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(code,/\bsilver\.manage\b/,file+' still references retired registry');
  }
  assert.match(source,/model Manage \{[\s\S]*?@@schema\("api"\)/);
  assert.equal(snapshot.tables.find(t=>t.table==='manage').schema,'api');
  const migration=readFileSync(new URL(
    '../supabase/migrations/20261106195000_api_manage_single_routing_registry.sql',import.meta.url
  ),'utf8');
  assert.match(migration,/DROP FUNCTION silver\.manage\(text,text\) RESTRICT;/);
  assert.match(migration,/DROP TABLE silver\.manage RESTRICT;/);
  assert.match(migration,/CREATE OR REPLACE VIEW api\.lo3rwang_keywords_manage AS/);
  assert.doesNotMatch(migration,/DROP .*CASCADE/);
});

test('live Kysely Scope management uses the fixed ZModel registry column contract',()=>{
  const admin=readFileSync(new URL(
    '../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');
  for(const [model,cols] of [
    ['Manage',['id','domain','directory','parent_scope_id','active','sort_order','manage_role']],
    ['Loc',['id','display_name','locale','birthday']]
  ]){
    assert.ok(fixedSchema.models[model]);
    for(const field of cols)assert.ok(fixedSchema.models[model].fields[field],
      model+'.'+field+' must match the existing physical schema');
  }
  assert.match(admin,/import \{schema as fixedSchema\} from '\.\.\/\.\.\/\.\.\/zenstack\/schema\.mjs'/);
  assert.match(admin,/\.returning\(REGISTRY_RETURNING\)/);
  assert.match(admin,/return \{data:await managedRegistry\(trx,args\),count:null\}/);
  assert.doesNotMatch(admin,/LOC_NAME_COLUMNS|create policy|create table|drop table/i);
  assert.equal((admin.match(/\.returning\(REGISTRY_RETURNING\)/g)||[]).length,2);
});
