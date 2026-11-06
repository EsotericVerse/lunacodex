import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/loc/use-async-resource.js',import.meta.url),'utf8');

async function resourceHarness(){
  const context=vm.createContext({Map,WeakMap,Promise,Array,Object,String,Boolean,Math,console});
  let currentProvider=null;
  let infinitePageKey=null,infiniteResult=null;
  const cleanups=[];
  const react=new vm.SyntheticModule(['useMemo','useEffect'],function(){
    this.setExport('useMemo',fn=>fn());
    this.setExport('useEffect',fn=>{
      const cleanup=fn();
      if(typeof cleanup==='function')cleanups.push(cleanup);
    });
  },{context});
  const swr=new vm.SyntheticModule(['default','useSWRConfig','unstable_serialize'],function(){
    this.setExport('default',()=>({}));
    this.setExport('useSWRConfig',()=>currentProvider);
    this.setExport('unstable_serialize',key=>JSON.stringify(key));
  },{context});
  const infinite=new vm.SyntheticModule(['default','unstable_serialize'],function(){
    this.setExport('default',fn=>{
      infinitePageKey=fn;
      return infiniteResult||{data:undefined,size:1,isLoading:false,isValidating:false};
    });
    this.setExport('unstable_serialize',fn=>'$inf$'+JSON.stringify(fn(0,null)));
  },{context});
  const flash=new vm.SyntheticModule(['flashMessage'],function(){
    this.setExport('flashMessage',()=>{});
  },{context});
  const module=new vm.SourceTextModule(source,{context,identifier:'use-async-resource'});
  await module.link(name=>{
    if(name==='react')return react;
    if(name==='swr')return swr;
    if(name==='swr/infinite')return infinite;
    if(name==='./flash-message')return flash;
    throw new Error('Unexpected import '+name);
  });
  await module.evaluate();
  const createProvider=()=>{
    const cache=new Map(),calls=[];
    const mutate=async(key,value)=>{
      calls.push(key);
      if(Array.isArray(key)&&value!==undefined){
        const next=typeof value==='function'?value():value;
        cache.set(JSON.stringify(key),{data:next});
        return next;
      }
      return value;
    };
    return {cache,mutate,calls};
  };
  return {api:module.namespace,createProvider,use:provider=>{currentProvider=provider;},
    pageKey:(index,previous)=>infinitePageKey?.(index,previous),
    setInfiniteResult:value=>{infiniteResult=value;},cleanups};
}

test('infinite resource registrations are disposed on unmount',async()=>{
  const h=await resourceHarness(),provider=h.createProvider();
  h.use(provider);
  h.api.useAsyncInfiniteResource({
    queryKey:['works','scope-a'],queryFn:async()=>[],
    getNextPageParam:()=>undefined
  });
  const cache=h.api.useResourceCache();
  await cache.invalidate({queryKey:['works']});
  assert.equal(provider.calls.filter(key=>typeof key==='string'&&key.startsWith('$inf$')).length,1);
  provider.calls.length=0;
  for(const cleanup of h.cleanups)cleanup();
  await cache.invalidate({queryKey:['works']});
  assert.equal(provider.calls.filter(key=>typeof key==='string'&&key.startsWith('$inf$')).length,0);
});

test('infinite page indexes never leak across SWR providers',async()=>{
  const h=await resourceHarness(),first=h.createProvider(),second=h.createProvider();
  h.use(first);
  h.api.useAsyncInfiniteResource({
    queryKey:['works','scope-a'],queryFn:async()=>[],
    getNextPageParam:()=>undefined
  });
  h.use(second);
  const secondCache=h.api.useResourceCache();
  await secondCache.invalidate({queryKey:['works']});
  assert.equal(second.calls.filter(key=>typeof key==='string'&&key.startsWith('$inf$')).length,0);
});

test('100 simultaneous identical reads share one request per SWR provider',async()=>{
  const h=await resourceHarness(),first=h.createProvider(),second=h.createProvider();
  h.use(first);
  const handles=Array.from({length:100},()=>h.api.useResourceCache());
  let calls=0,finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const reads=handles.map(handle=>handle.getOrLoad({
    queryKey:['works','shared'],
    queryFn:()=>{calls++;return pending;}
  }));
  await Promise.resolve();
  assert.equal(calls,1);
  h.use(second);
  const next=h.api.useResourceCache().getOrLoad({
    queryKey:['works','shared'],
    queryFn:async()=>{calls++;return 'second';}
  });
  assert.equal(await next,'second');
  assert.equal(calls,2);
  finish('first');
  const values=await Promise.all(reads);
  assert.equal(values.length,100);
  assert.ok(values.every(value=>value==='first'));
});

test('invalidation supersedes pending reads without restoring stale cache data',async()=>{
  const h=await resourceHarness(),provider=h.createProvider();
  h.use(provider);
  const cache=h.api.useResourceCache();
  let finishOld,oldCalls=0,newCalls=0;
  const oldData=new Promise(resolve=>{finishOld=resolve;});
  const oldRead=cache.getOrLoad({queryKey:['works','scope-a'],queryFn:()=>{oldCalls++;return oldData;}});
  await Promise.resolve();
  assert.equal(oldCalls,1);
  await cache.invalidate({queryKey:['works']});
  const fresh=await cache.getOrLoad({queryKey:['works','scope-a'],queryFn:async()=>{newCalls++;return 'fresh';}});
  assert.equal(fresh,'fresh');
  assert.equal(newCalls,1);
  finishOld('obsolete');
  await oldRead;
  assert.equal(cache.get(['works','scope-a']),'fresh');
});

test('clearing a resource prevents an obsolete read from repopulating SWR cache',async()=>{
  const h=await resourceHarness(),provider=h.createProvider();
  h.use(provider);
  const cache=h.api.useResourceCache();
  let resolve;
  const started=cache.getOrLoad({queryKey:['works','scope-a'],queryFn:()=>new Promise(r=>{resolve=r;})});
  await Promise.resolve();
  await cache.clear({queryKey:['works']});
  resolve('obsolete');
  await started;
  assert.equal(cache.get(['works','scope-a']),undefined);
});

test('SWR Infinite treats both null and undefined as terminal cursors',async()=>{
  const h=await resourceHarness(),provider=h.createProvider();
  h.use(provider);
  h.setInfiniteResult({
    data:[{rows:[1],nextCursor:null}],size:1,isLoading:false,isValidating:false
  });
  const result=h.api.useAsyncInfiniteResource({
    queryKey:['works','scope-a'],initialPageParam:null,
    queryFn:async()=>({rows:[]}),
    getNextPageParam:page=>page.nextCursor
  });
  assert.equal(result.hasNextPage,false);
  // A null initial page parameter is valid for page zero.
  assert.notEqual(h.pageKey(0,null),null);
  assert.equal(h.pageKey(1,{nextCursor:null}),null);
  assert.equal(h.pageKey(1,{nextCursor:undefined}),null);
  // Valid falsy cursors must continue pagination.
  assert.deepEqual(h.pageKey(1,{nextCursor:0}).at(-1).param,0);
});

test('SWR Infinite reports a valid next page for a zero offset',async()=>{
  const h=await resourceHarness(),provider=h.createProvider();
  h.use(provider);
  h.setInfiniteResult({
    data:[{rows:[1],nextCursor:0}],size:1,isLoading:false,isValidating:false
  });
  const result=h.api.useAsyncInfiniteResource({
    queryKey:['works','scope-b'],initialPageParam:null,
    queryFn:async()=>({rows:[]}),
    getNextPageParam:page=>page.nextCursor
  });
  assert.equal(result.hasNextPage,true);
});
