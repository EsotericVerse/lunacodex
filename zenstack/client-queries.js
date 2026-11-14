'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {flashMessage} from '../app/loc/flash-message';
import {cancelTransientReads} from './transient-read-epoch.mjs';

// LOC live read layer — no TanStack, no SWR, no browser cache, no polling.
// LOC is a read-only presentation surface over other systems' data, so every
// hook performs a single FRESH read. Concurrent identical reads share one
// in-flight request (dedup), and "invalidate" means "re-read the mounted
// consumers of a key" — never "serve a stale value from a store".
// The query-client shim below keeps the previous call sites unchanged.

const keyOf=key=>Array.isArray(key)?key:[key];
const serialize=key=>JSON.stringify(keyOf(key).map(part=>part===undefined?null:part));

// filterKey is an element-wise prefix of fullKey (TanStack partial-match rule).
function prefixMatch(fullKey,filterKey){
  const filter=keyOf(filterKey);
  if(filter.length>fullKey.length)return false;
  return filter.every((part,index)=>part===fullKey[index]);
}

// Module-level registry of mounted resources. Each entry can be told to
// re-read (refetch), adopt an imperative value (setQueryData), or clear.
const registry=new Map(); // id -> {key, refetch, setData, remove}
let nextId=0;
const inflight=new Map(); // serializedKey -> {key, controller, promise}
let resourceEpoch=0; // route-entry generation invalidates old asynchronous completions
// Only the three tiny identity states outlive their page. SQL read results
// must be released when the last mounted consumer of their key disappears.
const dataStore=new Map();
const IDENTITY_KEYS=new Set([
  ['loc-account','session'],['loc-account','verified-loc-sso'],
  ['loc-account','management']
].map(serialize));
function hasReader(serializedKey){
  for(const entry of registry.values())
    if(serialize(entry.key)===serializedKey)return true;
  return false;
}
function releaseUnobserved(serializedKey){
  if(!IDENTITY_KEYS.has(serializedKey)&&!hasReader(serializedKey))
    dataStore.delete(serializedKey);
}
function retainIfObserved(serializedKey,value){
  if(IDENTITY_KEYS.has(serializedKey)||hasReader(serializedKey))
    dataStore.set(serializedKey,value);
  else dataStore.delete(serializedKey);
}
function register(entry){
  const id=++nextId;
  registry.set(id,entry);
  return ()=>{
    registry.delete(id);
    releaseUnobserved(serialize(entry.key));
  };
}

function forEachMatch(filter={},fn){
  for(const entry of registry.values()){
    if(typeof filter.predicate==='function'){
      if(filter.predicate({queryKey:entry.key}))fn(entry);
    }else if(filter.exact){
      if(serialize(entry.key)===serialize(filter.queryKey))fn(entry);
    }else if(prefixMatch(entry.key,filter.queryKey??[])){
      fn(entry);
    }
  }
}

// One network round-trip per identical key. A new management entry must not
// inherit an unfinished request from a previous page.
function runFetch(serializedKey,fetcher,key=JSON.parse(serializedKey)){
  const existing=inflight.get(serializedKey);
  if(existing)return existing.promise;
  const controller=new AbortController();
  const entry={key,controller,promise:null};
  entry.promise=Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw abortedRead();
    return fetcher({signal:controller.signal});
  }).then(value=>{
    if(controller.signal.aborted)throw abortedRead();
    return value;
  },error=>{
    if(controller.signal.aborted)throw abortedRead();
    throw error;
  }).finally(()=>{
      // Do not delete a newer request started after a page reset.
      if(inflight.get(serializedKey)===entry)inflight.delete(serializedKey);
    });
  inflight.set(serializedKey,entry);
  return entry.promise;
}
function abortedRead(){const error=new Error('Query superseded by page navigation');error.name='AbortError';return error;}
function isCancelled(error){return error?.name==='AbortError';}
function matchesFilter(key,filter={}){
  if(typeof filter.predicate==='function')return filter.predicate({queryKey:key});
  if(filter.exact)return serialize(key)===serialize(filter.queryKey);
  return prefixMatch(key,filter.queryKey??[]);
}
function abortInflight(filter={}){
  for(const [key,entry] of inflight){
    if(IDENTITY_KEYS.has(serialize(entry.key))||!matchesFilter(entry.key,filter))continue;
    inflight.delete(key);
    entry.controller.abort();
  }
}
// Called before each protected management page's first data read and before
// switching editor sections. Preserve only verified identity/permission data.
// Browser JS heap collection is managed by GC; dropping all these references
// makes old page query payloads eligible for collection.
export function releaseTransientPageResources(){
  resourceEpoch++;
  // Abort HTTP reads and requests waiting in the bounded read queue first.
  // The active session, permissions, and explicit writes are not affected.
  cancelTransientReads();
  abortInflight();
  for(const key of [...dataStore.keys()])
    if(!IDENTITY_KEYS.has(key))dataStore.delete(key);
}

export function useAsyncResource(keyOrOptions,fetcherArg,optionsArg={}){
  const legacy=keyOrOptions&&typeof keyOrOptions==='object'&&!Array.isArray(keyOrOptions);
  const key=legacy?keyOrOptions.queryKey:keyOrOptions;
  const fetcher=legacy?keyOrOptions.queryFn:fetcherArg;
  const options=legacy?keyOrOptions:optionsArg;
  const {enabled=true,fallbackData,onError}=options;
  const queryKey=keyOf(key);
  const serializedKey=serialize(queryKey);
  const active=Boolean(enabled)&&typeof fetcher==='function';

  const [state,setState]=useState(()=>({
    data:fallbackData,status:active?'pending':'idle',error:null
  }));
  const [isFetching,setIsFetching]=useState(false);

  const fetcherRef=useRef(fetcher);fetcherRef.current=fetcher;
  const onErrorRef=useRef(onError);onErrorRef.current=onError;
  const mountedRef=useRef(true);
  const activeRef=useRef(active);activeRef.current=active;
  const previousResourceRef=useRef({key:serializedKey,active});
  // Same component, new query key: ignore the older request's completion.
  const currentKeyRef=useRef(serializedKey);
  currentKeyRef.current=serializedKey;
  const isCurrent=()=>mountedRef.current&&currentKeyRef.current===serializedKey;
  const isActiveRead=()=>isCurrent()&&activeRef.current;

  const load=useCallback(async()=>{
    if(!active)return undefined;
    setIsFetching(true);
    const generation=resourceEpoch;
    try{
      const value=await runFetch(serializedKey,()=>fetcherRef.current());
      // A request may finish after unmount; never revive stale route data.
      if(isActiveRead()&&generation===resourceEpoch){
        retainIfObserved(serializedKey,value);
        setState({data:value,status:'success',error:null});
      }
      return value;
    }catch(error){
      // An abandoned page is not a failed data read and must not flash an error.
      if(generation===resourceEpoch&&isActiveRead()&&!isCancelled(error)){
        flashMessage('資料讀取失敗，請稍後再試');
        onErrorRef.current?.(error,queryKey);
        if(isCurrent())setState(previous=>({data:previous.data,status:'error',error}));
      }
      throw error;
    }finally{
      if(isActiveRead()&&generation===resourceEpoch)setIsFetching(false);
    }
  // queryKey is represented by serializedKey; fetcher/onError read from refs.
  },[serializedKey,active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    mountedRef.current=true;
    const previous=previousResourceRef.current;
    if(previous.key!==serializedKey||previous.active!==active){
      // A selector/tab/period change owns a new read. Let the previous
      // dataset be garbage-collected instead of retaining it behind a
      // disabled chart while its old key no longer has a visible consumer.
      previousResourceRef.current={key:serializedKey,active};
      setState({data:active?fallbackData:undefined,
        status:active?'pending':'idle',error:null});
      setIsFetching(false);
    }
    if(active)void load().catch(()=>{});
    const unregister=register({
      key:queryKey,
      refetch:()=>{void load().catch(()=>{});},
      setData:value=>{
        if(isCurrent()){
          retainIfObserved(serializedKey,value);
          setState({data:value,status:'success',error:null});
        }
      },
      remove:()=>{
        dataStore.delete(serializedKey);
        if(isCurrent())setState({data:undefined,status:'idle',error:null});
      }
    });
    return()=>{mountedRef.current=false;unregister();};
  },[serializedKey,active,load]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data:state.data,error:state.error,status:state.status,
    isPending:state.status==='pending',isLoading:state.status==='pending',
    isFetching,isSuccess:state.status==='success',isError:state.status==='error',
    refetch:async()=>load(),
    // The one remaining imperative setter for the local-record writer. It
    // updates live state directly; nothing is persisted to a parallel cache.
    mutate:async(...args)=>{
      if(!args.length)return load();
      const [value,config={}]=args;
      if(value===undefined){
        dataStore.delete(serializedKey);
        if(isCurrent())setState({data:undefined,status:'idle',error:null});
      }else{
        if(isCurrent()){
          retainIfObserved(serializedKey,value);
          setState({data:value,status:'success',error:null});
        }
      }
      if(config.revalidate!==false)return load();
      return dataStore.get(serializedKey);
    }
  };
}

export function useAsyncInfiniteResource({
  queryKey,queryFn,enabled=true,initialPageParam=null,getNextPageParam
}){
  const serializedKey=serialize(queryKey);
  // Callers can pass a fresh object literal for the first cursor on every
  // render. Compare its VALUE rather than object identity, or each render
  // replaces loadFirst -> re-runs the effect -> launches another SQL request.
  const initialParamKey=JSON.stringify(initialPageParam??null);
  const stableInitialParam=useMemo(()=>JSON.parse(initialParamKey),[initialParamKey]);
  const active=Boolean(enabled)&&typeof queryFn==='function';
  const [pages,setPages]=useState([]);
  const [pageParams,setPageParams]=useState([]);
  const [status,setStatus]=useState(active?'pending':'idle');
  const [error,setError]=useState(null);
  const [isFetching,setIsFetching]=useState(false);
  const [isFetchingNextPage,setIsFetchingNextPage]=useState(false);
  // undefined ends paging; a valid zero cursor must continue (match prior rule).
  const [nextParam,setNextParam]=useState(undefined);

  const fnRef=useRef(queryFn);fnRef.current=queryFn;
  const nextParamRef=useRef(undefined);
  const mountedRef=useRef(true);
  const requestEpoch=useRef(0);

  const loadFirst=useCallback(async()=>{
    if(!active)return;
    const request=++requestEpoch.current;
    setIsFetching(true);
    const generation=resourceEpoch;
    try{
      const page=await runFetch('infinite-first:'+serializedKey,
        ({signal})=>fnRef.current({pageParam:stableInitialParam,signal}),keyOf(queryKey));
      if(!mountedRef.current||generation!==resourceEpoch||
        request!==requestEpoch.current)return;
      const next=getNextPageParam?.(page)??undefined;
      nextParamRef.current=next;
      setPages([page]);setPageParams([stableInitialParam]);setNextParam(next);
      setStatus('success');setError(null);
    }catch(caught){
      if(mountedRef.current&&generation===resourceEpoch&&
        request===requestEpoch.current&&!isCancelled(caught)){
        flashMessage('資料讀取失敗，請稍後再試');
        setStatus('error');setError(caught);
      }
    }finally{
      if(mountedRef.current&&request===requestEpoch.current)setIsFetching(false);
    }
  },[serializedKey,active,initialParamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    mountedRef.current=true;
    // Each key/active transition is an ownership boundary: release the old
    // page's rows and cursors *before* fetching the next page. Do not retain
    // a history of pages when the user is viewing only the current 100.
    requestEpoch.current++;
    nextParamRef.current=undefined;
    setPages([]);setPageParams([]);setNextParam(undefined);
    setError(null);setStatus(active?'pending':'idle');
    setIsFetching(false);setIsFetchingNextPage(false);
    if(active)void loadFirst();
    const unregister=register({
      key:keyOf(queryKey),
      refetch:()=>{void loadFirst();},
      setData:()=>{},remove:()=>{
        nextParamRef.current=undefined;
        setPages([]);setPageParams([]);setNextParam(undefined);
      }
    });
    return()=>{mountedRef.current=false;requestEpoch.current++;unregister();};
  },[serializedKey,active,loadFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasNextPage=nextParam!==undefined;
  return {
    data:{pages,pageParams},
    isPending:status==='pending',isLoading:status==='pending',isFetching,
    isFetchingNextPage,isSuccess:status==='success',isError:status==='error',error,
    hasNextPage,
    fetchNextPage:async()=>{
      if(!active||nextParamRef.current===undefined||isFetchingNextPage)return;
      setIsFetchingNextPage(true);
      try{
        const param=nextParamRef.current;
        const generation=resourceEpoch,request=requestEpoch.current;
        const page=await runFetch('infinite-next:'+serializedKey+':'+JSON.stringify(param),
          ({signal})=>fnRef.current({pageParam:param,signal}),keyOf(queryKey));
        if(!mountedRef.current||generation!==resourceEpoch||
          request!==requestEpoch.current)return;
        const next=getNextPageParam?.(page)??undefined;
        nextParamRef.current=next;
        // Drop the previous page instead of accumulating all older 100s.
        setPages([page]);
        setPageParams([param]);
        setNextParam(next);
      }catch(error){
        if(!isCancelled(error))flashMessage('資料讀取失敗，請稍後再試');
      }finally{
        if(mountedRef.current)setIsFetchingNextPage(false);
      }
    },
    refetch:async()=>{await loadFirst();}
  };
}

// Query-client shim. The previous code used a single TanStack QueryClient; these
// methods preserve that surface (invalidate / set / get / remove / cancel /
// fetch) on top of the registry, with no stale cache behind them.
export const queryClient={
  invalidateQueries:(filter={})=>{forEachMatch(filter,entry=>entry.refetch());return Promise.resolve();},
  refetchQueries:(filter={})=>{forEachMatch(filter,entry=>entry.refetch());return Promise.resolve();},
  cancelQueries:(filter={})=>{abortInflight(filter);return Promise.resolve();},
  setQueryData:(key,value)=>{
    // Preserve QueryClient's functional-updater contract. Homepage editors
    // pass previous => ({...previous,blocks:savedRows}); storing that callback
    // as the data instead of evaluating it blanks every public Home Block.
    const serializedKey=serialize(key);
    const previous=dataStore.get(serializedKey);
    const next=typeof value==='function'?value(previous):value;
    if(next===undefined)return previous;
    retainIfObserved(serializedKey,next);
    forEachMatch({queryKey:keyOf(key),exact:true},entry=>entry.setData(next));
    return next;
  },
  getQueryData:key=>dataStore.get(serialize(key)),
  removeQueries:(filter={})=>{
    forEachMatch(filter,entry=>entry.remove());
    for(const storedKey of [...dataStore.keys()]){
      const parsed=JSON.parse(storedKey);
      if(typeof filter.predicate==='function'){
        if(filter.predicate({queryKey:parsed}))dataStore.delete(storedKey);
      }else if(filter.exact){
        if(storedKey===serialize(filter.queryKey))dataStore.delete(storedKey);
      }else if(prefixMatch(parsed,filter.queryKey??[])){
        dataStore.delete(storedKey);
      }
    }
    return Promise.resolve();
  },
  fetchQuery:async({queryKey,queryFn})=>{
    const serializedKey=serialize(queryKey);
    const generation=resourceEpoch;
    const value=await runFetch(serializedKey,()=>queryFn());
    // A previous page must never refill the store after management entry.
    if(generation===resourceEpoch)retainIfObserved(serializedKey,value);
    return value;
  }
};

// All LOC components share the same native client directly; no redundant
// TanStack-style provider, React context, or client-side query cache.
export function useQueryClient(){return queryClient;}

export function createResourceCache(client){
  return {
    invalidate:async({queryKey})=>{
      await client.cancelQueries({queryKey:keyOf(queryKey)});
      return client.invalidateQueries({queryKey:keyOf(queryKey)});
    },
    revalidate:({queryKey})=>client.invalidateQueries({queryKey:keyOf(queryKey)}),
    getOrLoad:({queryKey,queryFn})=>client.fetchQuery({queryKey:keyOf(queryKey),queryFn}),
    set:(key,value)=>client.setQueryData(keyOf(key),value),
    get:key=>client.getQueryData(keyOf(key)),
    clear:async({queryKey})=>{
      await client.cancelQueries({queryKey:keyOf(queryKey)});
      client.removeQueries({queryKey:keyOf(queryKey)});
    }
  };
}

export function useResourceCache(){
  const client=useQueryClient();
  return useMemo(()=>createResourceCache(client),[client]);
}
