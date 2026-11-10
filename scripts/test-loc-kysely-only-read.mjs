import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {handleNativePublicQuery} from '../app/loc/server/native-public-query.mjs';

const endpoint='https://loc.lo3rwang.cc/api/loc-public-query';
const request=value=>new Request(endpoint,{method:'POST',headers:{
  'content-type':'application/json'
},body:JSON.stringify(value)});
const query={schema:'silver',table:'lo3rwang_galaxy',columns:['uid','title'],
  filters:[{column:'uid',op:'eq',value:'abcdefgh',negate:false}],
  orFilters:[],orders:[],limit:10,offset:0,head:false,count:null,cardinality:null};

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
  await assert.rejects(client.schema('silver').from('lo3rwang_galaxy')
    .select('uid').expectDatabase('external'),/signed LOC delegation/);
});
test('anonymous API rejects manage, personal data and arbitrary SQL before database access',async()=>{
  let called=0;
  for(const entry of [
    {...query,schema:'api',table:'manage'},
    {...query,schema:'api',table:'loc_user'},
    {...query,table:'secret_credential'},
    {...query,table:'lo3rwang_galaxy;drop table api.manage'},
    {...query,filters:[{column:'uid;delete',op:'eq',value:'x'}]},
    {...query,offset:10000001}
  ]){
    const response=await handleNativePublicQuery(request(entry),{},{
      database:async()=>{called++;throw Error('Unexpected SQL')}
    });
    assert.equal(response.status,400,JSON.stringify(entry));
  }
  assert.equal(called,0);
});
test('valid public SELECT uses the same fixed loc-main Kysely target',async()=>{
  let alias='',selectedTable='',selectedColumns;
  const qb={
    where(){return this},
    select(columns){selectedColumns=columns;return this},
    selectAll(){selectedColumns='*';return this},
    orderBy(){return this},limit(){return this},offset(){return this},
    async execute(){return [{uid:'abcdefgh',title:'公開作品'}]}
  };
  const response=await handleNativePublicQuery(request(query),{},{
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
  assert.equal((await response.json()).data[0].title,'公開作品');
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
