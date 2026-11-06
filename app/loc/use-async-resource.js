'use client';

import useSWR,{useSWRConfig,unstable_serialize} from 'swr';
import useSWRInfinite,{unstable_serialize as serializeInfinite} from 'swr/infinite';
import {useEffect,useMemo} from 'react';
import {flashMessage} from './flash-message';

// LOC reads are client-triggered resources: SWR owns request deduplication and
// the browser-session cache; these hooks expose a small shared status contract.
const infiniteResourceKeys=new WeakMap();
function infiniteKeysFor(cache){
  let keys=infiniteResourceKeys.get(cache);
  if(!keys){keys=new Map();infiniteResourceKeys.set(cache,keys);}
  return keys;
}
// Share in-flight work within the same SWR provider; completed requests are not retained.
const inFlightByCache=new WeakMap();
function pendingReads(cache){
  let reads=inFlightByCache.get(cache);
  if(!reads){reads=new Map();inFlightByCache.set(cache,reads);}
  return reads;
}
export function useAsyncResource(keyOrOptions,fetcherArg,optionsArg={}){
  const legacy=keyOrOptions&&typeof keyOrOptions==='object'&&!Array.isArray(keyOrOptions);
  const key=legacy?keyOrOptions.queryKey:keyOrOptions;
  const fetcher=legacy?keyOrOptions.queryFn:fetcherArg;
  const options=legacy?keyOrOptions:optionsArg;
  const {enabled=true,queryKey,queryFn,...swrOptions}=options;
  const {onError:userOnError,...rest}=swrOptions;
  const resource=useSWR(enabled?key:null,fetcher,{...rest,onError:(error,k,config)=>{
    flashMessage('資料讀取失敗，請稍後再試');
    userOnError?.(error,k,config);
  }});
  return {
    ...resource,
    isPending:resource.isLoading,
    isFetching:resource.isValidating,
    isSuccess:resource.data!==undefined&&!resource.error,
    isError:Boolean(resource.error),
    refetch:()=>resource.mutate()
  };
}

export function useAsyncInfiniteResource({queryKey,queryFn,enabled=true,initialPageParam=null,getNextPageParam}){
  const {cache}=useSWRConfig();
  const getPageKey=(pageIndex,previousPage)=>{
    if(!enabled)return null;
    const pageParam=pageIndex===0?initialPageParam:getNextPageParam?.(previousPage);
    // SWR Infinite uses null to end pagination; accept both null and undefined.
    if(pageIndex>0&&pageParam==null)return null;
    return [...queryKey,{__locPage:true,index:pageIndex,param:pageParam}];
  };
  const serializedKey=serializeInfinite(getPageKey);
  useEffect(()=>{
    if(!enabled)return undefined;
    const keys=infiniteKeysFor(cache);
    const current=keys.get(serializedKey);
    if(current)current.refs+=1;
    else keys.set(serializedKey,{queryKey,refs:1});
    return ()=>{
      const entry=keys.get(serializedKey);
      if(!entry)return;
      if(entry.refs===1)keys.delete(serializedKey);
      else entry.refs-=1;
    };
  },[cache,enabled,serializedKey]);
  const resource=useSWRInfinite(getPageKey,key=>queryFn({pageParam:key.at(-1).param}),{
    persistSize:false,
    revalidateFirstPage:false,
    revalidateAll:false,
    // Keep rendered pages stable while users scroll; explicit refetch remains available.
    revalidateOnFocus:false,
    revalidateOnReconnect:false
  });
  const pages=resource.data||[];
  const lastPage=pages.at(-1);
  return {
    ...resource,
    data:resource.data?{pages}:undefined,
    error:resource.error,
    isPending:resource.isLoading,
    isFetching:resource.isValidating,
    isFetchingNextPage:resource.isValidating&&resource.size>pages.length,
    isSuccess:resource.data!==undefined&&!resource.error,
    isError:Boolean(resource.error),
    hasNextPage:Boolean(lastPage&&getNextPageParam?.(lastPage)!=null),
    fetchNextPage:()=>resource.setSize(size=>size+1),
    refetch:()=>resource.mutate()
  };
}

function keyStartsWith(key,prefix){
  if(!Array.isArray(key)||!Array.isArray(prefix))return unstable_serialize(key)===unstable_serialize(prefix);
  return prefix.every((part,index)=>unstable_serialize(key[index])===unstable_serialize(part));
}

// Explicit resource controls for successful writes. SWR remains the only cache;
// no timer or background refetch is introduced here.
export function useResourceCache(){
  const {mutate,cache}=useSWRConfig();
  const inFlight=useMemo(()=>pendingReads(cache),[cache]);
  return useMemo(()=>{
    // A write or invalidation supersedes pending loads for matching keys.
    // A late old response must never overwrite newly saved or refetched data.
    const supersedePending=queryKey=>{
      for(const [cacheKey,entry] of inFlight){
        if(keyStartsWith(entry.queryKey,queryKey))inFlight.delete(cacheKey);
      }
    };
    const matchingInfiniteKeys=queryKey=>[...infiniteKeysFor(cache)]
      .filter(([,entry])=>keyStartsWith(entry.queryKey,queryKey))
      .map(([serializedKey])=>serializedKey);
    const clearMatchingPages=(queryKey,revalidate)=>{
      const pageKeys=[...cache.keys()].filter(key=>{
        if(key.startsWith('$inf$'))return false;
        return keyStartsWith(cache.get(key)?._k,queryKey);
      });
      return Promise.all(pageKeys.map(key=>{
        const pageKey=cache.get(key)?._k;
        return pageKey?mutate(pageKey,()=>undefined,{populateCache:true,revalidate,throwOnError:false}):undefined;
      }));
    };
    return {
      // Clear regular and paginated values so the next visit fetches fresh data;
      // mounted consumers revalidate now through SWR.
      invalidate:async({queryKey})=>{
        supersedePending(queryKey);
        const regular=mutate(key=>keyStartsWith(key,queryKey),()=>undefined,{populateCache:true,revalidate:true,throwOnError:false});
        const pages=clearMatchingPages(queryKey,false);
        const infinite=matchingInfiniteKeys(queryKey).map(key=>mutate(key,undefined,{revalidate:true,throwOnError:false}));
        await Promise.all([regular,pages,...infinite]);
      },
      revalidate:({queryKey})=>{
        supersedePending(queryKey);
        return mutate(key=>keyStartsWith(key,queryKey));
      },
      getOrLoad:({queryKey,queryFn})=>{
        const cached=cache.get(unstable_serialize(queryKey))?.data;
        if(cached!==undefined)return Promise.resolve(cached);
        const cacheKey=unstable_serialize(queryKey);
        const previous=inFlight.get(cacheKey);
        if(previous)return previous.promise;
        const entry={queryKey,promise:null};
        const request=Promise.resolve().then(queryFn).then(
          value=>inFlight.get(cacheKey)===entry
            ?mutate(queryKey,value,{revalidate:false}):value,
          error=>{throw error}
        ).finally(()=>{
          if(inFlight.get(cacheKey)===entry)inFlight.delete(cacheKey);
        });
        entry.promise=request;
        inFlight.set(cacheKey,entry);
        return request;
      },
      set:(key,value)=>{
        supersedePending(key);
        return mutate(key,typeof value==='function'?value:()=>value,{revalidate:false});
      },
      get:key=>cache.get(unstable_serialize(key))?.data,
      clear:async({queryKey})=>{
        supersedePending(queryKey);
        const regular=mutate(key=>keyStartsWith(key,queryKey),()=>undefined,{populateCache:true,revalidate:false,throwOnError:false});
        const pages=clearMatchingPages(queryKey,false);
        const infinite=matchingInfiniteKeys(queryKey).map(key=>mutate(key,undefined,{revalidate:false,throwOnError:false}));
        await Promise.all([regular,pages,...infinite]);
      }
    };
  },[mutate,cache,inFlight]);
}
