import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKyselyEdgeClient} from '../app/loc/providers/kysely-edge.mjs';

function fakeFetch(spy){
  return async (url,init)=>{
    spy.push({url,init});
    return new Response(JSON.stringify({data:[{uid:'aB12cD34'}],count:1}),
      {status:200,headers:{'content-type':'application/json'}});
  };
}
test('existing Supabase Kysely calls retain their endpoint and publishable header',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    url:'https://demo.supabase.co',publishableKey:'public-key',role:'anon',fetch:fakeFetch(spy)
  });
  const result=await client.schema('silver').from('runes').select('uid').limit(1);
  assert.ifError(result.error);
  assert.equal(spy[0].url,'https://demo.supabase.co/functions/v1/loc-kysely');
  assert.equal(spy[0].init.headers.apikey,'public-key');
  assert.equal(spy[0].init.credentials,'omit');
  assert.ok(spy[0].init.signal instanceof AbortSignal);
});
test('independent Kysely Gateway uses verified access-token callback without Supabase',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)
  });
  const result=await client.schema('silver').from('runes').select('uid').limit(1);
  assert.equal(result.data[0].uid,'aB12cD34');
  assert.equal(spy[0].url,'https://db-gateway.example/v1/sql');
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
  assert.equal(spy[0].init.headers.apikey,undefined);
  assert.equal(spy[0].init.credentials,'omit');
});
test('Clerk managed writes use Kysely instead of the management SQL RPC',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)
  });
  const payload={p_table:'silver.lo3rwang_galaxy',p_operation:'update',
    p_values:{title:'Updated'},p_filters:[{column:'uid',operator:'eq',value:'aB12cD34'}]};
  const result=await client.schema('silver').managedWrite(payload);
  assert.ifError(result.error);
  assert.deepEqual(JSON.parse(spy[0].init.body),{kind:'managed-write',payload,target:'configured'});
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
  assert.equal(spy[0].init.credentials,'omit');
});
test('Clerk actions route through the Kysely executor without database RPCs',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)});
  await client.schema('silver').managedAction('read_group_members',{p_group_id:'loc'});
  assert.deepEqual(JSON.parse(spy[0].init.body),{kind:'managed-action',
    name:'read_group_members',args:{p_group_id:'loc'},target:'configured'});
  assert.equal(spy[0].init.headers.authorization,'Bearer trusted.jwt.token');
});
test('Canonical Anchor requests use typed Kysely operations',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({gatewayUrl:'https://db-gateway.example/v1/sql',
    role:'authenticated',getAccessToken:async()=> 'trusted.jwt.token',fetch:fakeFetch(spy)});
  await client.schema('silver').anchor('lo3rwang','point',{op:'link',mode:'place_id',updates:[]});
  assert.deepEqual(JSON.parse(spy[0].init.body),{kind:'anchor',scopeid:'lo3rwang',type:'point',
    attr:{op:'link',mode:'place_id',updates:[]},target:'configured'});
});
test('SQL Gateway never sends unauthenticated private requests',async()=>{
  const spy=[];
  const client=createKyselyEdgeClient({
    gatewayUrl:'https://db-gateway.example/v1/sql',getAccessToken:async()=>'',fetch:fakeFetch(spy)
  });
  await assert.rejects(client.schema('silver').from('manage').select('id'),/active session/);
  assert.equal(spy.length,0);
});
test('gateway URL rejects non-TLS and embedded credentials',()=>{
  for(const url of ['http://db-gateway.example/v1','https://user:pass@db-gateway.example/v1',
    'https://db-gateway.example/v1?apikey=exposed','https://db-gateway.example/v1#secret']){
    assert.throws(()=>createKyselyEdgeClient({gatewayUrl:url,fetch:fakeFetch([])}),/HTTPS URL/);
  }
});


test('ISR numeric readers use Kysely without a Supabase SDK or Auth client',()=>{
  const source=readFileSync(new URL('../app/api/loc/_server.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/@supabase\/supabase-js|createClient\(/);
  assert.match(source,/const primary=createKyselyEdgeClient\(/);
  assert.match(source,/gatewayUrl:SQL_GATEWAY_URL/);
  assert.match(source,/createBackupPublicAdapter/);
});
test('verified external identity can delegate to an independent SQL Gateway',async()=>{
  const source=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  const calls=[];
  const build=new Function('createKyselyEdgeClient',
    'URL','AbortSignal','process',
    source+'\n;return createLocGatewayAdapter;')(
    options=>options,URL,AbortSignal,process
  );
  const gateway=build({
    authorityUrl:'https://authority.example.org',
    gatewayUrl:'https://sql.example.org/v1/query',
    url:'',publishableKey:'',
    accountAdapter:{auth:{getSession:async()=>({data:{session:null}})},
      getAccessToken:async()=> 'verified.external.jwt'},
    fetchImpl:async(url,init)=>{
      calls.push({url,init});
      return {ok:true,json:async()=>({access_token:'loc.signed.jwt',
        expires_at:Math.floor(Date.now()/1000)+300})};
    }
  });
  assert.equal(gateway.realtimeClient,null);
  assert.equal(gateway.publicClient.gatewayUrl,'https://sql.example.org/v1/query');
  assert.equal(gateway.authClient.gatewayUrl,'https://sql.example.org/v1/query');
  assert.equal(gateway.authClient.publishableKey,'');
  assert.equal(await gateway.authClient.getAccessToken({kind:'query',operation:'select',
    schema:'api',table:'loc_user'}),'loc.signed.jwt');
  assert.equal(calls[0].url,'https://authority.example.org/v1/delegation');
  assert.equal(calls[0].init.headers.authorization,'Bearer verified.external.jwt');
  assert.deepEqual(JSON.parse(calls[0].init.body),{audience:'sql',identity:true});
});

test('explicit public publishing pages through the bounded Kysely query port',()=>{
  const source=readFileSync(new URL('../scripts/generate-public-blocks.mjs',import.meta.url),'utf8');
  assert.match(source,/const pageSize=1000/);
  assert.match(source,/\.order\('block_order'\)\.order\('uid'\)\.range\(start,end\)/);
  assert.doesNotMatch(source,/\.range\(0,65534\)/);
});

test('LOC core has no direct vendor SDK or provider imports',()=>{
  const source=readFileSync(new URL('../app/loc/providers/loc-gateway.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/@supabase|clerk-browser|neon-(?:primary|public)|createClient\(/);
  assert.match(source,/createKyselyEdgeClient/);
  assert.match(source,/createLocGatewayAdapter/);
});
