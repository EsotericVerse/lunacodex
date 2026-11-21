import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testLocAuthConnection} from '../functions/api/loc-auth-connectivity.js';
import {requestScopedPool} from '../modules/loc/dialect/index.mjs';
import {closeLocDatabase,bindLocRequestAbort} from '../app/loc/mcp/native-kysely.mjs';
import {readFileSync} from 'node:fs';
import {articleDistribution} from '../app/loc/mcp/article-distribution.mjs';
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
test('database owner closes its pool even if Kysely destruction fails',async()=>{
  const events=[];
  await assert.rejects(closeLocDatabase({
    db:{async destroy(){events.push('db');throw Error('forced destroy failure');}},
    pool:{async end(){events.push('pool');}}
  }),/forced destroy failure/);
  assert.deepEqual(events,['db','pool']);
});
test('LOC operation source contains one transaction and verified permission snapshot',()=>{
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  const dock=readFileSync(new URL('../app/modular/edit-dock.jsx',import.meta.url),'utf8');
  assert.match(native,/verifiedRights=host===MCP_HOST/);
  assert.match(native,/readLocAccess\(trx,claims.email/);
  assert.match(native,/await selected\.db\.transaction\(\)\.execute\(async trx=>/);
  assert.match(native,/await closeLocDatabase\(selected\)/);
  assert.match(dock,/await transactionWrites\(operations\)/);
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
test('standalone article distribution owns SQL, borrowed analytics do not',async()=>{
  const now=new Date('2026-11-22T00:00:00+08:00');
  const calls=[];
  const port={
    db:{
      transaction:()=>({execute:async fn=>fn({})}),
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

test('Suno, article, theme, TimeRiver and Search editors expose complete Save plans',()=>{
  const files=[
    ['../app/loc/media/SunoImportPanel.jsx','prepareSunoTransaction'],
    ['../app/loc/management/ManagementArticlePublisher.jsx','prepareArticleTransaction'],
    ['../app/loc/scope/ScopeSettingsPanel.jsx','prepareThemeTransaction'],
    ['../app/modular/features/CultureTimelineEditor.jsx','prepareTimeTransaction'],
    ['../app/modular/features/Search.jsx','prepareSearchEditTransaction'],
    ['../app/loc/keywords/ui/KeywordLibraryPanel.jsx','prepareKeywordNodeTransaction']
  ];
  for(const [path,name] of files){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(source.includes(name),path+' missing SQL write preparation');
    assert.match(source,/prepareTransaction:/,path+' must register with six-key Save');
    assert.match(source,/transactionWrites\(/,path+' must use the shared SQL transaction');
  }
  const suno=readFileSync(new URL(files[0][0],import.meta.url),'utf8');
  assert.doesNotMatch(suno,/await insertRows\(/);
  const culture=readFileSync(new URL(files[3][0],import.meta.url),'utf8');
  assert.match(culture,/p_expected_count:ids\.length/);
});
test('Keyword subtree deletion includes a single transactional Pattern reconciliation',()=>{
  const editor=readFileSync(new URL('../app/loc/keywords/ui/KeywordLibraryPanel.jsx',import.meta.url),'utf8');
  const sql=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  assert.match(editor,/transactionWrites\(operations,\{keywordSyncScope:scopeId\}\)/);
  assert.match(sql,/synchronizeKeywordLibraryInTransaction\(trx,keywordSyncScope\)/);
  assert.match(sql,/if\(!await canLocAccess\(trx,'scope',keywordSyncScope\)\)/);
  assert.match(sql,/p_expected_count/);
  const contract=readFileSync(new URL('../app/loc/db/db-contract.mjs',import.meta.url),'utf8');
  const copyStart=contract.indexOf('async function copyKeywordLibraryClass(');
  const copyEnd=contract.indexOf('async function copyRune66KeywordClassUnchecked(',copyStart);
  assert.ok(copyStart>=0&&copyEnd>copyStart);
  const copy=contract.slice(copyStart,copyEnd);
  assert.match(copy,/await transactionWrites\(operations\)/);
  assert.doesNotMatch(copy,/await writeKeywordLibraryItem\(/);
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
test('non-batch writes resolve api.manage inside the same owned SQL transaction',()=>{
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  assert.match(native,/const isManagedBatch=\['managed-transaction','managed-write','managed-action'\]/);
  assert.match(native,/readLocAccess\(trx,claims.email,\{/);
  assert.match(native,/bindLocAuthorization\(trx,\{role:claims.role,claims,engine:selected.engine\}\)/);
  assert.doesNotMatch(native,/withFixedPolicyWrite\(/);
});
