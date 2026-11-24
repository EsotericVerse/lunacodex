import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../app/api/loc-auth-connectivity/route.js';
import {requestScopedPool} from '../modules/loc/dialect/index.mjs';
import {closeLocDatabase,bindLocRequestAbort} from '../app/loc/mcp/native-kysely.mjs';
import {readFileSync} from 'node:fs';
import {articleDistribution} from '../app/loc/mcp/article-distribution.mjs';
import {readMemory} from '../app/loc/mcp/galaxy-read.mjs';
import {setKeywordClassShare} from '../app/loc/keywords/sql-service.mjs';

const body=async response=>JSON.parse(await response.text());

test('a Pages Preview without LOC_DATABASE_URI reports configuration missing',async()=>{
  let connected=false;
  const response=await testLocAuthConnection({},async()=>{
    connected=true;
    throw Error('The PostgreSQL driver must not be called without a URI');
  });
  assert.equal(response.status,503);
  assert.deepEqual(await body(response),{
    ok:false,stage:'configuration',code:'LOC_DATABASE_URI_MISSING'
  });
  assert.equal(connected,false);
});

test('an injected PostgreSQL connection performs one bounded SELECT 1 probe',async()=>{
  let calls=0;
  const response=await testLocAuthConnection(
    {LOC_DATABASE_URI:'configured-secret-not-inspected'},
    async()=>{
      calls++;
      return {engine:'postgres',db:{
        selectNoFrom(select){
          assert.equal(typeof select,'function');
          return {executeTakeFirstOrThrow:async()=>({connected:1})};
        }
      }};
    });
  assert.equal(calls,1);
  assert.equal(response.status,200);
  assert.deepEqual(await body(response),{
    ok:true,connection:'postgresql',driver:'pg',probe:'select_1'
  });
});

test('a SQL connection failure never returns the URI or error text to the browser',async()=>{
  const sensitive='postgresql://sensitive-user:secret-password@private-neon-host/database';
  const response=await testLocAuthConnection({LOC_DATABASE_URI:sensitive},async()=>{
    throw Object.assign(new Error('failed to connect '+sensitive),{code:'ECONNREFUSED'});
  });
  const result=await response.text();
  assert.equal(response.status,503);
  assert.equal(JSON.parse(result).reason,'TRANSPORT');
  assert.ok(!result.includes('sensitive-user'));
  assert.ok(!result.includes('secret-password'));
  assert.ok(!result.includes('private-neon-host'));
});

class TestSqlClient{
  static all=[];
  constructor(){this.connected=false;this.closed=0;TestSqlClient.all.push(this);}
  on(){}
  async connect(){this.connected=true;}
  async end(){this.closed++;}
}
test('request SQL pool closes released connections exactly once',async()=>{
  TestSqlClient.all=[];
  const lifecycle=[];
  const pool=requestScopedPool({},TestSqlClient,{attempts:1});
  pool.setWaitUntil(job=>{lifecycle.push(job);});
  const client=await pool.connect();
  assert.equal(client.connected,true);
  client.release();
  await pool.end();
  await Promise.all(lifecycle);
  assert.equal(client.closed,1);
  await pool.end();
  assert.equal(client.closed,1);
});
test('request cancellation closes active connection and refuses future acquisition',async()=>{
  TestSqlClient.all=[];
  const pool=requestScopedPool({},TestSqlClient,{attempts:1});
  const client=await pool.connect();
  const controller=new AbortController();
  const release=bindLocRequestAbort({pool},controller.signal);
  controller.abort();
  await pool.end();
  release();
  assert.equal(client.closed,1);
  await assert.rejects(pool.connect(),/already closed/);
});
test('Keyword streamed analysis awaits cancelled SQL ownership cleanup',()=>{
  const handler=readFileSync(new URL('../app/loc/keywords/api.mjs',import.meta.url),'utf8');
  assert.match(handler,/cancel\(\)\{return entry\?\.pool\?\.abort\?\.\(\);\}/,
    'ReadableStream cancellation must return its pool-close Promise');
  assert.match(handler,/finally\{[\s\S]*?await closeLocDatabase\(entry\)/,
    'stream completion/failure must close the SQL owner');
});

test('a failed connection attempt releases its socket before propagating failure',async()=>{
  class FailingClient extends TestSqlClient{
    async connect(){throw Error('simulated database unavailable');}
  }
  TestSqlClient.all=[];
  const pool=requestScopedPool({},FailingClient,{attempts:1});
  await assert.rejects(pool.connect(),/simulated database unavailable/);
  assert.equal(TestSqlClient.all.length,1);
  assert.equal(TestSqlClient.all[0].closed,1);
  await pool.end();
});

test('Neon-style immediate resets are retried beyond four tries within a fixed budget',async()=>{
  let elapsed=0,tries=0,closed=0;
  const delays=[];
  class WakeClient{
    constructor(options){
      assert.ok(options.connectionTimeoutMillis>0);
      assert.ok(options.connectionTimeoutMillis<=1500);
    }
    on(){}
    async connect(){
      tries++;
      if(tries<5)throw Object.assign(new Error('temporary reset'),{code:'ECONNRESET'});
    }
    async end(){closed++;}
  }
  const pool=requestScopedPool({connectionTimeoutMillis:6000},WakeClient,{
    now:()=>elapsed,sleep:async ms=>{delays.push(ms);elapsed+=ms;}
  });
  const client=await pool.connect();
  assert.equal(tries,5);
  assert.deepEqual(delays,[350,700,1400,1400]);
  assert.ok(elapsed<6000);
  client.release();
  await pool.end();
  assert.equal(closed,tries);
});
test('slow connection timeouts never consume four separate six-second waits',async()=>{
  let elapsed=0,tries=0,closed=0;
  class SlowClient{
    constructor(options){this.timeout=options.connectionTimeoutMillis;}
    on(){}
    async connect(){
      tries++;elapsed+=this.timeout;
      throw Object.assign(new Error('connection timeout'),{code:'ETIMEDOUT'});
    }
    async end(){closed++;}
  }
  const pool=requestScopedPool({connectionTimeoutMillis:6000},SlowClient,{
    now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}
  });
  await assert.rejects(pool.connect(),/connection timeout/);
  assert.ok(tries>=2&&tries<7);
  assert.ok(elapsed<=6000);
  assert.equal(closed,tries);
  await pool.end();
});
test('invalid database credentials fail immediately without retrying',async()=>{
  let attempts=0;
  class InvalidClient{
    on(){}
    async connect(){attempts++;throw Object.assign(Error('denied'),{code:'28P01'});}
    async end(){}
  }
  const pool=requestScopedPool({},InvalidClient,{
    sleep:async()=>{throw Error('must not wait after permanent failure');}
  });
  await assert.rejects(pool.connect(),/denied/);
  assert.equal(attempts,1);
  await pool.end();
});
test('database owner closes its pool even if Kysely destruction fails',async()=>{
  const events=[];
  await assert.rejects(closeLocDatabase({
    db:{async destroy(){events.push('db');throw Error('forced destroy failure');}},
    pool:{async end(){events.push('pool');}}
  }),/forced destroy failure/);
  assert.deepEqual(events,['db','pool']);
});

test('health-check SQL ownership closes connection after successful and invalid probes',async()=>{
  for(const connected of [1,0]){
    const calls=[];
    const port={engine:'postgres',
      db:{
        selectNoFrom:()=>({executeTakeFirstOrThrow:async()=>({connected})}),
        async destroy(){calls.push('destroy');}
      },
      pool:{async end(){calls.push('pool-end');}}
    };
    const response=await testLocAuthConnection(
      {LOC_DATABASE_URI:'configured-secret-not-inspected'},
      async()=>port);
    assert.equal(response.status,connected===1?200:503);
    assert.deepEqual(calls,['destroy','pool-end']);
  }
});
test('article distribution reads directly and closes only its own connection',async()=>{
  const now=new Date('2026-11-22T00:00:00+08:00');
  const calls=[];
  const port={
    db:{
      transaction(){throw Error('Read-only analytics must not open SQL transaction');},
      async destroy(){calls.push('destroy');}
    },
    pool:{async end(){calls.push('pool-end');}}
  };
  const make=borrowed=>articleDistribution({period:'calendar_year',year:2026},{},{
    database:async()=>port,
    analytics:async()=>({data:{rows:[{day:'2026-11-01',item_count:7}]}}),
    now,borrowed
  });
  const standalone=await make(false);
  assert.equal(standalone.total,7);
  assert.deepEqual(calls,['destroy','pool-end']);
  calls.length=0;
  const inherited=await make(true);
  assert.equal(inherited.total,7);
  assert.deepEqual(calls,[]);
});

test('Keyword subtree deletion performs real Anchor/Config changes in one transaction',()=>{
  const editor=readFileSync(new URL('../app/loc/keywords/ui/KeywordLibraryPanel.jsx',import.meta.url),'utf8');
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../app/loc/db/db-contract.mjs',import.meta.url),'utf8');
  assert.match(editor,/await transactionWrites\(operations\);/);
  assert.match(editor,/operations\.push\(\{\.\.\.deletion,p_expected_count:1\}\)/);
  assert.match(editor,/current_keyword_class_uid:nextUid,staticstime:null,keyword_meta/);
  assert.match(native,/selected\.db\.transaction\(\)\.execute\(async trx=>/);
  assert.match(native,/expected!==affected/);
  assert.match(native,/if\(body\.keywordSyncScope\)/);
  assert.doesNotMatch(native,/synchronizeKeywordLibraryInTransaction/);
  assert.doesNotMatch(editor,/keywordSyncScope/);
  const copyStart=contract.indexOf('async function copyKeywordLibraryClass(');
  const copyEnd=contract.indexOf('async function copyRune66KeywordClassUnchecked(',copyStart);
  assert.ok(copyStart>=0&&copyEnd>copyStart);
  const copy=contract.slice(copyStart,copyEnd);
  assert.match(copy,/await transactionWrites\(operations\)/);
  assert.doesNotMatch(copy,/await writeKeywordLibraryItem\(/);
});

test('retired Keyword sync is rejected by client and API before database access',async()=>{
  const {keywordService}=await import('../app/loc/keywords/service-client.mjs');
  await assert.rejects(keywordService('syncLibrary',{scopeId:'lo3rwang'}),
    /Unsupported Keyword operation/);
  const {handleKeywordRequest}=await import('../app/loc/keywords/api.mjs');
  const req=new Request('https://loc.lo3rwang.cc/api/keywords',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({operation:'syncLibrary',args:{scopeId:'lo3rwang'}})
  });
  const response=await handleKeywordRequest(req,{});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/Unknown Keyword operation/);
});

test('keyword sharing uses one locked read-modify-write transaction and fails closed',async()=>{
  let metadata={class_shares:{ABCD1234:false},other:{unrelated:true}};
  const events=[];
  const db={transaction:()=>({execute:async work=>{
    events.push('begin');
    const original=structuredClone(metadata);
    const trx={
      selectFrom(table){
        assert.equal(table,'silver.lo3rwang');
        return {select(field){
          assert.equal(field,'keyword_meta');
          return {where(column,op,value){
            assert.deepEqual([column,op,value],['id','=','lo3rwang']);
            return {forUpdate(){events.push('lock');return {
              executeTakeFirst:async()=>({keyword_meta:metadata})
            };}};
          }};
        }};
      },
      updateTable(table){
        assert.equal(table,'silver.lo3rwang');
        return {set(values){
          return {where(column,op,value){
            assert.deepEqual([column,op,value],['id','=','lo3rwang']);
            return {executeTakeFirst:async()=>{
              events.push('update');metadata=JSON.parse(values.keyword_meta);
              return {numUpdatedRows:1n};
            }};
          }};
        }};
      }
    };
    try{const out=await work(trx);events.push('commit');return out;}
    catch(error){metadata=original;events.push('rollback');throw error;}
  }})};
  const rights=async()=>{events.push('authorize');};
  const result=await setKeywordClassShare(db,'lo3rwang','ABCD1234',true,{
    authorizeTransaction:rights
  });
  assert.equal(result.keyword_meta.class_shares.ABCD1234,true);
  assert.deepEqual(metadata.other,{unrelated:true});
  assert.deepEqual(events,['begin','authorize','lock','update','commit']);
  events.length=0;
  await assert.rejects(setKeywordClassShare(db,'lo3rwang','ABCD1234',false,{
    authorizeTransaction:async()=>{throw Error('Scope denied');}
  }),/Scope denied/);
  assert.equal(metadata.class_shares.ABCD1234,true);
  assert.deepEqual(events,['begin','rollback']);
});

test('MCP public Galaxy reads use the supplied Kysely connection',async()=>{
  const calls=[];
  const chain={
    select(columns){calls.push(['select',columns.length]);return this;},
    where(){return this;},
    limit(){return this;},
    async execute(){return [{
      uid:'ABCD1234',title:'published',content:'text',site:'public',
      list:true,search:true
    }];}
  };
  const port={engine:'postgres',namespace:'silver',dialect:null,
    db:{selectFrom(table){calls.push(['table',table]);return chain;}}};
  const result=await readMemory({scopeid:'lo3rwang',uid:'ABCD1234'},{},{
    databasePort:port
  });
  assert.equal(result.found,true);
  assert.equal(result.content,'text');
  assert.ok(calls.some(([kind,value])=>kind==='table'&&
    value==='silver.lo3rwang_galaxy'));
});
