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

for(const [engine,namespace,expectedExpansion] of [
  ['mysql','',/json_table\(docs\.media_link/],
  ['mssql','dbo',/openjson\(docs\.media_link/],
  ['postgres','silver',/jsonb_array_elements_text\(docs\.media_link/]
]){
  test(engine+' portable Overview counts only media linked from eligible Galaxy rows',async()=>{
    const filters=[],statements=[],refs=[];
    const mockSql=(parts,...args)=>({
      parts,args,execute:async()=>{statements.push(parts.join(''));return {rows:[{n:'7'}]};}
    });
    mockSql.ref=name=>{refs.push(name);return {ref:name};};
    const mediaCount=new Function('sql','canManageLoc','portableRelation',
      source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
      ';return portableLinkedMediaCount')(mockSql,async()=>false,()=>{});
    const db={selectFrom:table=>({
      select(field){assert.equal(field,'media_link');return this;},
      where(...condition){filters.push(condition);return this;}
    })};
    const actual=await mediaCount(db,
      namespace?namespace+'.writer_galaxy':'writer_galaxy',
      namespace?namespace+'.writer_anchor':'writer_anchor',
      engine,'2026-01-01','2026-12-31');
    assert.equal(actual,7);
    assert.equal(refs[0],namespace?namespace+'.writer_anchor':'writer_anchor');
    assert.match(statements[0],expectedExpansion);
    assert.match(statements[0],/count\(distinct linked/);
    assert.ok(filters.some(([field,op,value])=>
      field==='statics'&&op==='='&&value===true));
    assert.ok(filters.some(([field,op,value])=>
      field==='date'&&op==='>='&&value==='2026-01-01'));
    assert.ok(filters.some(([field,op,value])=>
      field==='date'&&op==='<='&&value==='2026-12-31'));
    assert.ok(!filters.some(([field])=>field==='uid'));
  });
}

test('portable media expansion stays inside the helper; no duplicated analytics executor',()=>{
  // Regression for a bad string-based edit that spliced an entire executor
  // into a JSON_TABLE SQL template while still passing a superficial grep.
  assert.equal((source.match(/export async function executePortableKyselyAnalytics/g)||[]).length,1);
  assert.equal((source.match(/async function portableLinkedMediaCount/g)||[]).length,1);
  assert.match(source,/columns\(uid varchar\(8\) path '\$'\)\) as linked/);
  assert.match(source,/cross apply openjson\(docs\.media_link\)/);
  assert.match(source,/jsonb_array_elements_text\(docs\.media_link\)/);
  assert.doesNotMatch(source,/path '\(db,body,/);
  // Parse all executable code, not only the helper substring.
  assert.doesNotThrow(()=>new Function('sql','canManageLoc','portableRelation',
    source.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return executePortableKyselyAnalytics'));
});

const anchorSource=readFileSync('app/loc/providers/kysely-anchor.mjs','utf8');
const portableAnchor=new Function('canManageLoc','portableRelation',
  'serializePortableJsonFields','sql',
  anchorSource.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  ';return executePortableKyselyAnchor')(
  async()=>true,(table,engine,namespace)=>engine==='mysql'?table:namespace+'.'+table,
  fields=>fields,{});

function pointLinkDb(underCount=false){
  const updates=[];
  const db={
    selectFrom:()=>({
      select(){return this;},
      where(){return this;},
      execute:async()=>[{uid:'AAAAAAAA',title:'Point A'}]
    }),
    updateTable:table=>({
      set(values){this.values=values;return this;},
      where(...args){
        if(args[0]==='uid'&&args[1]==='in')this.ids=args[2];
        if(typeof args[0]==='function')args[0]({
          or:conditions=>conditions,
          // Executed only by the predicate builder, not by a database.
        });
        return this;
      },
      executeTakeFirst:async function(){
        updates.push({table,ids:this.ids,values:this.values});
        return {numUpdatedRows:BigInt(this.ids.length-(underCount?1:0))};
      }
    })
  };
  return {db,updates};
}
test('portable Point link uses bounded grouped Kysely UPDATE, not N queries',async()=>{
  const {db,updates}=pointLinkDb();
  const assignments=Array.from({length:405},(_,n)=>({
    uid:String(n).padStart(8,'0'),place_id:'AAAAAAAA'
  }));
  const result=await portableAnchor(db,{scopeid:'writer',type:'point',
    attr:{op:'link',mode:'place_id',updates:assignments}},
    {role:'authenticated',engine:'mysql',namespace:''});
  assert.equal(result.data.count,405);
  assert.deepEqual(updates.map(update=>update.ids.length),[200,200,5]);
  assert.ok(updates.every(update=>update.table==='writer_galaxy'));
  assert.ok(updates.every(update=>update.values.place_id==='AAAAAAAA'));
});
test('portable Point link rejects a concurrent partial batch',async()=>{
  const {db}=pointLinkDb(true);
  await assert.rejects(portableAnchor(db,{scopeid:'writer',type:'point',
    attr:{op:'link',mode:'place_id',updates:[{
      uid:'00000001',place_id:'AAAAAAAA'
    }]}},{role:'authenticated',engine:'mysql',namespace:''}),
    /Concurrent Point link changes/);
});
