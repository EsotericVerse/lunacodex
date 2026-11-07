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
  assert.deepEqual(readTables,['dbo.writer_galaxy','dbo.writer_galaxy']);
});


test('portable owner can read keyword classes and class/group/item catalog',async()=>{
  const own=new Function('sql','canManageLoc','portableRelation',
    source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return executePortableKyselyAnalytics')({},async()=>true,
    (table,engine,namespace)=>engine==='mysql'?table:namespace+'.'+table);
  const classUid='ABCD1234',groupUid='EFGH5678',itemUid='IJKL9012';
  const nodes=[
    {uid:classUid,type:'class',title:'符文66',description:'分類',
      attr:JSON.stringify({uid:[groupUid]})},
    {uid:groupUid,type:'group',title:'靈魂組',description:'分組',
      attr:JSON.stringify({uid:[itemUid]})},
    {uid:itemUid,type:'item',title:'靈',description:'規則',
      attr:JSON.stringify({total:0,keyword:['心靈']})}
  ];
  const db={selectFrom:()=>{const filters=[];
    const q={
      select(){return this},where(column,operator,value){
        filters.push({column,operator,value});return this;},
      orderBy(){return this},execute:async()=>nodes.filter(row=>
        filters.every(f=>f.column==='uid'&&f.operator==='in'
          ?f.value.includes(row.uid):row[f.column]===f.value)),
      async executeTakeFirst(){return (await this.execute())[0]||null}
    };
    return q;
  }};
  const params={engine:'mssql',namespace:'dbo',role:'authenticated'};
  const shared=await own(db,{args:{p_scope_id:'writer',p_view:'shared_classes'}},params);
  assert.deepEqual(shared.data,[{scopeId:'writer',classUid,name:'符文66',category:classUid}]);
  const catalog=await own(db,{args:{p_scope_id:'writer',p_view:'keyword_catalog',
    p_options:{classUid}}},params);
  assert.equal(catalog.data.class_uid,classUid);
  assert.deepEqual(catalog.data.rows.map(x=>x.name),['符文66','靈魂組','靈']);
  const hidden=await executor(db,{args:{p_scope_id:'writer',p_view:'keyword_catalog',
    p_options:{classUid}}},{engine:'mssql',namespace:'dbo',role:'anon'});
  assert.deepEqual(hidden.data,{});
});

test('portable LOC earliest uses all dates even when displayed daily rows are date-filtered',async()=>{
  const eb={fn:{countAll:()=>({as:key=>({key})}),min:()=>({as:key=>({key})})}};
  const calls=[];
  const db={
    introspection:{getTables:async()=>[
      {schema:'dbo',name:'writer_galaxy'},{schema:'dbo',name:'writer_anchor'}]},
    selectFrom:table=>{
      const filters=[];calls.push(filters);
      return {where(column,op,value){filters.push([column,op,value]);return this;},
        select(value){if(typeof value==='function')value(eb);return this;},
        groupBy(){return this;},orderBy(){return this;},
        execute:async()=>[{date:'2026-11-01',n:'3'}],
        executeTakeFirst:async()=>({day:'2018-04-01'})};
    }
  };
  const result=await executor(db,{args:{p_scope_id:'loc',p_view:'loc',
    p_start:'2026-01-01',p_end:'2026-12-31'}},
    {engine:'mssql',namespace:'dbo',role:'anon'});
  assert.equal(result.data.earliest,'2018-04-01');
  assert.equal(calls.length,2);
  assert.ok(calls[0].some(x=>x[0]==='date'&&x[1]==='>='));
  assert.ok(!calls[1].some(x=>x[0]==='date'&&['>=','<='].includes(x[1])));
});

test('portable daily includeUndated retains NULL date groups using Kysely',async()=>{
  const filters=[];
  const eb={fn:{countAll:()=>({as:key=>({key})})}};
  const db={selectFrom:()=>({
    where(column,operator,value){filters.push([column,operator,value]);return this;},
    select(value){if(typeof value==='function')value(eb);return this;},
    groupBy(){return this;},orderBy(){return this;},
    execute:async()=>[{date:null,site:'source',n:'2'}]
  })};
  const result=await executor(db,{args:{p_scope_id:'writer',p_view:'daily',
    p_options:{includeUndated:true}}},{engine:'mysql',namespace:'',role:'anon'});
  assert.ok(!filters.some(x=>x[0]==='date'&&x[1]==='is not'));
  assert.equal(result.data.find(x=>x.kind==='total').item_count,2);
  assert.equal(result.data.find(x=>x.kind==='source').day,'');
});

test('retired multimedia overview does not request Anchor inventory or media_link',()=>{
  assert.doesNotMatch(source,/async function linkedMediaCount/);
  assert.doesNotMatch(source,/async function portableLinkedMediaCount/);
  assert.doesNotMatch(source,/media_count\s*:/);
  const nativeOverview=source.slice(source.indexOf('async function scopeOverview('),
    source.indexOf('async function searchSummary('));
  assert.doesNotMatch(nativeOverview,/media_link|anchor|linkedMedia/);
  const portableOverview=source.slice(source.indexOf("else if(mode==='overview'){"),
    source.indexOf('export async function executePortableKyselyAnalytics'));
  assert.doesNotMatch(portableOverview,/db\.selectFrom\(anchor\)|media_link|media_count/);
});

test('portable analytics executor remains syntactically well-formed after removing media',()=>{
  assert.equal((source.match(/export async function executePortableKyselyAnalytics/g)||[]).length,1);
  assert.doesNotThrow(()=>new Function('sql','canManageLoc','portableRelation',
    source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return executePortableKyselyAnalytics'));
});
