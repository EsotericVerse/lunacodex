'use client';

import {useEffect,useMemo,useState} from 'react';
import {usePathname} from 'next/navigation';
import {getScope,isKnownScope,normalizeScopeId,resolveScope,rememberCurrentBrowserRoute} from './routing/scope-registry';
import {PUBLISHED_SITE_BOOTSTRAP} from './published-site-bootstrap.js';
import {selectScopeConfig} from '../loc/scope/scope-data.js';
import {useAsyncResource} from '../../packages/zenstack/client-queries';

// Scope identity and routing follow the published permission registry.
const registryByScope=new Map((PUBLISHED_SITE_BOOTSTRAP.registry||[])
  .filter(row=>row.active!==false).map(row=>[row.scope_id,row]));

function genericRouteScope(pathname,search){
  const path=String(pathname||'/');
  if(!(path==='/scope-shell'||path.startsWith('/scope-shell/')))return '';
  const params=new URLSearchParams(String(search||'').replace(/^\?/,''));
  return normalizeScopeId(params.get('scopeid'));
}

export function useScopeRuntime(){
  const pathname=usePathname()||'/';
  const genericShell=pathname==='/scope-shell'||pathname.startsWith('/scope-shell/');
  const [location,setLocation]=useState({host:'',search:'',mounted:false});

  useEffect(()=>{
    const sync=()=>setLocation({
      host:window.location.hostname,
      search:window.location.search,
      mounted:true
    });
    sync();
    window.addEventListener('popstate',sync);
    return()=>window.removeEventListener('popstate',sync);
  },[]);

  const genericId=useMemo(()=>genericRouteScope(pathname,location.search),
    [pathname,location.search]);
  const scopeId=genericId||(genericShell?'':resolveScope(location.host,pathname));
  const dynamic=Boolean(genericShell&&(!genericId||!isKnownScope(genericId)));
  useEffect(()=>{
    if(!location.mounted||!scopeId)return;
    rememberCurrentBrowserRoute(window.sessionStorage,scopeId,pathname);
  },[location.mounted,scopeId,pathname]);

  const activeRegistryRow=registryByScope.get(scopeId)||null;
  const base=getScope(scopeId);
  const configEnabled=Boolean(location.mounted&&scopeId&&scopeId!=='admin'&&scopeId!=='local'&&
    !base.aggregateChildren&&(!dynamic||activeRegistryRow?.scope_kind==='scope'));
  const configQuery=useAsyncResource(['scope-config',scopeId],
    ()=>selectScopeConfig(scopeId),{enabled:configEnabled});
  const activeConfigRow=configEnabled&&configQuery.data?.id===scopeId
    ?configQuery.data:null;
  const structural=activeRegistryRow?{
    ...base,
    label:activeRegistryRow.display_name||scopeId,
    searchTitle:activeRegistryRow.display_name||scopeId,
    aggregateChildren:activeRegistryRow.scope_kind==='group',
    registry:activeRegistryRow
  }:base;
  const scope=activeConfigRow?{
    ...structural,
    label:String(activeConfigRow.display_name||structural.label||scopeId).trim(),
    searchTitle:String(activeConfigRow.display_name||structural.searchTitle||structural.label||scopeId).trim(),
    searchAliases:Array.isArray(activeConfigRow.search_aliases)
      ?activeConfigRow.search_aliases:structural.searchAliases,
    searchIntro:String(activeConfigRow.search_intro||'').trim(),
    config:activeConfigRow
  }:structural;

  return {
    scopeId,scope,
    host:location.host,pathname,search:location.search,locationMounted:location.mounted,
    dynamic,registryRow:activeRegistryRow,
    registryResolved:location.mounted||!dynamic,
    registryError:dynamic&&location.mounted&&!activeRegistryRow?'Scope Registry 未發布此 Scope。':'',
    configRow:activeConfigRow,configLoading:configEnabled&&configQuery.isPending,
    configError:configEnabled&&configQuery.isError?configQuery.error:null
  };
}
