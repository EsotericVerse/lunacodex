import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/loc/providers/kysely-analytics.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function searchSummary(trx,options){');
const end=source.indexOf('\nasync function ',start+1);
assert.ok(start>=0&&end>start,'searchSummary source must be present');
const fn=new Function('reject','SCOPE',source.slice(start,end)+'\nreturn searchSummary;')(
  message=>{throw new Error(message)},/^[a-z][a-z0-9]{0,14}$/
);

function fixture(){
  const calls=[],tables={
    'silver.manage':[{id:'alpha'},{id:'beta'}],
    'silver.alpha':[{status:{search:{article_count:2,word_count:33}}}],
    'silver.beta':[{status:{search:{article_count:4,word_count:55}}}]
  };
  const trx={selectFrom(name){
    const conditions=[];
    calls.push({name,conditions});
    return {
      select(){return this},
      where(column,operator,value){conditions.push([column,operator,value]);return this},
      async execute(){
        return (tables[name]||[]).filter(row=>conditions.every(([col,op,v])=>
          op==='in'?v.includes(row[col]):row[col]===v));
      },
      async executeTakeFirst(){return (await this.execute())[0]||null}
    };
  }};
  return {trx,calls};
}

test('active Scope validation uses one native Kysely IN query',async()=>{
  const {trx,calls}=fixture();
  const result=await fn(trx,{scopeIds:['beta','alpha','beta','missing']});
  assert.deepEqual(result.rows.map(row=>row.scope_id),['alpha','beta']);
  assert.equal(calls.filter(c=>c.name==='silver.manage').length,1);
  assert.deepEqual(calls.map(c=>c.name),['silver.manage','silver.alpha','silver.beta']);
  assert.deepEqual(calls[0].conditions[0],['id','in',['alpha','beta','missing']]);
  assert.equal(result.rows[0].article_count,2);
  assert.equal(result.rows[1].word_count,55);
});

test('empty scope request never queries the database',async()=>{
  const {trx,calls}=fixture();
  assert.deepEqual(await fn(trx,{scopeIds:[]}),{rows:[]});
  assert.deepEqual(calls,[]);
});

test('invalid scope names reject before any SQL is executed',async()=>{
  const {trx,calls}=fixture();
  await assert.rejects(fn(trx,{scopeIds:['alpha','bad.scope']}),/Invalid Scope/);
  assert.deepEqual(calls,[]);
});
