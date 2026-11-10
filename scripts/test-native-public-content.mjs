import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleNativePublicContent} from '../app/loc/server/native-public-content.mjs';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';

// A trusted PostgreSQL dialect backed by DummyDriver, so 'config' reads on a
// fixed public model (loc/lo3rwang/lrunes) run through the REAL
// ZenStack+PolicyPlugin reader (zenstack/policy-runtime.mjs) end to end,
// the same as production, instead of a hand-mocked query builder.
function fixedModelDialect(row){
  const executed=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    const run=connection.executeQuery.bind(connection);
    connection.executeQuery=async compiled=>{
      executed.push(compiled);
      return {rows:row?[row]:[]};
    };
    return connection;
  };
  return {executed,dialect:{
    createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  }};
}

const page=(kind,scope,feature='')=>{
  const url=new URL('https://loc.lo3rwang.cc/api/loc-public-content');
  url.searchParams.set('kind',kind);
  url.searchParams.set('scope',scope);
  if(feature)url.searchParams.set('feature',feature);
  return new Request(url);
};
const makeDatabase=()=>{
  const calls=[];
  function query(table){
    const state={table};
    calls.push(state);
    return {
      select(cols){state.cols=cols;return this;},
      where(col,op,value){state.where=[col,op,value];return this;},
      orderBy(col,direction){state.order=[col,direction];return this;},
      limit(n){state.limit=n;return this;},
      async execute(){return [{uid:'54E4C700',page_name:'index',block_order:1,block_title:'LOC月典'}];},
      async executeTakeFirst(){return {id:'loc',display_name:'LOC 月典',locale:'zh-Hant'};}
    };
  }
  return {calls,database:async()=>({engine:'postgres',db:{selectFrom:query}})};
};

test('a single native Kysely SELECT reads the published homepage physical relation',async()=>{
  const mock=makeDatabase();
  const response=await handleNativePublicContent(page('blocks','loc'),{},mock);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.data[0].block_title,'LOC月典');
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].table,'silver.loc_blocks');
  assert.deepEqual(mock.calls[0].where,['page_name','in',['index']]);
  assert.equal(mock.calls[0].limit,100);
});

test('public feature Hero reads two fixed page names in one Kysely query',async()=>{
  const mock=makeDatabase();
  const response=await handleNativePublicContent(page('hero','lo3rwang','culture'),{},mock);
  assert.equal(response.status,200);
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].table,'silver.loc_blocks');
  assert.deepEqual(mock.calls[0].where,['page_name','in',['group_culture','scope_culture']]);
});

test('config projects only the public Scope columns, never Manage or secrets, via the real ZenStack PolicyPlugin reader',async()=>{
  // lo3rwang is one of the four fixed public ZModel control models, so
  // 'config' now runs through the real ZenStack+PolicyPlugin $qb on the
  // same dialect/pool -- not the hand-rolled Kysely query builder.
  const {executed,dialect}=fixedModelDialect({id:'lo3rwang',display_name:'LOC 月典'});
  const database=async()=>({engine:'postgres',dialect,db:{selectFrom:()=>{
    throw new Error('Must not use the plain Kysely path for a fixed public model');
  }}});
  const response=await handleNativePublicContent(page('config','lo3rwang'),{},{database});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:{id:'lo3rwang',display_name:'LOC 月典'}});
  assert.equal(executed.length,1,'PolicyPlugin must not trigger any duplicate SELECT');
  const sql=executed[0].sql;
  assert.match(sql,/"silver"\."lo3rwang"/);
  assert.match(sql,/"display_name"/);
  for(const key of ['password','email','token','connection_alias','manage_role'])
    assert.ok(!sql.includes('"'+key+'"'));
});

test('live PostgreSQL Blocks, Hero and Culture Anchors reuse the existing dialect through scoped ZenStack',async()=>{
  for(const spec of [
    {kind:'blocks',scope:'lo3rwang',table:'lo3rwang_blocks',
      row:{uid:'A1234567',page_name:'index',block_order:1,block_title:'Page'}},
    {kind:'hero',scope:'lo3rwang',feature:'culture',table:'loc_blocks',
      row:{uid:'B1234567',page_name:'group_culture',block_order:1,block_title:'Hero'}},
    {kind:'culture_anchors',scope:'lo3rwang',table:'lo3rwang_anchor',
      row:{uid:'C1234567',type:'era',title:'Era',attr:{},invisible:false}}
  ]){
    const {executed,dialect}=fixedModelDialect(spec.row);
    const database=async()=>({engine:'postgres',namespace:'silver',dialect,db:{
      selectFrom(){throw Error('Do not bypass ZenStack for a modeled PostgreSQL read');}
    }});
    const response=await handleNativePublicContent(
      page(spec.kind,spec.scope,spec.feature||''),{},{database});
    assert.equal(response.status,200,spec.kind);
    assert.equal((await response.json()).data.length,1,spec.kind);
    assert.equal(executed.length,1,'One query, using the existing dialect');
    assert.match(executed[0].sql,new RegExp('"silver"\\."'+spec.table+'"'));
  }
});

test('the website cannot submit SQL, table names, arbitrary operations or connection targets',async()=>{
  let called=0;
  const database=async()=>{called++;throw Error('Must not open database')};
  for(const params of [
    'kind=query&scope=loc',
    'kind=blocks&scope=admin',
    'kind=hero&scope=loc&feature=admin',
    'kind=blocks&scope=loc&table=api.manage',
    'kind=blocks&scope=loc&sql=DROP',
    'kind=blocks&scope=loc&target=another-db'
  ]){
    const response=await handleNativePublicContent(
      new Request('https://loc.lo3rwang.cc/api/loc-public-content?'+params),{},
      {database});
    assert.equal(response.status,400,params);
  }
  assert.equal(called,0);
});

test('unavailable Kysely reports a driver error instead of a public Data API fallback',async()=>{
  const response=await handleNativePublicContent(page('blocks','loc'),{},{
    database:async()=>{throw Error('private connection text must not leak')}
  });
  assert.equal(response.status,503);
  const data=await response.json();
  assert.equal(data.stage,'kysely-query');
  assert.equal(JSON.stringify(data).includes('private connection text'),false);
});

test('guest site uses published config and Blocks without any SQL request',()=>{
  const bootstrap=readFileSync(new URL('../app/loc/app-bootstrap.js',import.meta.url),'utf8');
  const blocks=readFileSync(new URL('../app/loc/scope-data.js',import.meta.url),'utf8');
  assert.match(bootstrap,/page==='index'/);
  assert.match(bootstrap,/SCOPE_ROUTE_INDEX\.find/);
  assert.match(blocks,/const promise=loadPublishedBlocks\(id,name\)/);
  assert.match(blocks,/nativePublicContent\('config',scope\.id\)/);
  assert.match(blocks,/nativePublicContent\('hero',id,name\)/);
});


// Numeric readers live on the SAME application Function as published Blocks:
// one grouped SQL result, no browser article scans, no Manage permission query.
function numericDatabase(){
  const calls=[];
  const rows=[
    {date:'2026-11-07',site:'threads',item_count:2},
    {date:'2026-11-07',site:'facebook',item_count:3},
    {date:'2026-11-08',site:'threads',item_count:1}
  ];
  function query(table){
    const state={table,wheres:[]};calls.push(state);
    return {
      select(cols){
        state.select=cols;
        if(typeof cols==='function'){
          const fn={
            countAll:()=>({as:alias=>({fn:'count',alias})}),
            min:col=>({as:alias=>({fn:'min',col,alias})})
          };
          state.aggregate=cols({fn});
        }
        return this;
      },
      where(...parts){state.wheres.push(parts);return this;},
      groupBy(cols){state.group=cols;return this;},
      orderBy(){return this;},
      limit(n){state.limit=n;return this;},
      async execute(){
        if(state.group==='site')return [{site:'threads',item_count:3},{site:'facebook',item_count:3}];
        return rows;
      },
      async executeTakeFirst(){return {earliest:'2024-01-01'}}
    };
  }
  return {calls,database:async()=>({engine:'postgres',db:{selectFrom:query}})};
}
const numericPage=(kind,extra='')=>new Request(
  'https://loc.lo3rwang.cc/api/loc-public-content?kind='+kind+'&scope=lo3rwang'+
  (extra?'&'+extra:''));

test('native Galaxy aggregation and first river are independent; no Manage or UID list',async()=>{
  const mock=numericDatabase();
  const response=await handleNativePublicContent(numericPage('culture_density',
    'start=2026-11-01&end=2026-11-08'),{},mock);
  assert.equal(response.status,200);
  const result=(await response.json()).data;
  assert.deepEqual(result[0],{day:'2026-11-07',site:'threads',item_count:2});
  assert.deepEqual(mock.calls.map(x=>x.table),['silver.lo3rwang_galaxy']);
  assert.equal(mock.calls[0].limit,20001);
  assert.ok(mock.calls[0].wheres.some(x=>x[0]==='culture'&&x[2]===true));
  assert.ok(mock.calls[0].group);
  assert.ok(!JSON.stringify(result).includes('uid'));
});

test('native statistics overview derives daily totals from one grouped query',async()=>{
  const mock=numericDatabase();
  const response=await handleNativePublicContent(numericPage('overview',
    'start=2026-11-01&end=2026-11-08'),{},mock);
  assert.equal(response.status,200);
  const data=(await response.json()).data;
  assert.equal(data.earliest,'2024-01-01');
  assert.deepEqual(data.rows.filter(r=>r.kind==='total'),[
    {day:'2026-11-07',kind:'total',category:'文字作品',item_count:5},
    {day:'2026-11-08',kind:'total',category:'文字作品',item_count:1}
  ]);
  assert.equal(data.rows.filter(r=>r.kind==='source').length,3);
  assert.equal(mock.calls.length,2,'one grouped COUNT + one earliest date');
  assert.ok(mock.calls.every(x=>x.table==='silver.lo3rwang_galaxy'));
  assert.ok(mock.calls[0].wheres.some(x=>x[0]==='statics'&&x[2]===true));
});

test('numeric URL rejects untrusted SQL, aliases, wrong dates before touching DB',async()=>{
  let calls=0;
  const database=async()=>{calls++;throw Error('Unexpected database open')};
  for(const query of [
    'kind=overview&scope=admin&start=2026-01-01&end=2026-11-08',
    'kind=overview&scope=lo3rwang&start=bad&end=2026-11-08',
    'kind=culture_density&scope=lo3rwang&start=2026-11-09&end=2026-11-08',
    'kind=overview&scope=lo3rwang&start=2026-01-01&end=2026-11-08&sql=select',
    'kind=overview&scope=lo3rwang&start=2026-01-01&end=2026-11-08&target=some-db'
  ]){
    const response=await handleNativePublicContent(
      new Request('https://loc.lo3rwang.cc/api/loc-public-content?'+query),{},
      {database});
    assert.equal(response.status,400,query);
  }
  assert.equal(calls,0);
});
test('Cloudflare Pages routes include the existing native business Functions',()=>{
  const routes=JSON.parse(readFileSync(new URL('../public/_routes.json',import.meta.url),'utf8'));
  for(const endpoint of ['/api/loc-public-content','/api/loc-public-query','/api/loc-public-classes',
    '/api/loc-native','/api/keywords'])
    assert.ok(routes.include.includes(endpoint),'Missing executable Pages Function: '+endpoint);
});


test('public Kysely Alias uses the existing Admin access.js selection, not a Manage SQL query',async()=>{
  let selected='';
  const mock=numericDatabase();
  const response=await handleNativePublicContent(numericPage('culture_density',
    'start=2026-11-01&end=2026-11-08'),{},{
    database:async(_env,alias)=>{selected=alias;return mock.database();}
  });
  assert.equal(response.status,200);
  assert.equal(selected,'loc-main','public reads and LOC Auth must use the same control target');
  assert.ok(mock.calls.every(call=>!call.table.includes('manage')));
});

test('full-history Galaxy statistics return more than five thousand grouped dates without truncation',async()=>{
  const groups=Array.from({length:6829},(_,index)=>({
    date:new Date(Date.UTC(2005,3,12+index)).toISOString().slice(0,10),
    site:'threads',item_count:1
  }));
  const db={selectFrom:()=>({
    select(){return this},where(){return this},groupBy(){return this},
    orderBy(){return this},limit(n){assert.equal(n,20001);return this},
    async execute(){return groups}
  })};
  const response=await handleNativePublicContent(numericPage('daily',
    'start=2005-01-01&end=2026-11-09'),{},
    {database:async()=>({engine:'postgres',namespace:'silver',db})});
  assert.equal(response.status,200);
  const data=(await response.json()).data;
  assert.equal(data.filter(row=>row.kind==='source').length,6829);
  assert.equal(data.filter(row=>row.kind==='total').length,6829);
});

test('offline Culture, Statistics and LOC Group report SQL errors without published snapshots',async()=>{
  const offline=async()=>{throw new Error('Database profile unavailable')};
  for(const request of [
    numericPage('earliest'),
    numericPage('daily','start=2026-11-01&end=2026-11-09'),
    numericPage('overview','start=2026-11-01&end=2026-11-09'),
    numericPage('culture_density','start=2026-11-01&end=2026-11-09'),
    numericPage('totals'),
    new Request('https://loc.lo3rwang.cc/api/loc-public-content?kind=loc&scope=loc&start=2026-11-01&end=2026-11-09')
  ]){
    const response=await handleNativePublicContent(request,{},{database:offline});
    assert.equal(response.status,503,request.url);
    const result=await response.json();
    assert.equal(result.stage,'kysely-query');
    assert.equal(result.source,undefined,'never report a published source as live SQL');
  }
});
test('LOC Group statistics use live bounded SQL when configured',async()=>{
  const mock=numericDatabase();
  const request=new Request('https://loc.lo3rwang.cc/api/loc-public-content?kind=loc&scope=loc&start=2026-11-01&end=2026-11-09');
  const response=await handleNativePublicContent(request,{},mock);
  assert.equal(response.status,200);
  const result=(await response.json()).data;
  assert.deepEqual(result.scopes.map(row=>row.scope_id),['lo3rwang','lrunes']);
  assert.ok(result.rows.some(row=>row.scope_id==='lrunes'));
  assert.ok(mock.calls.some(call=>call.table==='silver.lrunes_galaxy'));
  assert.ok(mock.calls.some(call=>call.table==='silver.lo3rwang_galaxy'));
});
