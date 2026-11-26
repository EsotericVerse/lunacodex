import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCrossEnginePublicRead,authorizeCrossEngineQuery,
  getSqlRuntimeCapabilities,planPortableInsertBatches}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect}
  from 'kysely';
import {buildKyselyUpsertQuery,buildKyselySelectQuery,
  planKyselyUpsertBatches,executeKyselySelectStream}
  from '../app/loc/providers/kysely-runtime.mjs';
import {createKyselyDialect} from '../modules/loc/dialect/index.mjs';
import {POSTGRES_SQL_TYPE,postgresCursorConstructor,postgresDialectConfig}
  from '../modules/loc/dialect/postgres.mjs';
import {MYSQL_SQL_TYPE} from '../modules/loc/dialect/mysql.mjs';
import {MSSQL_SQL_TYPE} from '../modules/loc/dialect/mssql.mjs';

const postgres=new Kysely({dialect:new PostgresDialect({pool:{
  connect:async()=>{throw Error('compile-only: no database connection');}
}})});
const mysql=new Kysely({dialect:new MysqlDialect({pool:{
  getConnection(){throw Error('compile-only: no database connection');},
  end(){}
}})});
const mssql=new Kysely({dialect:new MssqlDialect({
  tarn:{Pool:class{constructor(){}},options:{max:1,min:0}},
  tedious:{connectionFactory(){},ISOLATION_LEVEL:{},Request:class{},TYPES:{}}
})});
const req={schema:'silver',table:'lo3rwang_galaxy',
  values:[{uid:'AAAA0001',title:'one'},{uid:'BBBB0002',title:'two'}],
  onConflict:['uid']};

test('PostgreSQL UPSERT continues to use row-specific EXCLUDED values',()=>{
  const compiled=buildKyselyUpsertQuery(postgres,req,'postgres').compile();
  assert.match(compiled.sql,/on conflict/i);
  assert.match(compiled.sql,/excluded.*title/i);
  assert.equal(compiled.parameters.length,4);
});

test('SQL Types expose independent parameter, row, byte and stream budgets',()=>{
  assert.equal(POSTGRES_SQL_TYPE.streamStrategy,'pg-cursor');
  assert.equal(MYSQL_SQL_TYPE.streamStrategy,'mysql2-readable');
  assert.equal(MSSQL_SQL_TYPE.streamStrategy,'tedious-request');
  assert.equal(getSqlRuntimeCapabilities('postgres').streaming.chunkRows,256);
  assert.equal(getSqlRuntimeCapabilities('mysql').insertMaxRows,1000);
  assert.equal(getSqlRuntimeCapabilities('mssql').upsertParameterLimit,1900);
});

test('PostgreSQL dialect installs pg-cursor by default and allows a test override',()=>{
  assert.equal(typeof postgresCursorConstructor,'function');
  assert.equal(postgresDialectConfig({pool:{}}).cursor,postgresCursorConstructor);
  class CustomCursor{}
  assert.equal(postgresDialectConfig({pool:{},cursor:CustomCursor}).cursor,CustomCursor);
  assert.ok(createKyselyDialect('postgres',{pool:{connect(){},end(){}}}) instanceof PostgresDialect);
});

test('PostgreSQL uses native ILIKE and NULLS LAST while MySQL and MSSQL keep their own syntax',()=>{
  const input={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid'],
    filters:[{column:'title',operator:'contains',value:'Luna'}],
    orders:[{column:'date',ascending:false}],federatedNullsLast:true};
  const pg=buildKyselySelectQuery(postgres,input,{dialect:'postgres'}).query.compile().sql;
  const my=buildKyselySelectQuery(mysql,input,{dialect:'mysql'}).query.compile().sql;
  const ms=buildKyselySelectQuery(mssql,input,{dialect:'mssql'}).query.compile().sql;
  assert.match(pg,/"title" ilike/i);
  assert.match(pg,/"date" desc nulls last/i);
  assert.match(my,/lower\(`title`\) like/i);
  assert.match(my,/case when `date` is null/i);
  assert.match(ms,/lower\(\[title\]\) like/i);
  assert.match(ms,/case when \[date\] is null/i);
});

test('COUNT query remains an unpaged aggregate when the row query has a page limit',()=>{
  const input={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid'],limit:25,count:true};
  const built=buildKyselySelectQuery(postgres,input,{dialect:'postgres'});
  assert.match(built.query.compile().sql,/limit/i);
  assert.doesNotMatch(built.countQuery.compile().sql,/limit/i);
});

test('UPSERT planner respects the selected SQL Type bind ceiling and preserves duplicate-key boundaries',()=>{
  const wideRows=Array.from({length:1000},(_,index)=>({
    uid:String(index).padStart(8,'0'),
    ...Object.fromEntries(Array.from({length:99},(_,column)=>['c'+column,'x']))
  }));
  const pg=planKyselyUpsertBatches(wideRows,'uid',{dialect:'postgres'});
  const ms=planKyselyUpsertBatches(wideRows,'uid',{dialect:'mssql'});
  assert.ok(ms.length>pg.length);
  const duplicate=planKyselyUpsertBatches([
    {uid:'AAAA0001',title:'one'},
    {uid:'BBBB0002',title:'two'},
    {uid:'AAAA0001',title:'three'}
  ],'uid',{dialect:'postgres'});
  assert.deepEqual(duplicate.map(batch=>batch.map(row=>row.uid)),
    [['AAAA0001','BBBB0002'],['AAAA0001']]);
  assert.deepEqual(duplicate.flat().map(row=>row.title),['one','two','three']);
});

test('portable INSERT planner applies SQL Type limits, UTF-8 bytes and preserves source order',()=>{
  const rows=Array.from({length:2100},(_,index)=>({
    uid:String(index).padStart(8,'0'),title:'符文'+index,content:'正文'
  }));
  const pg=planPortableInsertBatches(rows,'postgres');
  const mysqlBatches=planPortableInsertBatches(rows,'mysql');
  const mssqlBatches=planPortableInsertBatches(rows,'mssql');
  assert.equal(pg.flat().length,rows.length);
  assert.equal(mysqlBatches.flat().length,rows.length);
  assert.equal(mssqlBatches.flat().length,rows.length);
  assert.ok(mysqlBatches.length>=3);
  assert.ok(mssqlBatches.length>=4);
  assert.deepEqual(pg.flat(),rows);
  assert.deepEqual(mysqlBatches.flat(),rows);
  assert.deepEqual(mssqlBatches.flat(),rows);
  const bounded=planPortableInsertBatches(rows,'mysql',{maxBytes:200});
  assert.ok(bounded.every(batch=>batch.length===1));
});

test('PostgreSQL SELECT streaming reads bounded cursor chunks and validates rows',async()=>{
  const source=[{uid:'AAAA0001'},{uid:'BBBB0002'},{uid:'CCCC0003'}];
  const opened=[];
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;this.index=0;this.closed=false;opened.push(this);}
    async read(size){const result=source.slice(this.index,this.index+size);this.index+=result.length;return result;}
    async close(){this.closed=true;}
  }
  const client={
    processID:123,
    query(query){if(query instanceof FakeCursor)return query;throw Error('Unexpected non-cursor query');},
    release(){}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const input={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']};
  const result=await executeKyselySelectStream(db,input,{dialect:'postgres',chunkSize:2});
  const received=[];
  for await(const row of result.data)received.push(row.uid);
  assert.deepEqual(received,['AAAA0001','BBBB0002','CCCC0003']);
  assert.equal(opened.length,1);
  assert.equal(opened[0].closed,true);
  await db.destroy();
});

{
const read=(schema,table)=>({
  kind:'query',operation:'select',schema,table,columns:['uid']
});

test('anonymous reads cannot expose the private api.manage authority registry',async()=>{
  assert.throws(()=>assertCrossEnginePublicRead(read('api','manage')),
    error=>error?.httpStatus===403);
  await assert.rejects(authorizeCrossEngineQuery(null,read('api','manage'),
    {role:'anon'}),error=>error?.httpStatus===403);
});

test('anonymous reads cannot expose raw Scope configuration rows',()=>{
  for(const table of ['loc','lo3rwang','family']){
    assert.throws(()=>assertCrossEnginePublicRead(read('silver',table)),
      error=>error?.httpStatus===403);
  }
});

test('public SQL policy restricts Galaxy and Anchor to published rows and denies writes',()=>{
  for(const table of ['lo3rwang_galaxy','lo3rwang_anchor']){
    assert.deepEqual(assertCrossEnginePublicRead(read('silver',table)),{publicOnly:true});
  }
  assert.throws(()=>assertCrossEnginePublicRead({
    ...read('silver','lo3rwang_galaxy'),operation:'update'
  }),error=>error?.httpStatus===403);
});

}
