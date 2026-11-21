'use client';

import {useEffect,useMemo,useState} from 'react';
import {usePathname} from './runtime/navigation';
import {getScope,isKnownScope,normalizeScopeId,resolveScope,rememberCurrentBrowserRoute} from './routing/scope-registry';
import {PUBLISHED_SITE_BOOTSTRAP} from './published-site-bootstrap.js';
import {SCOPE_ROUTE_INDEX} from './routing/scope-route-index.js';

// Routing and the public Scope configuration are immutable release metadata.
// They never require a page Bootstrap, SQL lookup, React fetch effect or TTL.
const registryByScope=new Map((PUBLISHED_SITE_BOOTSTRAP.registry||[])
  .filter(row=>row.active!==false).map(row=>[row.scope_id,row]));
const configByScope=new Map(SCOPE_ROUTE_INDEX
  .filter(row=>row.active!==false).map(row=>[row.scope_id,row.config||null]));

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

  // The route's display data is selected synchronously from the published file.
  // No component can accidentally trigger an HTTP / SQL read merely to
  // determine which Scope it is rendering.
  const activeRegistryRow=registryByScope.get(scopeId)||null;
  const base=getScope(scopeId);
  const configEnabled=Boolean(scopeId&&scopeId!=='admin'&&
    !base.aggregateChildren&&(!dynamic||activeRegistryRow?.scope_kind==='scope'));
  const publishedConfig=configByScope.get(scopeId);
  const activeConfigRow=configEnabled&&publishedConfig?.id===scopeId
    ?publishedConfig:null;
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
    configRow:activeConfigRow
  };
}
