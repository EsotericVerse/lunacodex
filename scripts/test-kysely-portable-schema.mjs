import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('app/loc/providers/kysely-schema.mjs','utf8');
const create=new Function('sql','portableRelation',source
  .replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  ';return ensurePortableScopeSchema;')(
  Object.assign((strings,...values)=>({strings,values}),{raw:value=>value}),
  (table,engine,ns)=>engine==='mysql'?table:ns+'.'+table
);

function mockDb(existing=[]){
  const tables=[],indexes=[];
  const db={
    introspection:{getTables:async()=>existing},
    schema:{
      createTable(table){
        const entry={table,columns:[],columnTypes:{}};tables.push(entry);
        const chain={ifNotExists(){return this},
          addColumn(name,type,callback){
            entry.columns.push(name);entry.columnTypes[name]=type;
            const column={notNull(){return this},primaryKey(){return this},
              defaultTo(value){entry.defaults??={};entry.defaults[name]=value;return this}};
            if(callback)callback(column);
            return this;
          },modifyEnd(){return this},
          execute:async()=>{}};
        return chain;
      },
      createIndex(name){
        const item={name};indexes.push(item);
        return {on(table){item.table=table;return this},
          column(column){item.column=column;return this},execute:async()=>{}};
      }
    }
  };
  return {db,tables,indexes};
}

for(const [engine,namespace] of [['postgres','public'],['mysql','silver'],['mssql','dbo']]){
  test(engine+' initializes exactly Galaxy and Anchor with UID and eight permissions',async()=>{
    const {db,tables,indexes}=mockDb();
    const out=await create(db,{engine,namespace,scopeId:'writer'});
    assert.equal(tables.length,2);
    assert.deepEqual(tables.map(t=>t.table),engine==='mysql'
      ?['writer_galaxy','writer_anchor']
      :[namespace+'.writer_galaxy',namespace+'.writer_anchor']);
    const galaxy=tables[0].columns,anchor=tables[1].columns;
    assert.ok(galaxy.includes('uid')&&galaxy.includes('content')&&galaxy.includes('date'));
    for(const column of ['statics','culture','search','trace','list','keyword','extract','others']){
      assert.ok(galaxy.includes(column));
      assert.equal(tables[0].defaults[column],false,'new Galaxy articles must be private until published');
    }
    assert.ok(anchor.includes('uid')&&anchor.includes('type')&&anchor.includes('attr'));
    assert.ok(!galaxy.includes('able'));
    assert.equal(indexes.length,2);
    assert.equal(out.created.length,2);
  });
}
test('PostgreSQL Galaxy uses native SQL arrays, with JSONB confined to Anchor',async()=>{
  const {db,tables}=mockDb();
  await create(db,{engine:'postgres',namespace:'silver',scopeId:'writer'});
  assert.equal(tables[0].columnTypes.target_id,'text[]');
  assert.equal(tables[0].columnTypes.media_link,'varchar[]');
  assert.ok(!Object.values(tables[0].columnTypes).includes('jsonb'));
  assert.equal(tables[1].columnTypes.attr,'jsonb');
});

test('already present Scope tables are never replaced',async()=>{
  const {db,tables}=mockDb([{schema:'dbo',name:'writer_galaxy'},
    {schema:'dbo',name:'writer_anchor'}]);
  const out=await create(db,{engine:'mssql',namespace:'dbo',scopeId:'writer'});
  assert.equal(out.created.length,0);
  assert.equal(tables.length,0);
});


test('MySQL existing tables are recognized regardless of database name',async()=>{
  const {db,tables}=mockDb([
    {schema:'client_database',name:'writer_galaxy'},
    {schema:'client_database',name:'writer_anchor'}
  ]);
  const out=await create(db,{engine:'mysql',namespace:'',scopeId:'writer'});
  assert.deepEqual(out.created,[]);
  assert.deepEqual(tables,[]);
});


test('verified LOC administrator is checked before touching an external SQL host',()=>{
  const gateway=fs.readFileSync('app/loc/gateway/sql-handler.ts','utf8');
  const start=gateway.indexOf('async function saveDatabaseTarget(');
  const end=gateway.indexOf('\nasync function executeRequest(',start);
  assert.ok(start>=0&&end>start);
  const implementation=gateway.slice(start,end);
  const authorized=implementation.indexOf('await checkAdminRole(claims)');
  const connection=implementation.indexOf('await databaseForTarget(target,{profileLookup:async()=>profile})');
  assert.ok(authorized>=0&&connection>=0&&authorized<connection,
    'Reject unauthorized LOC requests before attempting external database DDL');
});


test('rejects existing incompatible Galaxy/Anchor before selecting a new SQL target',()=>{
  const check=new Function('sql','portableRelation',source
    .replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return validatePortableScopeSchema;')(
    Object.assign((strings,...values)=>({strings,values}),{raw:value=>value}),
    (table,engine,ns)=>engine==='mysql'?table:ns+'.'+table);
  const names=['uid','title','content','createtime','location','UpdateTime',
    'url','source_id','target_id','ref_id','site','place_id','media_link',
    'date','site_id','statics','culture','search','trace','list','keyword',
    'extract','others'];
  const entries=[
    {name:'writer_galaxy',schema:'dbo',columns:names.map(name=>({name}))},
    {name:'writer_anchor',schema:'dbo',columns:['uid','type','title',
      'description','invisible','attr','createtime'].map(name=>({name}))}
  ];
  assert.deepEqual(check(entries,{engine:'mssql',namespace:'dbo',scopeId:'writer'}),
    {scopeId:'writer',galaxy:'dbo.writer_galaxy',anchor:'dbo.writer_anchor'});
  const broken=JSON.parse(JSON.stringify(entries));
  broken[0].columns=broken[0].columns.filter(row=>row.name!=='search');
  assert.throws(()=>check(broken,{engine:'mssql',namespace:'dbo',scopeId:'writer'}),/search/);
});

test('default PostgreSQL public namespace recognizes already installed tables',async()=>{
  const {db,tables,indexes}=mockDb([
    {schema:'public',name:'writer_galaxy'},
    {schema:'public',name:'writer_anchor'}
  ]);
  assert.deepEqual(await create(db,{engine:'postgres',scopeId:'writer'}),{created:[]});
  assert.equal(tables.length,0);
  assert.equal(indexes.length,0);
});

test('default SQL Server dbo namespace recognizes already installed tables',async()=>{
  const {db,tables,indexes}=mockDb([
    {schema:'dbo',name:'writer_galaxy'},
    {schema:'dbo',name:'writer_anchor'}
  ]);
  assert.deepEqual(await create(db,{engine:'mssql',scopeId:'writer'}),{created:[]});
  assert.equal(tables.length,0);
  assert.equal(indexes.length,0);
});

test('a matching relation in another SQL schema must not suppress installation',async()=>{
  const {db,tables}=mockDb([
    {schema:'other',name:'writer_galaxy'},
    {schema:'other',name:'writer_anchor'}
  ]);
  const result=await create(db,{engine:'postgres',scopeId:'writer'});
  assert.deepEqual(result.created,['writer_galaxy','writer_anchor']);
  assert.deepEqual(tables.map(row=>row.table),['public.writer_galaxy','public.writer_anchor']);
});

test('portable schema validator honors native default namespaces and rejects shadow tables',()=>{
  const validate=new Function('sql','portableRelation',source
    .replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return validatePortableScopeSchema;')(
    Object.assign((strings,...values)=>({strings,values}),{raw:value=>value}),
    (table,engine,ns)=>engine==='mysql'?table:(ns|| (engine==='mssql'?'dbo':'public'))+'.'+table);
  const galaxy=['uid','title','content','createtime','location','UpdateTime',
    'url','source_id','target_id','ref_id','site','place_id','media_link',
    'date','site_id','statics','culture','search','trace','list','keyword',
    'extract','others'];
  const anchor=['uid','type','title','description','invisible','attr','createtime'];
  for(const [engine,namespace] of [['postgres','public'],['mssql','dbo']]){
    const tables=[
      {schema:namespace,name:'writer_galaxy',columns:galaxy.map(name=>({name}))},
      {schema:namespace,name:'writer_anchor',columns:anchor.map(name=>({name}))}
    ];
    assert.deepEqual(validate(tables,{engine,scopeId:'writer'}),{
      scopeId:'writer',
      galaxy:namespace+'.writer_galaxy',
      anchor:namespace+'.writer_anchor'
    });
    const wrong=tables.map(table=>({...table,schema:'shadow'}));
    assert.throws(()=>validate(wrong,{engine,scopeId:'writer'}),/Missing LOC table/);
  }
});
