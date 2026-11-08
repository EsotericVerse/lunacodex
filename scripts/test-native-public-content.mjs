import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleNativePublicContent} from '../app/loc/server/native-public-content.mjs';

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

test('config projects only the public Scope columns, never Manage or secrets',async()=>{
  const mock=makeDatabase();
  const response=await handleNativePublicContent(page('config','lo3rwang'),{},mock);
  assert.equal(response.status,200);
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].table,'silver.lo3rwang');
  assert.deepEqual(mock.calls[0].where,['id','=','lo3rwang']);
  assert.ok(mock.calls[0].cols.includes('display_name'));
  for(const key of ['password','email','token','connection_alias','manage_role'])
    assert.ok(!mock.calls[0].cols.includes(key));
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

test('unconfigured or failing database returns 503 without exposing secrets',async()=>{
  const database=async()=>{throw Error('postgresql://private:secret@database.example')};
  const response=await handleNativePublicContent(page('blocks','loc'),{},{database});
  assert.equal(response.status,503);
  const result=await response.json();
  assert.ok(!JSON.stringify(result).includes('secret'));
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
  assert.equal(mock.calls[0].limit,5001);
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
  for(const endpoint of ['/api/loc-public-content','/api/loc-public-classes',
    '/api/loc-native','/api/keywords'])
    assert.ok(routes.include.includes(endpoint),'Missing executable Pages Function: '+endpoint);
});
