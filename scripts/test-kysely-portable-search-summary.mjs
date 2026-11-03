import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync('app/loc/providers/kysely-analytics.mjs','utf8');
const executor=new Function('sql','canManageLoc','portableRelation',
  source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  ';return executePortableKyselyAnalytics')({},async()=>false,
  (table,engine,namespace)=>engine==='mysql'?table:namespace+'.'+table);

function fixture(engine,namespace){
  const calls=[],functions=[];
  const eb={fn:Object.assign((name)=>{functions.push(name);return {as:key=>({key})}},{
    countAll:()=>({as:key=>({key})}),
    min:()=>({as:key=>({key})}),
    max:()=>({as:key=>({key})}),
    sum:()=>({as:key=>({key})})
  })};
  const db={
    introspection:{getTables:async()=>[{schema:engine==='mysql'?'client_database':namespace,name:'writer_galaxy'},
      {schema:namespace,name:'writer_anchor'}]},
    selectFrom:table=>{
      calls.push(table);
      return {select(fn){if(typeof fn==='function')fn(eb);return this;},
        where(){return this;},executeTakeFirst:async()=>({
          article_count:'12',word_count:'3456',
          first_date:'2020-01-01',last_date:'2026-11-04'
        })};
    }
  };
  return {db,calls,functions};
}

for(const [engine,namespace,lengthFunction] of [
  ['mysql','silver','char_length'],['mssql','dbo','len']
]){
  test(engine+' search_summary uses only Galaxy table, no SQL RPC',async()=>{
    const {db,calls,functions}=fixture(engine,namespace);
    const result=await executor(db,{kind:'analytics',
      args:{p_scope_id:'loc',p_view:'search_summary',
        p_options:{scopeIds:['writer']}}},
      {engine,namespace,role:'anon'});
    assert.deepEqual(result.data,{rows:[{
      scope_id:'writer',article_count:12,word_count:3456,
      first_date:'2020-01-01',last_date:'2026-11-04',
      refreshed_at:null
    }]});
    assert.deepEqual(calls,[engine==='mysql'?'writer_galaxy':'dbo.writer_galaxy']);
    assert.ok(functions.includes(lengthFunction));
  });
}


test('two-table external LOC statistics uses discovered Scope instead of loc_galaxy',async()=>{
  const readTables=[];
  const eb={fn:{countAll:()=>({as:key=>({key})}),min:()=>({as:key=>({key})})}};
  const db={
    introspection:{getTables:async()=>[
      {schema:'dbo',name:'writer_galaxy'},
      {schema:'dbo',name:'writer_anchor'}
    ]},
    selectFrom:table=>{
      readTables.push(table);
      const q={select(value){if(typeof value==='function')value(eb);return this},
        where(){return this},groupBy(){return this},orderBy(){return this},
        execute:async()=>[{date:'2026-01-01',n:'3'}],executeTakeFirst:async()=>({day:'2026-01-01'})};
      return q;
    }
  };
  const result=await executor(db,{kind:'analytics',
    args:{p_scope_id:'loc',p_view:'loc',p_options:{}}},
    {engine:'mssql',namespace:'dbo',role:'anon'});
  assert.deepEqual(result.data.scopes,[{scope_id:'writer',display_name:'writer'}]);
  assert.deepEqual(result.data.rows,[{scope_id:'writer',day:'2026-01-01',item_count:3}]);
  assert.deepEqual(readTables,['dbo.writer_galaxy']);
});
