import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler} from 'kysely';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {handleNativePublicQuery} from '../app/loc/server/native-public-query.mjs';

const endpoint='https://loc.lo3rwang.cc/api/loc-public-query';
const request=value=>new Request(endpoint,{method:'POST',headers:{
  'content-type':'application/json'
},body:JSON.stringify(value)});
const query={schema:'silver',table:'lo3rwang_galaxy',columns:['uid','title'],
  filters:[{column:'uid',op:'eq',value:'abcdefgh',negate:false}],
  orFilters:[],orders:[],limit:10,offset:0,head:false,count:null,cardinality:null};

function fixedModelDialect(){
  const executed=[];
  const driver=new DummyDriver();
  const acquire=driver.acquireConnection.bind(driver);
  driver.acquireConnection=async()=>{
    const connection=await acquire();
    const execute=connection.executeQuery.bind(connection);
    connection.executeQuery=async compiled=>{
      executed.push(compiled);
      return {rows:[]};
    };
    return connection;
  };
  return {executed,dialect:{
    createDriver:()=>driver,createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()
  }};
}

test('public client uses only the Pages Kysely route, not Supabase Data API',async()=>{
  const calls=[];
  const client=createKyselyPublicClient({fetch:async(url,options)=>{
    calls.push({url,options});
    return Response.json({data:[{uid:'abcdefgh',title:'公開作品'}],count:null});
  }});
  const result=await client.schema('silver').from('lo3rwang_galaxy')
    .select('uid,title').eq('uid','abcdefgh').limit(1);
  assert.equal(result.data[0].uid,'abcdefgh');
  assert.equal(calls[0].url,'/api/loc-public-query');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.credentials,'omit');
  assert.deepEqual(JSON.parse(calls[0].options.body).filters,[{
    column:'uid',op:'eq',value:'abcdefgh',negate:false
  }]);
  assert.ok(!calls.some(item=>item.url.includes('/rest/v1')));
});
test('the browser cannot write or choose a SQL connection',async()=>{
  const client=createKyselyPublicClient({fetch:async()=>{
    throw Error('No request expected');
  }});
  assert.throws(()=>client.schema('silver').from('lo3rwang_galaxy')
    .insert({title:'private'}),/read only/);
  await assert.rejects(async()=>client.schema('silver').from('lo3rwang_galaxy')
    .select('uid').expectDatabase('external'),/signed LOC delegation/);
});
test('anonymous API rejects manage, personal data and arbitrary SQL before database access',async()=>{
  let called=0;
  for(const entry of [
    {...query,schema:'api',table:'manage'},
    {...query,schema:'api',table:'loc_user'},
    {...query,table:'secret_credential'},
    {...query,table:'lo3rwang_galaxy;drop table api.manage'},
    {...query,filters:[{column:'uid;delete',op:'eq',value:'x'}]}
  ]){
    const response=await handleNativePublicQuery(request(entry),{},{
      database:async()=>{called++;throw Error('Unexpected SQL')}
    });
    assert.equal(response.status,400,JSON.stringify(entry));
  }
  assert.equal(called,0);
});
test('valid public SELECT uses the same fixed loc-main Kysely target',async()=>{
  let alias='',selectedTable='',selectedColumns,selectedOffset;
  const qb={
    where(){return this},
    select(columns){selectedColumns=columns;return this},
    selectAll(){selectedColumns='*';return this},
    orderBy(){return this},limit(){return this},offset(value){selectedOffset=value;return this},
    async execute(){return [{uid:'abcdefgh',title:'公開作品'}]}
  };
  const response=await handleNativePublicQuery(request({...query,offset:10000001}),{},{
    database:async(_env,id)=>{
      alias=id;
      return {engine:'postgres',namespace:'silver',db:{
        selectFrom(table){selectedTable=table;return qb}
      }};
    }
  });
  assert.equal(response.status,200);
  assert.equal(alias,'loc-main');
  assert.equal(selectedTable,'silver.lo3rwang_galaxy');
  assert.deepEqual(selectedColumns,['uid','title']);
  // Public offset is not silently capped; the SQL engine handles valid offsets.
  assert.equal(selectedOffset,10000001);
  assert.equal((await response.json()).data[0].title,'公開作品');
});

test('public Blocks SELECT uses the fixed Blocks PolicyPlugin delegate',async()=>{
  const {executed,dialect}=fixedModelDialect();
  const response=await handleNativePublicQuery(request({
    schema:'silver',table:'loc_blocks',columns:['uid','page_name'],
    filters:[{column:'page_name',op:'eq',value:'index',negate:false}],
    orFilters:[],orders:[{column:'block_order',ascending:true}],limit:10,
    offset:0,head:false,count:null,cardinality:null
  }),{}, {database:async()=>({engine:'postgres',namespace:'silver',dialect,
    db:{selectFrom(){throw Error('Fixed Blocks must not use plain Kysely')}}})});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:[],count:null});
  assert.equal(executed.length,1);
  assert.match(executed[0].sql,/from "silver"\."loc_blocks" as "LocBlocks"/);
});
test('backend SQL errors expose only stage and SQLSTATE',async()=>{
  const result=await handleNativePublicQuery(request(query),{},{
    database:async()=>({engine:'postgres',namespace:'silver',db:{
      selectFrom(){throw Object.assign(Error('secret SQL connection string'),{code:'42501'})}
    }})
  });
  assert.equal(result.status,503);
  const payload=await result.json();
  assert.equal(payload.stage,'select');
  assert.equal(payload.code,'42501');
  assert.equal(JSON.stringify(payload).includes('secret SQL'),false);
});
test('active LOC providers contain no vendor REST API path or published numeric fallback',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  for(const p of [
    'app/loc/providers/configured.mjs',
    'app/loc/server/native-public-content.mjs',
    'app/api/loc/_server.js'
  ]){
    const content=read(p);
    assert.doesNotMatch(content,/createDirectDataApiClient|rest\/v1/);
  }
  const native=read('app/loc/server/native-public-content.mjs');
  assert.doesNotMatch(native,/publishedNumeric|publicPresentationFallback|publishedResponse/);
  const routes=JSON.parse(read('public/_routes.json'));
  assert.ok(routes.include.includes('/api/loc-public-query'));
});


test('guest analytics and public actions stay on Kysely and preserve request contracts',async()=>{
  const calls=[];
  const client=createKyselyPublicClient({fetch:async(url,options)=>{
    calls.push({url,options});
    return Response.json({data:url.includes('public-content')?[]:{rows:[]},count:null});
  }});
  const schema=client.schema('silver');
  await schema.analytics({p_scope_id:'lo3rwang',p_view:'culture_list',
    p_start:'2026-11-01',p_end:'2026-11-10',
    p_options:{site:'threads',offset:0}});
  await schema.analytics({p_scope_id:'loc',p_view:'search_summary',
    p_options:{scopeIds:['lo3rwang','lrunes']}});
  await schema.publicAction('page_blocks',{p_scope_id:'loc',p_type:'index'});
  await schema.analytics({p_scope_id:'lo3rwang',p_view:'daily',
    p_start:'2026-11-01',p_end:'2026-11-10'});
  assert.deepEqual(calls.slice(0,3).map(c=>c.url),
    Array(3).fill('/api/loc-public-query'));
  const [culture,search,blocks]=calls.map(c=>JSON.parse(c.options.body||'null'));
  assert.equal(culture.kind,'analytics');
  assert.equal(culture.args.p_view,'culture_list');
  assert.deepEqual(search.args.p_options.scopeIds,['lo3rwang','lrunes']);
  assert.equal(blocks.kind,'public-action');
  assert.equal(blocks.name,'page_blocks');
  assert.ok(calls[3].url.startsWith('/api/loc-public-content?'));
  assert.ok(calls.every(c=>c.options.credentials==='omit'));
});

test('guest analytics and public actions reject unknown scopes and private modes before SQL',async()=>{
  let databaseCalls=0;
  for(const body of [
    {kind:'analytics',args:{p_scope_id:'admin',p_view:'culture_list'}},
    {kind:'analytics',args:{p_scope_id:'loc',p_view:'keyword_catalog'}},
    {kind:'analytics',args:{p_scope_id:'loc',p_view:'search_summary',
      p_options:{scopeIds:['admin']}}},
    {kind:'analytics',args:{p_scope_id:'lo3rwang',p_view:'culture_list',
      p_options:{site:'x',connection:'arbitrary'}}},
    {kind:'public-action',name:'managedWrite',args:{p_scope_id:'loc'}},
    {kind:'public-action',name:'search_scope_trace_place_names',
      args:{p_scope_id:'loc',p_term:'abc'}}
  ]){
    const res=await handleNativePublicQuery(request(body),{},{
      database:async()=>{databaseCalls++;throw Error('Private SQL must not run')}
    });
    assert.equal(res.status,400,JSON.stringify(body));
  }
  assert.equal(databaseCalls,0);
});

test('exact count is not the size of the selected page',async()=>{
  let countReads=0;
  const response=await handleNativePublicQuery(request({...query,count:'exact'}),{},{
    database:async()=>({engine:'postgres',namespace:'silver',db:{
      selectFrom:()=>({
        where(){return this},select(value){this.isCount=typeof value==='function';return this},
        limit(){return this},offset(){return this},
        async executeTakeFirst(){countReads++;return {count:127}},
        async execute(){return [{uid:'abcdefgh',title:'作品'}]}
      })
    }})
  });
  assert.equal(response.status,200);
  assert.equal((await response.json()).count,127);
  assert.equal(countReads,1);
});
