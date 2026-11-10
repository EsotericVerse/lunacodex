import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {createDirectDataApiClient} from '../app/loc/providers/direct-data-api.mjs';

test('static LOC public reads use existing Data API, never an SQL proxy',async()=>{
  const calls=[];
  const response=async (url,options)=>{calls.push({url:String(url),options});
    return new Response(JSON.stringify([{uid:'abcd1234',title:'公開'}]),{
      status:200,headers:{'content-type':'application/json','content-range':'0-0/1'}});};
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',
    apiKey:'public_key',fetch:response});
  const result=await api.schema('silver').from('lo3rwang_galaxy')
    .select('uid,title').eq('uid','abcd1234').limit(1);
  assert.equal(result.data[0].uid,'abcd1234');
  assert.match(calls[0].url,/example.net\/rest\/v1\/lo3rwang_galaxy/);
  assert.equal(calls[0].options.headers['accept-profile'],'silver');
  assert.equal(new URL(calls[0].url).searchParams.get('search'),null);
  assert.ok(!calls[0].url.includes('gateway'));
});
test('public article body no longer uses retired list/search flag filters',async()=>{
  let actual;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async u=>{actual=new URL(u);return new Response('[]',{status:200})}});
  await api.schema('silver').from('lo3rwang_galaxy').select('uid,content');
  assert.equal(actual.searchParams.get('search'),null);
  assert.equal(actual.searchParams.get('list'),null);
});
test('public Data API remains read-only and LOC OAuth is required for managed writes',async()=>{
  const publicOnly=createDirectDataApiClient({
    url:'https://example.net/rest/v1',apiKey:'public',role:'anon',
    fetch:async()=>{throw Error('unexpected public write')}
  });
  assert.throws(()=>publicOnly.schema('silver').from('loc').insert({uid:'abcdefgh'}),
    /owner Web Server/);
  const adapter=createConfiguredAdapter({
    accountAdapter:{auth:{},getAccessToken:async()=>''},
    fetchImpl:async()=>{throw Error('unexpected unauthenticated network request')}
  });
  await assert.rejects(
    async()=>await adapter.authClient.schema('silver').from('loc').insert([{id:'x'}]).select('id'),
    /LOC login required/);
});


test('Culture and Statistics use the same native bounded Galaxy business reader',async()=>{
  const calls=[];
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async(url,opts)=>{
      calls.push({url:String(url),opts});
      return Response.json({data:[{day:'2026-11-08',site:'threads',item_count:3}]});
    }});
  const data=await api.schema('silver').analytics({
    p_view:'culture_density',p_scope_id:'lo3rwang',
    p_start:'2026-11-01',p_end:'2026-11-08'
  });
  assert.equal(data.data[0].item_count,3);
  const stats=await api.schema('silver').analytics({
    p_view:'overview',p_scope_id:'lo3rwang',
    p_start:'2026-11-01',p_end:'2026-11-08'
  });
  assert.equal(stats.data[0].item_count,3);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.url.startsWith('/api/loc-public-content?')));
  assert.equal(new URL(calls[0].url,'https://loc.lo3rwang.cc').searchParams.get('kind'),
    'culture_density');
  assert.equal(new URL(calls[1].url,'https://loc.lo3rwang.cc').searchParams.get('kind'),
    'overview');
  assert.ok(calls.every(call=>!call.url.includes('count()')&&!call.url.includes('/rest/v1')));
  assert.ok(calls.every(call=>call.opts.credentials==='omit'));
});
test('native Galaxy analytics rejects unrecognized operations without any request',async()=>{
  let calls=0;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async()=>{calls++;throw Error('unexpected network')}});
  await assert.rejects(api.schema('silver').analytics({
    p_scope_id:'lo3rwang',p_view:'arbitrary_sql'
  }),/Unsupported public aggregation operation/);
  assert.equal(calls,0);
});

test('public full-text search compiles contains into supported Data API ILIKE',async()=>{
  const calls=[];
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',
    apiKey:'public',fetch:async url=>{
      calls.push(new URL(url));return Response.json([{uid:'abcd1234'}]);
    }});
  await api.schema('silver').from('lo3rwang_galaxy')
    .select('uid').eq('search',true).or('content.contains."希望",title.contains."希望"')
    .limit(1);
  const clause=calls[0].searchParams.get('or');
  assert.equal(clause,'(content.ilike."*希望*",title.ilike."*希望*")');
  assert.ok(!clause.includes('.contains.'));
  assert.equal(calls[0].searchParams.get('search'),'eq.true');
});
test('compound full-text filters retain AND/OR grouping and literal wildcard escaping',async()=>{
  let url;
  const api=createDirectDataApiClient({url:'https://example.net/rest/v1',
    apiKey:'public',fetch:async raw=>{url=new URL(raw);return Response.json([]);}});
  await api.schema('silver').from('lo3rwang_galaxy')
    .select('uid').or('and(or(content.contains."A_B",title.contains."希望"),date.gte.2026-11-01)')
    .not('content','contains','封鎖').limit(1);
  const clause=url.searchParams.get('or');
  assert.match(clause,/^\(and\(or\(content\.ilike\./);
  assert.ok(clause.includes('title.ilike."*希望*"'));
  assert.ok(clause.includes('date.gte.'));
  assert.ok(!clause.includes('.contains.'));
  assert.equal(url.searchParams.get('content'),'not.ilike.*封鎖*');
});

test('website Extension bridge exchanges LOC Session for an exact write delegation',async()=>{
  const calls=[];
  const token='header.payload.signature';
  const fake=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/v1/delegation'))return Response.json({access_token:token});
    if(url==='/api/loc-native')return Response.json({accepted:true,id:'batch-id',articles:[]});
    throw Error('Unexpected URL');
  };
  const adapter=createConfiguredAdapter({
    accountAdapter:{auth:{},getAccessToken:async()=> 'site.session.jwt'},
    fetchImpl:fake
  });
  const result=await adapter.authClient.shortImport('lo3rwang',{id:'batch-id'});
  assert.equal(result.accepted,true);
  assert.equal(calls.length,2);
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    audience:'sql',scopeid:'lo3rwang',actions:['write']
  });
  assert.equal(calls[0].options.headers.authorization,'Bearer site.session.jwt');
  assert.equal(calls[1].url,'/api/loc-native');
  assert.equal(calls[1].options.headers.authorization,'Bearer '+token);
  assert.deepEqual(JSON.parse(calls[1].options.body),{
    kind:'short-import',scopeid:'lo3rwang',batch:{id:'batch-id'}
  });
  assert.ok(!calls.some(item=>item.url.includes('/rest/v1')));
});
test('website importer never sends a request for an invalid Scope',async()=>{
  let calls=0;
  const adapter=createConfiguredAdapter({
    accountAdapter:{auth:{},getAccessToken:async()=> 'anything'},
    fetchImpl:async()=>{calls++;throw Error('unexpected')}
  });
  await assert.rejects(adapter.authClient.shortImport('bad_scope',{id:'x'}),/Invalid LOC import Scope/);
  assert.equal(calls,0);
});

test('Search summary reads published public status without unsupported analytics or network',async()=>{
  const {readScopeSearchSummary}=await import('../app/loc/scope-search-summary.mjs');
  const result=await readScopeSearchSummary(['lo3rwang','lrunes']);
  assert.deepEqual(result.rows.map(row=>row.scope_id),['lo3rwang','lrunes']);
  assert.equal(result.summary.articleCount,49031);
  assert.equal(result.summary.wordCount,4904148);
  assert.equal(result.summary.firstDate,'2005-04-12');
  assert.equal(result.summary.lastDate,'2026-11-05');
});

test('LOC Group aggregate uses existing fixed native public endpoint, not a retired RPC',async()=>{
  const calls=[];
  const api=createDirectDataApiClient({
    url:'https://example.net/rest/v1',apiKey:'public',
    fetch:async(url)=>{calls.push(String(url));return Response.json({
      data:{earliest:'2005-04-12',scopes:[{scope_id:'lo3rwang',display_name:'作者'}],rows:[]}
    });}
  });
  const result=await api.schema('silver').analytics({
    p_view:'loc',p_scope_id:'loc',p_start:'2026-11-01',p_end:'2026-11-09'
  });
  assert.equal(result.data.scopes[0].scope_id,'lo3rwang');
  assert.equal(calls.length,1);
  assert.match(calls[0],/^\/api\/loc-public-content\?kind=loc&scope=loc&start=/);
});
