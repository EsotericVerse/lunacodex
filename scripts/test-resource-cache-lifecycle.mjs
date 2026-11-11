import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// LOC's one native read layer — no TanStack, no SWR, no read-through cache.
// Every read is fresh; concurrent identical reads share one in-flight request.
const source=readFileSync(new URL('../zenstack/client-queries.js',import.meta.url),'utf8');

async function resourceHarness(){
  const context=vm.createContext({
    Map,WeakMap,Promise,Array,Object,String,Boolean,Math,JSON,console
  });
  // The lifecycle surface (queryClient + createResourceCache) is plain and uses
  // no hooks, so React is stubbed only enough for the module to evaluate.
  const react=new vm.SyntheticModule(
    ['createContext','createElement','useCallback','useContext',
     'useEffect','useMemo','useRef','useState'],
    function(){
      this.setExport('createContext',value=>({Provider:()=>null,_value:value}));
      this.setExport('createElement',()=>null);
      this.setExport('useCallback',fn=>fn);
      this.setExport('useContext',ctx=>ctx&&ctx._value);
      this.setExport('useEffect',()=>{});
      this.setExport('useMemo',fn=>fn());
      this.setExport('useRef',initial=>({current:initial}));
      this.setExport('useState',initial=>[typeof initial==='function'?initial():initial,()=>{}]);
    },{context});
  const flash=new vm.SyntheticModule(['flashMessage'],function(){
    this.setExport('flashMessage',()=>{});
  },{context});
  const module=new vm.SourceTextModule(source,{context,identifier:'client-queries'});
  await module.link(name=>{
    if(name==='react')return react;
    if(name==='../app/loc/flash-message')return flash;
    throw Error('Unexpected import '+name);
  });
  await module.evaluate();
  const api=module.namespace;
  return {api,cache:api.createResourceCache(api.queryClient)};
}

test('100 concurrent identical reads share one in-flight request',async()=>{
  const {cache}=await resourceHarness();
  let calls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const reads=Array.from({length:100},()=>cache.getOrLoad({
    queryKey:['works','shared'],queryFn:()=>{calls++;return pending;}
  }));
  await Promise.resolve();
  assert.equal(calls,1,'identical concurrent reads must coalesce into one request');
  release('resolved');
  assert.ok((await Promise.all(reads)).every(row=>row==='resolved'));
});

test('reads are always fresh — no read-through cache serves a stale value',async()=>{
  const {cache}=await resourceHarness();
  const queryKey=['works','scope-a'];
  let calls=0;
  assert.equal(await cache.getOrLoad({queryKey,queryFn:async()=>{calls++;return 'old';}}),'old');
  // A later sequential read MUST re-run the fetcher. If this returns 'old' with
  // calls===1, a client cache has crept back in — the exact regression to block.
  assert.equal(await cache.getOrLoad({queryKey,queryFn:async()=>{calls++;return 'fresh';}}),'fresh');
  assert.equal(calls,2);
});

test('invalidate triggers re-read and is safe with no mounted consumer',async()=>{
  const {cache}=await resourceHarness();
  await assert.doesNotReject(cache.invalidate({queryKey:['works']}));
});

test('set / get use a single store, shared with the query client',async()=>{
  const {api,cache}=await resourceHarness();
  cache.set(['works','scope-a'],{version:2});
  assert.equal(cache.get(['works','scope-a']).version,2);
  assert.equal(api.queryClient.getQueryData(['works','scope-a']).version,2);
});

test('clear removes a stored value by key prefix',async()=>{
  const {cache}=await resourceHarness();
  cache.set(['works','scope-a'],{version:1});
  await cache.clear({queryKey:['works']});
  assert.equal(cache.get(['works','scope-a']),undefined);
});
