'use client';

import {CACHE_POLICY} from './cache-policy.config.mjs';
import {applyRuntimeIoLimits} from './query-batch-size.mjs';

export const CACHE_POLICY_EVENT='loc-cache-policy-changed';
const DEFAULT_POLICY=Object.freeze({mode:'off',origin:''});
const PUBLIC_ORIGIN=/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
let policy=DEFAULT_POLICY;
const SESSION_POLICY_KEY='loc-public-cache-policy-v1';
let policyRequest=null;
// Public, nonsecret settings: a full document navigation must not SELECT
// silver.loc again merely to reconfigure the Service Worker.
const publicFields=row=>({
  cache_mode:row?.cache_mode,
  cache_provider:row?.cache_provider,
  isr_domains:Array.isArray(row?.isr_domains)?row.isr_domains:[],
  io_limits:row?.io_limits||null
});
function readSessionPolicy(){
  try{
    if(typeof window==='undefined')return null;
    const saved=JSON.parse(window.sessionStorage.getItem(SESSION_POLICY_KEY)||'null');
    return saved&&['off','cache','isr'].includes(saved.cache_mode)?saved:null;
  }catch{return null;}
}
function rememberSessionPolicy(record){
  try{
    if(typeof window!=='undefined')
      window.sessionStorage.setItem(SESSION_POLICY_KEY,JSON.stringify(publicFields(record)));
  }catch{}
}

export function normalizeCachePolicy(record){
  const mode=['off','cache','isr'].includes(record?.mode)?record.mode:'off';
  const origin=String(record?.origin||'').trim();
  return {mode:mode==='isr'&&(!origin||!PUBLIC_ORIGIN.test(origin))?'cache':mode,
    origin:PUBLIC_ORIGIN.test(origin)?origin:''};
}

export function currentCachePolicy(){return policy;}
export function applyCachePolicy(next){
  policy=normalizeCachePolicy(next);
  if(typeof window!=='undefined')
    window.dispatchEvent(new CustomEvent(CACHE_POLICY_EVENT,{detail:policy}));
  return policy;
}

// Old rows may still store a legacy provider ID. New rows store the selected origin.
export function selectedIsrOrigin(record){
  const rows=Array.isArray(record?.isr_domains)?record.isr_domains:CACHE_POLICY.domains;
  const chosen=rows.find(row=>row.origin&&
    (row.origin===record?.cache_provider||row.id===record?.cache_provider));
  return chosen?.origin||'';
}
export function applyGlobalCacheConfig(record){
  if(record?.io_limits)applyRuntimeIoLimits(record.io_limits);
  const next=applyCachePolicy({
    mode:record?.cache_mode||CACHE_POLICY.mode,
    origin:selectedIsrOrigin(record)
  });
  rememberSessionPolicy(record);
  return next;
}
export function loadCachePolicy(){
  if(policyRequest)return policyRequest;
  // api.manage is a private control-plane relation, not an anonymous
  // PostgREST table. Public startup must not issue its guaranteed-failing
  // SELECT (HTTP 406). Use the same already-published fallback that was
  // previously reached after that failed request.
  policyRequest=Promise.resolve().then(()=>applyGlobalCacheConfig(
    readSessionPolicy()||{cache_mode:CACHE_POLICY.mode,isr_domains:[]}
  ));
  return policyRequest;
}
