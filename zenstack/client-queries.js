'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {flashMessage} from '../app/loc/flash-message';

// Only React subscriptions and an event-invalidated resource map.
// ZModel/Kysely executes the supplied readers; this file never polls, retries,
// expires cached data on a timer or initiates network work for invalidation.
const keyOf=key=>Array.isArray(key)?key:[key];
const idOf=key=>JSON.stringify(keyOf(key));
const Context=createContext(null);
export class LocResourceStore {
  constructor(){this.rows=new Map();this.subs=new Map();}
  getRow(key){return this.rows.get(idOf(key));}
  getQueryData(key){return this.getRow(key)?.data;}
  on(key,fn){const id=idOf(key),set=this.subs.get(id)||new Set();set.add(fn);this.subs.set(id,set);return ()=>{set.delete(fn);if(!set.size)this.subs.delete(id);};}
  notify(key){for(const fn of this.subs.get(idOf(key))||[])fn(this.getRow(key));}
  update(key,change){const id=idOf(key);const row={queryKey:keyOf(key),status:'idle',data:undefined,error:null,invalidated:false,...this.rows.get(id),...change};this.rows.set(id,row);this.notify(key);return row;}
  setQueryData(key,value){const data=typeof value==='function'?value(this.getQueryData(key)):value;this.update(key,{data,status:'success',error:null,invalidated:false});return data;}
  async fetchQuery({queryKey,queryFn,force=false}){
    const old=this.getRow(queryKey);
    if(old?.promise)return old.promise;
    if(!force&&old?.status==='success'&&!old.invalidated)return old.data;
    const promise=Promise.resolve().then(queryFn);
    this.update(queryKey,{status:'pending',error:null,promise});
    try{const data=await promise;this.update(queryKey,{data,status:'success',error:null,promise:null});return data;}
    catch(error){this.update(queryKey,{error,status:'error',promise:null});throw error;}
  }
  select({queryKey,predicate,exact=false}={}){
    const rows=[...this.rows.values()];
    if(predicate)return rows.filter(row=>predicate({queryKey:row.queryKey}));
    if(queryKey===undefined)return rows;
    const prefix=keyOf(queryKey);
    return rows.filter(row=>exact?idOf(row.queryKey)===idOf(queryKey):
      prefix.every((part,i)=>JSON.stringify(part)===JSON.stringify(row.queryKey[i])));
  }
  invalidateQueries(options={}){for(const row of this.select(options))this.update(row.queryKey,{invalidated:true});return Promise.resolve();}
  cancelQueries(){return Promise.resolve();}
  removeQueries(options={}){for(const row of this.select(options)){this.rows.delete(idOf(row.queryKey));this.notify(row.queryKey);}}
}
export function LocResourceProvider({children}){
  const [client]=useState(()=>new LocResourceStore());
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useLocResourceStore(){const client=useContext(Context);if(!client)throw Error('LOC resource provider missing');return client;}
export const useQueryClient=useLocResourceStore;

export function useAsyncResource(keyOrOptions,fetcherArg,optionsArg={}){
  const legacy=keyOrOptions&&typeof keyOrOptions==='object'&&!Array.isArray(keyOrOptions);
  const key=legacy?keyOrOptions.queryKey:keyOrOptions;
  const fn=legacy?keyOrOptions.queryFn:fetcherArg;
  const options=legacy?keyOrOptions:optionsArg;
  const client=useLocResourceStore();
  const id=key===null||key===undefined?'__disabled__':idOf(key);
  const stableKey=useMemo(()=>key===null||key===undefined?null:keyOf(key),[id]);
  const fnRef=useRef(fn);fnRef.current=fn;
  const [row,setRow]=useState(()=>stableKey?client.getRow(stableKey):null);
  const enabled=options.enabled!==false&&Boolean(stableKey)&&typeof fn==='function';
  useEffect(()=>{
    if(!stableKey){setRow(null);return;}
    setRow(client.getRow(stableKey)||null);
    const unsubscribe=client.on(stableKey,setRow);
    if(enabled&&!client.getRow(stableKey))void client.fetchQuery({
      queryKey:stableKey,queryFn:()=>fnRef.current()
    }).catch(error=>{flashMessage('資料讀取失敗，請稍後再試');options.onError?.(error,stableKey);});
    return unsubscribe;
  },[client,id,enabled]);
  const refetch=useCallback(()=>client.fetchQuery({queryKey:stableKey,queryFn:()=>fnRef.current(),force:true}),[client,id]);
  const status=row?.status||'idle';
  const data=row?.data??options.fallbackData??options.placeholderData;
  return {data,error:row?.error||null,isPending:enabled&&(status==='idle'||status==='pending'),
    isLoading:enabled&&(status==='idle'||status==='pending'),isFetching:status==='pending',
    isSuccess:status==='success',isError:status==='error',refetch,
    mutate:async(...args)=>{
      if(!args.length)return refetch();
      const [value,config={}]=args;
      if(value===undefined)client.removeQueries({queryKey:stableKey,exact:true});
      else client.setQueryData(stableKey,value);
      if(config.revalidate!==false)await client.invalidateQueries({queryKey:stableKey,exact:true});
      return client.getQueryData(stableKey);
    }};
}
export function useAsyncInfiniteResource({queryKey,queryFn,enabled=true,initialPageParam=null,getNextPageParam}){
  const client=useLocResourceStore();
  const id=idOf(queryKey),key=useMemo(()=>keyOf(queryKey),[id]);
  const fnRef=useRef(queryFn);fnRef.current=queryFn;
  const nextRef=useRef(getNextPageParam);nextRef.current=getNextPageParam;
  const result=useAsyncResource(key,async()=>({pages:[await fnRef.current({pageParam:initialPageParam,signal:undefined})],pageParams:[initialPageParam]}),{enabled});
  const [isFetchingNextPage,setNext]=useState(false);
  const pages=result.data?.pages||[];
  const next=pages.length?nextRef.current?.(pages[pages.length-1]):undefined;
  const hasNextPage=next!==undefined&&next!==null;
  const fetchNextPage=async()=>{
    if(!enabled||!hasNextPage||isFetchingNextPage)return;
    setNext(true);
    try{
      const page=await fnRef.current({pageParam:next,signal:undefined});
      const current=client.getQueryData(key)||{pages:[],pageParams:[]};
      client.setQueryData(key,{pages:[...current.pages,page],pageParams:[...current.pageParams,next]});
      return page;
    }finally{setNext(false);}
  };
  return {...result,isFetchingNextPage,hasNextPage,fetchNextPage};
}
const PREFIXES=new Set(['scope-overview','scope-others-source-summary','statistics-source-articles',
'statistics-source-article-body','statistics-keyword-class','culture-timeline','loc-culture-density',
'culture-source-classification','culture-period-roots','culture-period-source-snapshot',
'culture-style-filter','culture-keyword-attributes','culture-keyword-group-catalog',
'culture-article-list','scope-search-summary']);
export function invalidateScopeQueryCache(client,scopeId){
  const id=String(scopeId||'');if(!id)return Promise.resolve();
  return client.invalidateQueries({predicate:row=>Array.isArray(row.queryKey)&&PREFIXES.has(row.queryKey[0])
    &&row.queryKey.slice(1).includes(id)});
}
export function createResourceCache(client){return {
  invalidateScope:({scopeId})=>invalidateScopeQueryCache(client,scopeId),
  invalidate:({queryKey})=>client.invalidateQueries({queryKey,exact:true}),
  revalidate:({queryKey})=>client.invalidateQueries({queryKey,exact:true}),
  getOrLoad:({queryKey,queryFn})=>client.fetchQuery({queryKey,queryFn}),
  set:(key,value)=>client.setQueryData(key,value),get:key=>client.getQueryData(key),
  clear:({queryKey})=>client.removeQueries({queryKey,exact:true})
};}
export function useResourceCache(){const client=useLocResourceStore();return useMemo(()=>createResourceCache(client),[client]);}
