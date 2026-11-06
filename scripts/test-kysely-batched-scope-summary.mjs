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
    'silver.manage':[{id:'alpha',manage_role:'scope',active:true},{id:'beta',manage_role:'scope',active:true}],
    'silver.alpha':[{id:'alpha',status:{search:{article_count:2,word_count:33}}}],
    'silver.beta':[{id:'beta',status:{search:{article_count:4,word_count:55}}}]
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

test('public class aliases use one native Kysely projection, not one query per Class',async()=>{
  const {createHash}=await import('node:crypto');
  const start=source.indexOf('async function sharedClasses(');
  const end=source.indexOf('\nasync function keywordCatalog(',start);
  assert.ok(start>=0&&end>start);
  const sql=(strings,...values)=>({
    strings:[...strings],values,
    as(name){return {alias:name,strings:[...strings],values}}
  });
  sql.ref=name=>({reference:name});
  const classes=[
    {uid:'Ab12Cd34',title:'Primary'},
    {uid:'Ef56Gh78',title:'Private'},
    {uid:'Ij90Kl12',title:'Secondary'}
  ];
  const hash=uid=>createHash('sha256').update('writer:'+uid).digest('hex');
  const fake=(owner)=>{
    const calls=[];
    const trx={selectFrom(table){
      calls.push(table);
      let projected=false;
      return {
        select(fields){
          if(fields?.alias==='share_hash'){
            projected=true;
            assert.deepEqual(fields.values[1],{reference:'uid'});
            assert.match(fields.strings.join(''),/encode\(sha256\(convert_to\(/);
          }
          return this;
        },
        where(){return this},
        orderBy(){return this},
        async executeTakeFirst(){return {
          keyword_meta:{class_shares:{Ab12Cd34:true,Ij90Kl12:true}}
        }},
        async execute(){return classes.map(row=>({
          ...row,...(projected?{share_hash:hash(row.uid)}:{})
        }))}
      };
    }};
    const fn=new Function('owns','published','sql',source.slice(start,end)+
      '\nreturn sharedClasses;')(
      async()=>owner,(cfg,uid)=>cfg?.keyword_meta?.class_shares?.[uid]===true,sql);
    return {calls,run:()=>fn(trx,'writer','silver.writer_anchor','anon')};
  };
  const publicRun=fake(false);
  const publicResult=await publicRun.run();
  assert.deepEqual(publicRun.calls,['silver.writer','silver.writer_anchor']);
  assert.deepEqual(publicResult.map(row=>row.category),
    [hash('Ab12Cd34'),hash('Ij90Kl12')]);
  const ownerRun=fake(true);
  const ownerResult=await ownerRun.run();
  assert.deepEqual(ownerRun.calls,['silver.writer','silver.writer_anchor']);
  assert.deepEqual(ownerResult.map(row=>row.category),classes.map(c=>c.uid));
});
