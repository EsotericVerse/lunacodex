'use client';

import {DB_QUERY_BATCH_SIZE,queryBatchSize} from './db-contract.mjs';
import {MAX_ROWS} from '../query/query-batch-size.mjs';
import {coalescePendingPublicRead} from '../query/inflight-public-read.mjs';
import {mapBounded} from '../query/bounded-parallel.mjs';
import {SQL_WORKLOAD_POLICY} from '../../../modules/loc/dialect/sql-workload-policy.mjs';
import {transientReadSignal,transientReadGeneration} from '../../../packages/zenstack/transient-read-epoch.mjs';
import {getOrLoadScopedRead} from '../../../packages/zenstack/scoped-read-cache.mjs';
export {DB_QUERY_BATCH_SIZE,queryBatchSize} from './db-contract.mjs';

// Native Kysely SELECT has no Supabase Data API Max Rows ceiling.
// Full-result readers use internal transport pages without truncating SQL totals.

import {dbAuthClient,dbBackupPublicClient,dbConfiguredPublicClient,dbPublicClient} from './db-client.mjs';
import {isDatabaseConnectivityFailure,markPrimaryReadFailed,markPrimaryReadSucceeded,markBackupReadFailed,markBackupReadSucceeded} from '../providers/db-source-status.mjs';

import {selectedDatabaseRouting} from '../providers/routing/state.mjs';
const recoverableReadError=error=>{
  const code=String(error?.code||'');
  const status=Number(error?.status||error?.cause?.status||0);
  // Search QoS responses are intentional, not a failed primary connection.
  // Never trigger another full-text query against backup on 429/408.
  if(code==='SEARCH_RATE_LIMIT'||code==='SEARCH_TIMEOUT')return false;
  if(status===429||status>=500)return true;
  if(error?.name==='TimeoutError'||error?.cause?.name==='TimeoutError')return true;
  if(code.startsWith('08')||code==='53300')return true;
  return status===0&&(error instanceof TypeError||/network|fetch failed|timeout|timed out|connection|unavailable/i.test(String(error?.message||'')));
};

// A cancelled search must stop the actual HTTP request, not just ignore its result.
// Cancellation is never a database failure: it must not mark the primary source
// as degraded and must never trigger the backup-database fallback.
const abortError=()=>{const error=new Error('Request cancelled');error.name='AbortError';return error;};
export const isAbortError=error=>error?.name==='AbortError'||error?.cause?.name==='AbortError';
const withSignal=(query,signal)=>signal&&typeof query?.abortSignal==='function'?query.abortSignal(signal):query;
const withExpectedDatabase=(query,dbId)=>{
  if(!dbId)return query;
  if(typeof query?.expectDatabase!=='function')throw new Error('SQL transport cannot verify article database identity');
  return query.expectDatabase(dbId);
};

// Request-size budget: IN-lists are expanded into one SQL/URL parameter per value,
// so request size grows linearly with the list. Surface the offending table once
// instead of silently sending a multi-thousand-character statement.
export const IN_FILTER_BUDGET=200;
const oversizedWarned=new Set();
function warnOversizedFilters(table,filters){
  for(const filter of filters||[]){
    if(filter?.operator==='in'&&Array.isArray(filter.value)&&filter.value.length>IN_FILTER_BUDGET){
      const key=table+'.'+filter.column;
      if(oversizedWarned.has(key))continue;
      oversizedWarned.add(key);
      console.warn('[db-query] IN filter on '+key+' has '+filter.value.length+' values (budget '+IN_FILTER_BUDGET+'); request size grows linearly. Page the ids or use a DB-side join/RPC.');
    }
  }
}

function publicRelation(client,table){
  const [schema,name]=String(table).split('.');
  return client.schema(schema).from(name);
}
export function dbPublicRelation(table){
  return publicRelation(dbPublicClient,table);
}
function resultError(result,table,source){
  if(!result?.error&&!(Number(result?.status)>=400))return null;
  const cause=result?.error||null;
  const error=new Error(cause?.message||('DB SELECT '+table+' failed on '+source+(result?.status?' HTTP '+result.status:'')));
  if(cause?.code)error.code=cause.code;
  if(cause?.details)error.details=cause.details;
  if(cause?.hint)error.hint=cause.hint;
  if(result?.status)error.status=result.status;
  error.cause=cause||undefined;
  return error;
}
// Reads never hang: a request that gets no answer within READ_TIMEOUT_MS is treated
// as a recoverable failure (primary -> backup), not as a user cancellation.
export const READ_TIMEOUT_MS=8000;
export async function executePublicRead(table,buildQuery,{source='auto',authenticated=false,signal=null,expectedDbId=''}={}){
  const cancel=transientReadSignal(signal);
  const timeout=AbortSignal.timeout(READ_TIMEOUT_MS);
  signal=cancel?AbortSignal.any([cancel,timeout]):timeout;
  if(cancel?.aborted)throw abortError();
  // Local Scope is not provisioned; do not let its reads reach remote SQL.
  if(/^silver\.local(?:_[a-z0-9_]+)?$/.test(String(table)))
    throw new Error('Local Scope 尚未啟用，請先設定資料庫引擎。');
  const routing=await selectedDatabaseRouting(dbConfiguredPublicClient);
  if(cancel?.aborted)throw abortError();
  // Hidden Galaxy rows require the signed-in SDK and server-enforced Scope RLS.
  // Never fall back to an anonymous or backup transport for authenticated reads.
  if(authenticated){
    if(!routing.primaryControl)throw new Error('Authenticated hidden search requires an authorized primary SQL connection');
    try{
      const result=await withSignal(withExpectedDatabase(buildQuery(publicRelation(dbAuthClient,table)),expectedDbId),signal);
      if(cancel?.aborted)throw abortError();
      const failure=resultError(result,table,'authenticated');
      if(failure)throw failure;
      return {...result,__dataSource:'authenticated'};
    }catch(error){
      if(cancel?.aborted||isAbortError(error))throw abortError();
      // Only on a recoverable primary SQL failure, and only
      // as an anonymous read: rows that need the signed-in RLS session are not
      // in the backup and simply will not be returned. Shown as backup source.
      // A qualified article identity may not fail over to another physical
      // database: identical local UIDs can mean entirely different articles.
      if(expectedDbId||!routing.backupId||!dbBackupPublicClient||!recoverableReadError(error))throw error;
      try{
        const backupResult=await withSignal(buildQuery(publicRelation(dbBackupPublicClient,table)),signal);
        if(cancel?.aborted)throw abortError();
        const backupFailure=resultError(backupResult,table,'backup');
        if(backupFailure)throw backupFailure;
        markBackupReadSucceeded(table);
        return {...backupResult,__dataSource:'backup'};
      }catch(secondary){
        markBackupReadFailed(table,secondary);
        const aggregate=new AggregateError([error,secondary],'Authenticated and backup read failed for '+table);
        aggregate.primaryError=error;
        aggregate.backupError=secondary;
        throw aggregate;
      }
    }
  }
  const primaryClient=routing.primaryControl?dbPublicClient:dbConfiguredPublicClient;
  if(!primaryClient)throw new Error('Selected primary database is unavailable');
  const run=async(client,label)=>{
    const result=await withSignal(withExpectedDatabase(buildQuery(publicRelation(client,table)),expectedDbId),signal);
    if(cancel?.aborted)throw abortError();
    const failure=resultError(result,table,label);
    if(failure)throw failure;
    return {...result,__dataSource:label};
  };
  const primary=async()=>{
    try{
      const value=await run(primaryClient,'primary');
      markPrimaryReadSucceeded(table);
      return value;
    }catch(error){
      if(cancel?.aborted||isAbortError(error))throw abortError();
      if(isDatabaseConnectivityFailure(error))markPrimaryReadFailed(table,error);
      else markPrimaryReadSucceeded(table); // SQL/application errors are not connectivity outages.
      throw error;
    }
  };
  const backup=async()=>{
    if(!routing.backupId||!dbBackupPublicClient)throw new Error('Backup database is not selected');
    try{
      const value=await run(dbBackupPublicClient,'backup');
      markBackupReadSucceeded(table);
      return value;
    }catch(error){
      markBackupReadFailed(table,error);
      throw error;
    }
  };
  if(source==='primary')return primary();
  if(source==='backup'&&expectedDbId)throw new Error('Qualified article reads cannot use an unverified backup');
  if(source==='backup')return backup();
  let original;
  try{return await primary()}catch(error){original=error}
  if(isAbortError(original))throw original;
  if(expectedDbId||!routing.backupId||!recoverableReadError(original))throw original;
  try{return await backup()}catch(secondary){
    const aggregate=new AggregateError([original,secondary],'Primary and backup read failed for '+table);
    aggregate.primaryError=original;
    aggregate.backupError=secondary;
    throw aggregate;
  }
}

export function applyFilters(query,filters=[]){
  for(const filter of filters){
    query=filter.operator==='in'
      ?query.in(filter.column,filter.value)
      :query[filter.operator](filter.column,filter.value);
  }
  return query;
}
export function applyOrders(query,orders=[]){
  for(const order of orders){
    query=query.order(order.column,{
      ascending:order.ascending??true,
      nullsFirst:order.nullsFirst
    });
  }
  return query;
}

export async function selectCount(table,{idColumn,filters=[],orFilter='',source='auto',
  authenticated=false,signal=null,expectedDbId=''}={}){
  if(!/^[a-z][a-z0-9_]*$/i.test(String(idColumn||'')))throw new Error('DB COUNT requires an explicit ID column');
  // HEAD returns a SQL count without loading rows, including tables without uid.
  const request=async()=>{
    const {count}=await executePublicRead(table,relation=>{
      let query=relation.select(idColumn,{count:'exact',head:true});
      query=applyFilters(query,filters);
      if(orFilter)query=query.or(orFilter);
      return query;
    },{source,authenticated,signal,expectedDbId});
    return Number(count)||0;
  };
  // Only anonymous requests without cancellation can share a pending result.
  if(authenticated||signal||expectedDbId||/^silver\.local(?:_[a-z0-9_]+)?$/.test(table))return request();
  return coalescePendingPublicRead(JSON.stringify(['count',table,idColumn,filters,orFilter,source]),request);
}

export async function selectRows(table,{
  columns,
  filters=[],
  orFilter='',
  orders=[],
  limit=MAX_ROWS,
  offset=0,
  count=null,
  source='auto',
  authenticated=false,
  signal=null,
  expectedDbId=''
}={}){
  if(!String(columns||'').trim()||String(columns).trim()==='*')throw new Error('DB SELECT requires explicit columns');
  // An explicit LIMIT controls only this request; never clamp it to a global Max Rows.
  const safeLimit=Math.max(1,Math.floor(Number(limit)||MAX_ROWS));
  const safeOffset=Math.max(0,Math.floor(Number(offset)||0));
  warnOversizedFilters(table,filters);
  const request=async()=>{
    const {data,count:total,__dataSource}=await executePublicRead(table,relation=>{
      let query=relation.select(columns,count?{count}:undefined);
      query=applyFilters(query,filters);
      if(orFilter)query=query.or(orFilter);
      query=applyOrders(query,orders);
      return query.range(safeOffset,safeOffset+safeLimit-1);
    },{source,authenticated,signal,expectedDbId});
    return {rows:data||[],count:total,dataSource:__dataSource};
  };
  // Only anonymous ZModel Lucus/Blocks reads share complete results.
  // Galaxy, authenticated rows, qualified DB reads and cancellable searches
  // never enter this cache. A backup response is not retained as primary.
  if(authenticated||signal||expectedDbId||/^silver\.local(?:_[a-z0-9_]+)?$/.test(table))return request();
  const signature=['rows',table,columns,filters,orFilter,orders,safeLimit,safeOffset,count,source];
  return getOrLoadScopedRead(table,signature,()=>coalescePendingPublicRead(
    JSON.stringify(['rows',transientReadGeneration(),...signature]),request
  ),{cacheable:result=>result?.dataSource==='primary'});
}

export async function selectAllRows(table,{
  columns,
  filters=[],
  orFilter='',
  orders=[],
  pageSize=DB_QUERY_BATCH_SIZE,
  onProgress=null,
  signal=null
}={}){
  return selectAllRowsBounded(table,{columns,filters,orFilter,orders,pageSize,
    signal,onProgress});
}

// Exact COUNT chooses the lane count once. Each full-scan page is the shared
// 10,000-row SQL chunk; small scans use one data query, while larger scans
// fan out only up to the common lane cap.
export async function selectAllRowsBounded(table,{
  columns,
  filters=[],
  orFilter='',
  orders=[],
  pageSize=DB_QUERY_BATCH_SIZE,
  authenticated=false,
  source='auto',
  expectedDbId='',
  onProgress=null,
  signal=null
}={}){
  const pageSignal=transientReadSignal(signal);
  // Default public page scans retain per-epoch query deduplication. An
  // explicitly supplied AbortSignal keeps independent cancellation behavior.
  const requestSignal=signal?pageSignal:null;
  const size=Math.max(1,Math.floor(Number(pageSize)||queryBatchSize(columns)));
  const total=await selectCount(table,{idColumn:'uid',filters,orFilter,source,
    authenticated,signal:requestSignal,expectedDbId});
  let completed=0;
  onProgress?.({completed,total});
  const offsets=[];
  for(let offset=0;offset<total;offset+=size)offsets.push(offset);
  const pages=await mapBounded(offsets,async offset=>{
    if(pageSignal.aborted)throw abortError();
    const page=await selectRows(table,{columns,filters,orFilter,orders,limit:size,offset,
      source,authenticated,signal:requestSignal,expectedDbId});
    completed+=page?.rows?.length||0;
    onProgress?.({completed,total});
    return page;
  });
  return {rows:pages.flatMap(page=>page?.rows||[]),count:total,
    dataSource:pages[0]?.dataSource||source};
}

// Streams a full table in bounded waves. Up to the shared lane cap can be read
// concurrently, then pages are handed to onPage in offset order and released
// before the next wave; peak transport memory remains bounded to that wave.
export const STREAM_PAGE_PAUSE_MS=120;
export async function forEachAllRowsPage(table,{
  columns,
  filters=[],
  orFilter='',
  orders=[],
  pageSize=DB_QUERY_BATCH_SIZE,
  pausePageMs=STREAM_PAGE_PAUSE_MS,
  signal=null
}={},onPage){
  signal=transientReadSignal(signal);
  const size=Math.max(1,Math.floor(Number(pageSize)||queryBatchSize(columns)));
  const total=await selectCount(table,{idColumn:'uid',filters,orFilter});
  const offsets=[];
  for(let offset=0;offset<total;offset+=size)offsets.push(offset);
  let completed=0;
  const concurrency=Math.min(SQL_WORKLOAD_POLICY.maxParallelChunks,offsets.length);
  for(let start=0;start<offsets.length;start+=Math.max(1,concurrency)){
    if(signal.aborted)throw abortError();
    const wave=offsets.slice(start,start+concurrency);
    const pages=await mapBounded(wave,offset=>{
      if(signal.aborted)throw abortError();
      return selectRows(table,{columns,filters,orFilter,orders,
        limit:size,offset,signal});
    },{signal});
    for(const page of pages){
      if(signal.aborted)throw abortError();
      const rows=page?.rows||[];
      if(!rows.length)continue;
      await onPage(rows);
      completed+=rows.length;
      if(pausePageMs>0&&completed<total)
        await new Promise(resolve=>setTimeout(resolve,pausePageMs));
    }
  }
  return completed;
}
