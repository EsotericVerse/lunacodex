// One-time LOC Search index builder: SQL read -> in-memory FlexSearch ->
// one snapshot per populated shard -> LOC_KV. No SQL schema, trigger, or RPC.
// Requires a valid LOC-delegated Scope reader token and trusted index secret.
// Run only against a stable source; the script verifies the row count and UID
// coverage before declaring the index complete.
import {createLocSearchIndex} from '../app/loc/search-index-factory.mjs';
import {locSearchShard,locSearchDocumentId,LOC_SEARCH_INDEX_SHARDS} from '../app/loc/search-index-shard.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const DB=/^[a-z][a-z0-9_-]{0,63}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const scopeId=String(process.env.LOC_INDEX_SCOPE_ID||'');
const dbId=String(process.env.LOC_INDEX_DB_ID||'');
const gateway=String(process.env.LOC_SQL_GATEWAY_URL||'');
const gatewayToken=String(process.env.LOC_SQL_DELEGATION_TOKEN||'');
const indexOrigin=String(process.env.LOC_SEARCH_INDEX_URL||'');
const indexSecret=String(process.env.LOC_SEARCH_INDEX_SECRET||'');
if(!SCOPE.test(scopeId)||!DB.test(dbId)||!gatewayToken||
   indexSecret.length<32||!/^https:\/\//.test(gateway)||!/^https:\/\//.test(indexOrigin))
  throw Error('Provide valid LOC_INDEX_SCOPE_ID, LOC_INDEX_DB_ID, LOC_SQL_GATEWAY_URL, LOC_SQL_DELEGATION_TOKEN, LOC_SEARCH_INDEX_URL, LOC_SEARCH_INDEX_SECRET');
const endpoint=new URL(indexOrigin);
if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
  !['','/'].includes(endpoint.pathname))throw Error('Invalid index HTTPS origin');

async function post(url,body){
  const response=await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json',
      authorization:'Bearer '+gatewayToken,
      'x-loc-index-secret':indexSecret},
    body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
    redirect:'error'
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.error)
    throw Error('Index build request failed: HTTP '+response.status+' '+String(payload?.error?.message||payload?.error||''));
  return payload;
}
async function indexCall(path,body,method='POST'){
  const r=await fetch(endpoint.origin+path,{
    method,headers:{'content-type':'application/json',authorization:'Bearer '+indexSecret},
    body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'
  });
  const payload=await r.json().catch(()=>null);
  if(!r.ok||payload?.accepted!==true)throw Error('Index '+path+' HTTP '+r.status);
  return payload;
}
const snapshotStartedMs=Date.now();
const indices=Array.from({length:LOC_SEARCH_INDEX_SHARDS},
  ()=>createLocSearchIndex());
const perShard=new Array(LOC_SEARCH_INDEX_SHARDS).fill(0);
const seen=new Set(),pageSize=50;
const base={kind:'index-snapshot',scopeId,databaseId:dbId};
const head=await post(gateway,{...base,head:true,limit:1});
const expected=Number(head.count);
if(!Number.isSafeInteger(expected)||expected<0)
  throw Error('LOC SQL Gateway did not supply an exact row count');
for(let offset=0;offset<expected;offset+=pageSize){
  const result=await post(gateway,{...base,head:false,
    limit:pageSize,offset});
  const rows=result.data;
  if(!Array.isArray(rows)||!rows.length)
    throw Error('SQL source changed or returned an incomplete page at '+offset);
  for(const row of rows){
    const uid=String(row.uid||'');
    if(!UID.test(uid)||seen.has(uid)||typeof row.content!=='string')
      throw Error('Source contains invalid, repeated, or unreadable Galaxy article: '+uid);
    seen.add(uid);
    const shard=locSearchShard(uid);
    indices[shard].add(locSearchDocumentId({scopeId,dbId,uid}),row.content);
    perShard[shard]++;
  }
}
if(seen.size!==expected)
  throw Error('SQL snapshot coverage mismatch: expected '+expected+', read '+seen.size);
// Do not invalidate the current index until all SQL reads and local index
// construction succeed. Reset disables indexed search while uploading shards.
await indexCall('/v1/reset',{scopeId,dbId,entityType:'galaxy'});
let shipped=0;
for(let shard=0;shard<indices.length;shard++){
  if(!perShard[shard])continue;
  const parts={};
  await indices[shard].export(async(key,data)=>{
    if(data!==undefined&&data!==null)parts[key]=data;
  });
  await indexCall('/v1/snapshot',{scopeId,dbId,entityType:'galaxy',shard,parts});
  shipped++;
}
await indexCall('/v1/prune-deltas',{scopeId,dbId,entityType:'galaxy',beforeMs:snapshotStartedMs});
await indexCall('/v1/coverage',{scopeId,dbId,entityType:'galaxy',complete:true},'PUT');
console.log(JSON.stringify({indexed:expected,scopeId,dbId,shards:shipped,complete:true}));
