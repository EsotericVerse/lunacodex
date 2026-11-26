import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCrossEnginePublicRead,authorizeCrossEngineQuery,
  getSqlRuntimeCapabilities,planPortableInsertBatches}
  from '../app/loc/providers/sql-engine-ports.mjs';
import {Kysely,PostgresDialect,MysqlDialect,MssqlDialect}
  from 'kysely';
import {buildKyselyUpsertQuery,buildKyselySelectQuery,
  planKyselyUpsertBatches,executeKyselyQuery}
  from '../app/loc/providers/kysely-runtime.mjs';
import {createKyselyDialect} from '../modules/loc/dialect/index.mjs';
import {POSTGRES_SQL_TYPE,postgresCursorConstructor,postgresDialectConfig}
  from '../modules/loc/dialect/postgres.mjs';
import {MYSQL_SQL_TYPE} from '../modules/loc/dialect/mysql.mjs';
import {MSSQL_SQL_TYPE} from '../modules/loc/dialect/mssql.mjs';
import {readItemKeywordProjection,KEYWORD_CPU_SLICE_ROWS} from '../app/loc/keywords/item-count-analysis.mjs';

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
  assert.throws(()=>buildKyselyUpsertQuery(mysql,req,'mysql'),
    /executeMysqlUpsert inside an active transaction/);
});

test('SQL Types expose independent parameter, row, byte and stream budgets',()=>{
  assert.equal(POSTGRES_SQL_TYPE.streamStrategy,'pg-cursor');
  assert.equal(MYSQL_SQL_TYPE.streamStrategy,'mysql2-readable-row');
  assert.equal(MSSQL_SQL_TYPE.streamStrategy,'tedious-request');
  assert.equal(getSqlRuntimeCapabilities('postgres').streaming.chunkRows,256);
  assert.equal(getSqlRuntimeCapabilities('mysql').streaming.chunkRows,1);
  assert.equal(getSqlRuntimeCapabilities('mysql').insertMaxRows,1000);
  assert.equal(getSqlRuntimeCapabilities('mssql').streaming.chunkRows,256);
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
  assert.match(my,/from `lo3rwang_galaxy`/i);
  assert.doesNotMatch(my,/from `silver`/i);
  // Kysely's native MSSQL compiler emits ANSI double-quoted identifiers
  // and @N bind placeholders; these are valid T-SQL, not PostgreSQL syntax.
  assert.match(ms,/lower\("title"\) like @\d+/i);
  assert.match(ms,/case when "date" is null/i);
  assert.match(ms,/from "silver"\."lo3rwang_galaxy"/i);
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
  const my=planKyselyUpsertBatches(wideRows,'uid',{dialect:'mysql'});
  const mssqlCaseWidth=99*2+1;
  const mysqlCaseWidth=99*2+1;
  assert.ok(ms.every(batch=>batch.length*mssqlCaseWidth<=MSSQL_SQL_TYPE.upsertParameterLimit));
  assert.ok(my.every(batch=>batch.length*mysqlCaseWidth<=MYSQL_SQL_TYPE.upsertParameterLimit));
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
  const bounded=planPortableInsertBatches(rows,'mysql',{maxBytes:40});
  assert.ok(bounded.every(batch=>batch.length===1));
  assert.equal(planPortableInsertBatches([{uid:'BIGG0001',num:2n}],'mssql').length,1);
  assert.equal(planKyselyUpsertBatches([{uid:'BIGG0001',num:2n}],'uid',
    {dialect:'postgres'}).length,1);
});

test('PostgreSQL SELECT streaming reads bounded cursor chunks and validates rows',async()=>{
  const source=[{uid:'AAAA0001'},{uid:'BBBB0002'},{uid:'CCCC0003'}];
  const opened=[];
  let released=0;
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;this.index=0;this.closed=false;opened.push(this);}
    async read(size){const result=source.slice(this.index,this.index+size);this.index+=result.length;return result;}
    async close(){this.closed=true;}
  }
  const client={
    processID:123,
    query(query){if(query instanceof FakeCursor)return query;throw Error('Unexpected non-cursor query');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const input={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']};
  const result=await executeKyselyQuery(db,input,{
    dialect:'postgres',stream:true,chunkSize:2
  });
  const received=[];
  for await(const row of result.data)received.push(row.uid);
  assert.deepEqual(received,['AAAA0001','BBBB0002','CCCC0003']);
  assert.equal(opened.length,1);
  assert.equal(opened[0].closed,true);
  assert.equal(released,1);
  await db.destroy();
});

test('PostgreSQL cursor is closed when a feature consumer stops early',async()=>{
  const source=Array.from({length:20},(_,index)=>({
    uid:String(index+1).padStart(8,'0')
  }));
  let cursor,released=0;
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;
      this.index=0;this.closed=false;cursor=this;}
    async read(size){
      const rows=source.slice(this.index,this.index+size);
      this.index+=rows.length;
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:789,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Expected a native PostgreSQL cursor');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const result=await executeKyselyQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']
  },{dialect:'postgres',stream:true,chunkSize:2});
  const received=[];
  for await(const row of result.data){received.push(row.uid);break;}
  assert.deepEqual(received,['00000001']);
  assert.equal(cursor.closed,true);
  assert.equal(released,1);
  await db.destroy();
});

test('PostgreSQL AbortSignal closes the cursor and releases its connection',async()=>{
  const source=Array.from({length:20},(_,index)=>({
    uid:String(index+1).padStart(8,'0')
  }));
  let cursor,released=0;
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;
      this.index=0;this.closed=false;cursor=this;}
    async read(size){
      const rows=source.slice(this.index,this.index+size);
      this.index+=rows.length;
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:790,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Expected a native PostgreSQL cursor');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const controller=new AbortController();
  const result=await executeKyselyQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']
  },{dialect:'postgres',stream:true,chunkSize:2,signal:controller.signal});
  const iterator=result.data[Symbol.asyncIterator]();
  const first=await iterator.next();
  assert.equal(first.value.uid,'00000001');
  controller.abort();
  let abortError=null;
  try{
    for(;;){const next=await iterator.next();if(next.done)break;}
  }catch(error){abortError=error;}
  assert.ok(abortError,'Aborted cursor stream must reject instead of silently completing');
  assert.match(String(abortError?.name||abortError?.message||abortError),/abort/i);
  assert.equal(cursor.closed,true);
  assert.equal(released,1);
  await db.destroy();
});

test('PostgreSQL AbortSignal rejects promptly but releases only after the cursor read settles',async()=>{
  let cursor,released=0,readCalls=0,resolveRead,markReadStarted,markClosed,markReleased;
  const readStarted=new Promise(resolve=>{markReadStarted=resolve;});
  const closed=new Promise(resolve=>{markClosed=resolve;});
  const releasedDone=new Promise(resolve=>{markReleased=resolve;});
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;
      this.closed=false;cursor=this;}
    read(){
      readCalls++;
      markReadStarted();
      return new Promise(resolve=>{resolveRead=()=>resolve([{uid:'00000001'}]);});
    }
    async close(){this.closed=true;markClosed();}
  }
  const client={
    processID:794,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Expected a native PostgreSQL cursor');},
    release(){released++;markReleased();}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const controller=new AbortController();
  const result=await executeKyselyQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']
  },{dialect:'postgres',stream:true,chunkSize:2,signal:controller.signal});
  const iterator=result.data[Symbol.asyncIterator]();
  const pending=iterator.next();
  await readStarted;
  controller.abort();
  await assert.rejects(pending,error=>
    /abort/i.test(String(error?.name||error?.message||error)));
  assert.equal(readCalls,1,'Abort must not schedule another cursor read');
  assert.equal(released,0,'The connection remains leased while cursor.read is in flight');
  assert.equal(cursor.closed,false,'The portal cannot be closed before its read settles');
  resolveRead();
  await closed;
  assert.equal(cursor.closed,true);
  await releasedDone;
  assert.equal(released,1,'The connection is released after cursor.close completes');
  await db.destroy();
});

test('PostgreSQL cursor stream keeps its transaction connection until commit',async()=>{
  const source=[{uid:'AAAA0001'},{uid:'BBBB0002'},{uid:'CCCC0003'}];
  let cursor,released=0;
  const statements=[];
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;
      this.index=0;this.closed=false;cursor=this;}
    async read(size){
      const rows=source.slice(this.index,this.index+size);
      this.index+=rows.length;
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:791,
    query(query){
      if(query instanceof FakeCursor)return query;
      statements.push(String(query));
      return Promise.resolve({rows:[]});
    },
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  await db.transaction().execute(async trx=>{
    const result=await executeKyselyQuery(trx,{
      kind:'query',schema:'silver',table:'lo3rwang_galaxy',
      operation:'select',columns:['uid']
    },{dialect:'postgres',stream:true,chunkSize:2});
    const received=[];
    for await(const row of result.data){received.push(row.uid);break;}
    assert.deepEqual(received,['AAAA0001']);
    assert.equal(cursor.closed,true);
    assert.equal(released,0,'The transaction owns the connection until commit');
  });
  assert.ok(statements.some(sql=>/^begin/i.test(sql)));
  assert.ok(statements.some(sql=>/^commit/i.test(sql)));
  assert.equal(released,1);
  await db.destroy();
});

test('PostgreSQL cursor streams 50000 rows in bounded 256-row driver batches',async()=>{
  const total=50000;
  let index=0,released=0,maxRows=0,readCalls=0,cursor;
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;this.closed=false;cursor=this;}
    async read(size){
      readCalls++;
      const count=Math.min(size,total-index);
      const rows=Array.from({length:count},(_,offset)=>({
        uid:String(index+offset+1).padStart(8,'0')
      }));
      index+=count;
      maxRows=Math.max(maxRows,rows.length);
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:792,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Expected a native PostgreSQL cursor');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const result=await executeKyselyQuery(db,{
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid']
  },{dialect:'postgres',stream:true,chunkSize:256});
  let received=0;
  for await(const row of result.data)received++;
  assert.equal(received,total);
  assert.ok(maxRows<=256);
  assert.ok(readCalls>=196);
  assert.equal(cursor.closed,true);
  assert.equal(released,1);
  await db.destroy();
});

test('Keyword article projection streams 1000 rows through bounded cursor and CPU slices',async()=>{
  const total=1000;
  let released=0;
  const opened=[];
  class FakeCursor{
    constructor(query,parameters){this.query=query;this.parameters=parameters;
      this.index=0;this.closed=false;this.reads=[];this.maxRows=0;opened.push(this);}
    async read(size){
      this.reads.push(size);
      const count=Math.min(size,total-this.index);
      const rows=Array.from({length:count},(_,offset)=>({
        uid:String(this.index+offset+1).padStart(8,'0'),
        title:'',content:'月光月光',keyword:true,
        date:'2026-11-20',site:'vocus',place_id:null,createtime:null
      }));
      this.index+=count;
      this.maxRows=Math.max(this.maxRows,rows.length);
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:456,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Keyword projection must use the native cursor');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const result=await readItemKeywordProjection(db,'lo3rwang',{
    items:[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}],
    groups:[{uid:'GROUP001',title:'一組'}],
    patterns:[{uid:'PATT0001',title:'月光'}],
    engine:'postgres',namespace:'silver'
  });
  assert.equal(result.totals.scannedDocuments,total);
  assert.equal(result.totals.parsedDocuments,total);
  assert.equal(result.totals.itemCounts.ITEM0001,total);
  assert.equal(result.totals.itemDocuments.ITEM0001,total);
  assert.equal(result.totals.patternCounts.PATT0001,total*2);
  assert.equal(opened.length,1);
  assert.equal(opened[0].closed,true);
  assert.equal(opened[0].maxRows<=256,true);
  assert.ok(opened[0].reads.every(size=>size===256));
  assert.equal(released,1);
  assert.equal(KEYWORD_CPU_SLICE_ROWS,256);
  await db.destroy();
});

{
const read=(schema,table)=>({
  kind:'query',operation:'select',schema,table,columns:['uid']
});

test('Keyword cursor adaptive page budget measures UTF-8 bytes, not UTF-16 characters',async()=>{
  const total=4097;
  const text='中'.repeat(2800); // 8,400 UTF-8 bytes, 2,800 JS code units.
  let globalIndex=0,released=0;
  const opened=[],pageLimits=[];
  class FakeCursor{
    constructor(query,parameters){
      this.query=query;this.parameters=parameters;this.index=globalIndex;
      this.limit=Number(parameters.at(-1));
      if(!Number.isSafeInteger(this.limit)||this.limit<1)
        throw Error('Expected the keyset page limit as the last bound parameter');
      pageLimits.push(this.limit);
      this.end=Math.min(total,this.index+this.limit);
      this.closed=false;this.reads=[];opened.push(this);
    }
    async read(size){
      this.reads.push(size);
      const count=Math.min(size,this.end-this.index);
      const rows=Array.from({length:count},(_,offset)=>({
        uid:String(this.index+offset+1).padStart(8,'0'),
        title:'',content:text,keyword:true,date:'2026-11-20',
        site:'vocus',place_id:null,createtime:null
      }));
      this.index+=count;globalIndex=this.index;
      return rows;
    }
    async close(){this.closed=true;}
  }
  const client={
    processID:793,
    query(query){if(query instanceof FakeCursor)return query;
      throw Error('Keyword projection must use the native cursor');},
    release(){released++;}
  };
  const pool={options:{},Client:class{},connect:async()=>client,end:async()=>{}};
  const db=new Kysely({dialect:createKyselyDialect('postgres',{pool,cursor:FakeCursor})});
  const result=await readItemKeywordProjection(db,'lo3rwang',{
    items:[{uid:'ITEM0001',item_name:'月',group_uid:'GROUP001',keywords:['月光']}],
    groups:[{uid:'GROUP001',title:'一組'}],
    patterns:[{uid:'PATT0001',title:'月光'}],
    engine:'postgres',namespace:'silver'
  });
  assert.equal(result.totals.scannedDocuments,total);
  assert.deepEqual(pageLimits,[4096,4096],
    'A 32 MiB UTF-8 budget must not double a page containing 34.4 MB of CJK text');
  assert.equal(opened.length,2);
  assert.ok(opened.every(cursor=>cursor.closed));
  assert.ok(opened.every(cursor=>cursor.reads.every(size=>size===256)));
  assert.equal(released,2);
  await db.destroy();
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
