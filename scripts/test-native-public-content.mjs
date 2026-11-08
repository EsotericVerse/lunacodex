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
