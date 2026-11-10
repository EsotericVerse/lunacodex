import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {QueryClient} from '@tanstack/react-query';

// One native client-query engine is shared by ZenStack-backed GUI resources.
const source=readFileSync(new URL('../zenstack/client-queries.js',import.meta.url),'utf8');

async function resourceHarness(){
  const context=vm.createContext({Map,WeakMap,Promise,Array,Object,String,Boolean,Math,console});
  let currentClient=null,infiniteOptions=null;
  const react=new vm.SyntheticModule(['useMemo'],function(){
    this.setExport('useMemo',fn=>fn());
  },{context});
  const query=new vm.SyntheticModule(
    ['useQuery','useInfiniteQuery','useQueryClient','skipToken'],
    function(){
      this.setExport('useQuery',options=>({
        data:undefined,error:null,isLoading:false,isFetching:false,
        isSuccess:false,isError:false,refetch:async()=>({data:await options.queryFn()})
      }));
      this.setExport('useInfiniteQuery',options=>{
        infiniteOptions=options;
        const last={nextCursor:null};
        return {
          data:{pages:[last],pageParams:[null]},isLoading:false,isFetching:false,
          hasNextPage:options.getNextPageParam(last)!==undefined,
          isSuccess:true,isError:false,isFetchingNextPage:false,
          fetchNextPage:async()=>({}),refetch:async()=>({})
        };
      });
      this.setExport('useQueryClient',()=>currentClient);
      this.setExport('skipToken',Symbol('skip'));
    },{context});
  const flash=new vm.SyntheticModule(['flashMessage'],function(){
    this.setExport('flashMessage',()=>{});
  },{context});
  const module=new vm.SourceTextModule(source,{context,identifier:'use-async-resource'});
  await module.link(name=>{
    if(name==='react')return react;
    if(name==='@tanstack/react-query')return query;
    if(name==='../app/loc/flash-message')return flash;
    throw Error('Unexpected import '+name);
  });
  await module.evaluate();
  return {
    api:module.namespace,
    makeClient:()=>new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:Infinity}}}),
    use:client=>{currentClient=client;},
    infinite:()=>infiniteOptions
  };
}

test('100 concurrent identical resources share one native request per client',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  h.use(client);
  const cache=h.api.useResourceCache();
  let calls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const reads=Array.from({length:100},()=>cache.getOrLoad({
    queryKey:['works','shared'],queryFn:()=>{calls++;return pending;}
  }));
  await Promise.resolve();
  assert.equal(calls,1);
  release('resolved');
  assert.ok((await Promise.all(reads)).every(row=>row==='resolved'));
  assert.equal(cache.get(['works','shared']),'resolved');
  const other=h.makeClient();
  h.use(other);
  assert.equal(await h.api.useResourceCache().getOrLoad({
    queryKey:['works','shared'],queryFn:async()=>{calls++;return 'other';}
  }),'other');
  assert.equal(calls,2);
});

test('native invalidation allows fresh explicit reads without background polling',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  const cache=h.api.createResourceCache(client),queryKey=['works','scope-a'];
  let calls=0;
  assert.equal(await cache.getOrLoad({queryKey,queryFn:async()=>{calls++;return 'old';}}),'old');
  assert.equal(await cache.getOrLoad({queryKey,queryFn:async()=>{calls++;return 'not called';}}),'old');
  assert.equal(calls,1);
  await cache.invalidate({queryKey:['works']});
  assert.equal(await cache.getOrLoad({queryKey,queryFn:async()=>{calls++;return 'new';}}),'new');
  assert.equal(calls,2);
});

test('explicit clear prevents obsolete responses from repopulating the cache',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  const cache=h.api.createResourceCache(client),queryKey=['works','scope-a'];
  let resolve;
  const pending=cache.getOrLoad({queryKey,queryFn:()=>new Promise(r=>{resolve=r;})});
  await Promise.resolve();
  await cache.clear({queryKey:['works']});
  resolve('obsolete');
  await pending.catch(()=>{});
  assert.equal(cache.get(queryKey),undefined);
});

test('invalidating a running read supersedes late obsolete data',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  const cache=h.api.createResourceCache(client),queryKey=['works','scope-a'];
  let releaseOld;
  const initial=cache.getOrLoad({
    queryKey,queryFn:()=>new Promise(resolve=>{releaseOld=resolve;})
  });
  await Promise.resolve();
  await cache.invalidate({queryKey:['works']});
  const updated=await cache.getOrLoad({queryKey,queryFn:async()=> 'newest'});
  assert.equal(updated,'newest');
  releaseOld('obsolete');
  await initial.catch(()=>{});
  assert.equal(cache.get(queryKey),'newest');
});

test('native query writes do not create a second state store',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  const cache=h.api.createResourceCache(client);
  cache.set(['works','scope-a'],{version:2});
  assert.equal(cache.get(['works','scope-a']).version,2);
  assert.equal(client.getQueryData(['works','scope-a']).version,2);
});

test('infinite resources stop on null/undefined and allow a zero offset',async()=>{
  const h=await resourceHarness(),client=h.makeClient();
  h.use(client);
  h.api.useAsyncInfiniteResource({
    queryKey:['works','scope-a'],queryFn:async()=>({rows:[]}),
    initialPageParam:null,getNextPageParam:page=>page.nextCursor
  });
  const config=h.infinite();
  assert.equal(config.initialPageParam,null);
  assert.equal(config.getNextPageParam({nextCursor:null}),undefined);
  assert.equal(config.getNextPageParam({nextCursor:undefined}),undefined);
  assert.equal(config.getNextPageParam({nextCursor:0}),0);
});
