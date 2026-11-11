'use client';

import {useMemo} from 'react';
import {useQuery,useInfiniteQuery,useQueryClient,skipToken} from '@tanstack/react-query';
import {flashMessage} from '../app/loc/flash-message';

// ZenStack V3 frontend resource layer. One QueryClient uses the trusted
// ZenStack/Kysely SQL Gateway. No parallel browser cache or background polling.
const keyOf=key=>Array.isArray(key)?key:[key];
const defaults={
  staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false,
  refetchOnReconnect:false,refetchInterval:false,retry:false
};

export function useAsyncResource(keyOrOptions,fetcherArg,optionsArg={}){
  const legacy=keyOrOptions&&typeof keyOrOptions==='object'&&!Array.isArray(keyOrOptions);
  const key=legacy?keyOrOptions.queryKey:keyOrOptions;
  const fetcher=legacy?keyOrOptions.queryFn:fetcherArg;
  const options=legacy?keyOrOptions:optionsArg;
  const {
    enabled=true,queryKey:unusedKey,queryFn:unusedFn,fallbackData,
    revalidateOnFocus,revalidateOnReconnect,revalidateIfStale,
    onError,...rest
  }=options;
  const queryKey=keyOf(key);
  const client=useQueryClient();
  const query=useQuery({
    ...rest,...defaults,queryKey,
    enabled:Boolean(enabled)&&typeof fetcher==='function',
    queryFn:typeof fetcher==='function'?async()=>{
      try{return await fetcher();}
      catch(error){
        flashMessage('資料讀取失敗，請稍後再試');
        onError?.(error,queryKey);
        throw error;
      }
    }:skipToken,
    ...(fallbackData!==undefined?{placeholderData:fallbackData}:{})
  });
  return {
    ...query,isPending:query.isLoading,isFetching:query.isFetching,
    isSuccess:query.isSuccess,isError:query.isError,
    refetch:async()=>{
      const result=await query.refetch();
      if(result.error)throw result.error;
      return result.data;
    },
    // Only the existing local-record writer needs this per-resource setter.
    // It writes into the same native QueryClient, never a parallel cache.
    mutate:async(...args)=>{
      if(!args.length){
        const result=await query.refetch();
        if(result.error)throw result.error;
        return result.data;
      }
      const [value,config={}]=args;
      if(value===undefined)client.removeQueries({queryKey,exact:true});
      else client.setQueryData(queryKey,value);
      if(config.revalidate!==false)await client.invalidateQueries({queryKey,exact:true,refetchType:'none'});
      return client.getQueryData(queryKey);
    }
  };
}

export function useAsyncInfiniteResource({
  queryKey,queryFn,enabled=true,initialPageParam=null,getNextPageParam
}){
  const query=useInfiniteQuery({
    ...defaults,queryKey:keyOf(queryKey),enabled:Boolean(enabled),
    initialPageParam,
    queryFn:({pageParam,signal})=>queryFn({pageParam,signal}),
    // A valid zero cursor must continue; only null/undefined end paging.
    getNextPageParam:lastPage=>getNextPageParam?.(lastPage)??undefined
  });
  return {
    ...query,isPending:query.isLoading,isFetching:query.isFetching,
    isFetchingNextPage:query.isFetchingNextPage,
    isSuccess:query.isSuccess,isError:query.isError,
    hasNextPage:Boolean(query.hasNextPage),
    fetchNextPage:()=>query.fetchNextPage(),
    refetch:async()=>{
      const result=await query.refetch();
      if(result.error)throw result.error;
      return result.data;
    }
  };
}

// LOC aggregate consumers use different UI query keys. A committed import
// invalidates only affected Scope records in the existing QueryClient;
// page-size/cursor settings and other Scopes remain untouched.
const SCOPE_DATA_QUERY_PREFIXES=new Set([
  'scope-overview','scope-others-source-summary','statistics-source-articles',
  'statistics-source-article-body','statistics-keyword-class',
  'culture-timeline','loc-culture-density','culture-source-classification',
  'culture-period-roots','culture-period-source-snapshot','culture-style-filter',
  'culture-keyword-attributes','culture-keyword-group-catalog',
  'culture-article-list','scope-search-summary'
]);
const matchesScopeDataQuery=(query,id)=>{
  const key=query.queryKey;
  return Array.isArray(key)&&SCOPE_DATA_QUERY_PREFIXES.has(key[0])&&
    key.slice(1).some(part=>part===id);
};

// All cross-feature invalidation, deduplication, cancellation, stale writes
// and paginated results are handled by the native QueryClient.
export async function invalidateScopeQueryCache(client,scopeId){
  const id=String(scopeId||'');
  if(!id)return;
  const predicate=query=>matchesScopeDataQuery(query,id);
  await client.cancelQueries({predicate});
  return client.invalidateQueries({predicate,refetchType:'none'});
}

export function createResourceCache(client){
  return {
    invalidateScope:({scopeId})=>invalidateScopeQueryCache(client,scopeId),
    invalidate:async({queryKey})=>{
      await client.cancelQueries({queryKey:keyOf(queryKey)});
      return client.invalidateQueries({queryKey:keyOf(queryKey),refetchType:'none'});
    },
    revalidate:({queryKey})=>client.invalidateQueries({queryKey:keyOf(queryKey),refetchType:'none'}),
    getOrLoad:({queryKey,queryFn})=>client.fetchQuery({
      queryKey:keyOf(queryKey),queryFn,staleTime:Infinity
    }),
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
