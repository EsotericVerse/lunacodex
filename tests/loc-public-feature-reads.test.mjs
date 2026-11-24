import test from 'node:test';
import assert from 'node:assert/strict';
import {handleNamedPublicTransaction} from '../app/loc/server/public-named-transactions.mjs';

const origin='https://loc.lo3rwang.cc';
const req=(body,path='/search/query')=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify(body)});
const forbid=()=>{throw Error('Rejected contract must not open database')};

test('feature read rejects generic SQL and retired bootstrap requests before connecting',async()=>{
  for(const body of [
    {schema:'silver',table:'lo3rwang_galaxy',columns:['*'],filters:[]},
    {kind:'transaction',operation:'query',sql:'select * from api.manage'},
    {kind:'transaction',operation:'action',name:'read_app_bootstrap',args:{}}
  ]){
    const response=await handleNamedPublicTransaction(req(body),{},{database:forbid});
    assert.equal(response.status,400);
  }
});

test('MySQL and MSSQL public analytics query directly without a SQL transaction',async()=>{
  for(const engine of ['mysql','mssql']){
    const observed={begins:0,queries:[],introspections:0};
    const namespace=engine==='mysql'?'locdb':'dbo';
    const db={
      introspection:{async getTables(){
        observed.introspections++;
        return ['lo3rwang_galaxy','lrunes_galaxy'].map(name=>({name,schema:namespace}));
      }},
      selectFrom(table){
        observed.queries.push(table);
        return {
          select(){return this},
          async executeTakeFirst(){
            return {article_count:2,word_count:20,
              first_date:'2026-01-01',last_date:'2026-11-22'};
          }
        };
      },
      transaction(){observed.begins++;throw Error('Read query opened a transaction')},
      async destroy(){}
    };
    const database=async()=>({
      engine,namespace,
      db,
      pool:{async end(){}}
    });
    const response=await handleNamedPublicTransaction(req({
      kind:'transaction',operation:'analytics',args:{
        p_scope_id:'loc',p_view:'search_summary',
        p_options:{scopeIds:['lo3rwang','lrunes']}
      }
    }),{},{database});
    assert.equal(response.status,200,engine);
    const result=await response.json();
    assert.equal(result.data.rows.length,2,engine);
    assert.equal(observed.begins,0,engine);
    assert.equal(observed.introspections,1,engine);
    assert.equal(observed.queries.length,2,engine);
  }
});

test('MySQL and MSSQL public Blocks actions query directly without a SQL transaction',async()=>{
  for(const engine of ['mysql','mssql']){
    const observed={transactions:0,tables:[]};
    const query={
      select(){return this},where(){return this},orderBy(){return this},
      async execute(){return []}
    };
    const database=async()=>({
      engine,namespace:engine==='mysql'?'locdb':'dbo',
      db:{selectFrom(table){observed.tables.push(table);return query},
        transaction(){observed.transactions++;throw Error('Read query opened a transaction')},
        async destroy(){}},
      pool:{async end(){}}
    });
    const response=await handleNamedPublicTransaction(req({
      kind:'transaction',operation:'action',
      name:'block_list',args:{p_scope_id:'lo3rwang'}
    }),{},{database});
    assert.equal(response.status,200,engine);
    assert.deepEqual((await response.json()).data,[]);
    assert.equal(observed.transactions,0,engine);
    assert.equal(observed.tables.length,1,engine);
  }
});
