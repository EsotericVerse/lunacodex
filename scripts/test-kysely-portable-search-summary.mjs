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
    introspection:{getTables:async()=>[{schema:namespace,name:'writer_galaxy'},
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
