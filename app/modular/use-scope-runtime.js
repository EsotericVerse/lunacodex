'use client';

import {useEffect,useMemo,useState} from 'react';
import {usePathname} from 'next/navigation';
import {featureIdForPath,getScope,isKnownScope,normalizeScopeId,resolveScope} from './scope-registry';
import {selectScopeRegistryEntry} from '../loc/scope-data';
import {useAppBootstrap} from '../loc/app-bootstrap';

const registryCache=new Map();

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

  const genericId=useMemo(()=>genericRouteScope(pathname,location.search),[pathname,location.search]);
  const scopeId=genericId||(genericShell?'':resolveScope(location.host,pathname));
  const dynamic=Boolean(genericShell&&(!genericId||!isKnownScope(genericId)));
  const cached=scopeId?registryCache.get(scopeId):null;
  const [registryRow,setRegistryRow]=useState(cached||null);
  const [registryResolved,setRegistryResolved]=useState(!dynamic||(Boolean(scopeId)&&registryCache.has(scopeId)));
  const [registryError,setRegistryError]=useState('');
  const [metadataRevision,setMetadataRevision]=useState(0);
  useEffect(()=>{
    const refresh=()=>{
      registryCache.clear();
      setMetadataRevision(current=>current+1);
    };
    window.addEventListener('loc-public-scope-metadata-changed',refresh);
    return()=>window.removeEventListener('loc-public-scope-metadata-changed',refresh);
  },[]);

  useEffect(()=>{
    let active=true;
    // Every Scope, including built-ins, reads the canonical Registry display_name.
    if(!location.mounted){
      if(dynamic)setRegistryResolved(false);
      return()=>{active=false};
    }
    if(!scopeId){
      setRegistryRow(null);setRegistryResolved(true);setRegistryError('缺少 Scope ID。');
      return()=>{active=false};
    }
    if(scopeId==='local'){
      // Device-local Scope is not registered or authorized through the cloud.
      setRegistryRow(null);setRegistryResolved(true);setRegistryError('');
      return()=>{active=false};
    }
    if(registryCache.has(scopeId)){
      setRegistryRow(registryCache.get(scopeId));setRegistryResolved(true);setRegistryError('');
      return()=>{active=false};
    }
    setRegistryRow(null);
    setRegistryResolved(!dynamic);
    setRegistryError('');
    selectScopeRegistryEntry(scopeId).then(row=>{
      if(!active)return;
      registryCache.set(scopeId,row||null);
      setRegistryRow(row||null);setRegistryResolved(true);
    }).catch(error=>{
      if(!active)return;
      setRegistryRow(null);setRegistryResolved(true);setRegistryError(String(error?.message||error||'Scope Registry 讀取失敗'));
    });
    return()=>{active=false};
  },[dynamic,scopeId,location.mounted,metadataRevision]);

  const activeRegistryRow=registryRow?.scope_id===scopeId?registryRow:null;
  const base=getScope(scopeId);
  const configEnabled=Boolean(
    scopeId&&scopeId!=='admin'&&!base.aggregateChildren&&(!dynamic||activeRegistryRow?.scope_kind==='scope')
  );
  // Scope config already belongs to the page's shared bootstrap. Consume the
  // same ZenStack query key as AppShell, ThemeSelect and ScopeEditableBlocks;
  // do not maintain a second cache/effect or a second config SELECT.
  const bootstrap=useAppBootstrap(scopeId,featureIdForPath(pathname)||'index');
  const activeConfigRow=configEnabled&&bootstrap.data?.config?.id===scopeId
    ?bootstrap.data.config:null;
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
    searchAliases:Array.isArray(activeConfigRow.search_aliases)?activeConfigRow.search_aliases:structural.searchAliases,
    searchIntro:String(activeConfigRow.search_intro||'').trim(),
    config:activeConfigRow
  }:structural;

  return {
    scopeId,scope,
    host:location.host,pathname,
    dynamic,registryRow:activeRegistryRow,registryResolved,registryError,
    configRow:activeConfigRow
  };
}
