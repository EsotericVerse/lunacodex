// One-pass, memory-bounded LOC Galaxy -> FlexSearch -> LOC_KV backfill.
// All backfill reads are verified against the *exact* databaseId by LOC Auth
// and direct Kysely. No OpenNext, SQL schema change, new RPC or RLS.
// Requires a QUIESCED logical dataset for an exact initial snapshot.
import {createLocSearchIndex} from '../app/loc/search-index-factory.mjs';
import {locSearchShard,locSearchDocumentId,LOC_SEARCH_INDEX_SHARDS} from '../app/loc/search-index-shard.mjs';
import {stageAndPublishLocIndex} from './loc-search-index-stage.mjs';
import {directMcpKysely} from '../app/loc/mcp/native-kysely.mjs';
import {portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const DB=/^[a-z][a-z0-9_-]{0,63}$/;
const scopeId=String(process.env.LOC_INDEX_SCOPE_ID||'');
const dbId=String(process.env.LOC_INDEX_DB_ID||'');
const profiles=String(process.env.LOC_DB_CONNECTIONS_JSON||'');
const namespace=String(process.env.LOC_INDEX_DB_NAMESPACE||'silver');
const indexOrigin=String(process.env.LOC_SEARCH_INDEX_URL||'');
const indexSecret=String(process.env.LOC_SEARCH_INDEX_SECRET||'');
const verifyOnly=process.env.LOC_INDEX_VERIFY_ONLY==='true';
if(!SCOPE.test(scopeId)||!DB.test(dbId)||!profiles||
   indexSecret.length<32||!/^[A-Za-z][A-Za-z0-9_]*$/.test(namespace)||
   (!verifyOnly&&!/^https:\/\//.test(indexOrigin)))
  throw Error('Provide LOC_INDEX_SCOPE_ID, LOC_INDEX_DB_ID, LOC_DB_CONNECTIONS_JSON, LOC_SEARCH_INDEX_SECRET and unless verify-only LOC_SEARCH_INDEX_URL');
const origin=verifyOnly?null:new URL(indexOrigin);
if(origin&&(origin.username||origin.password||origin.search||origin.hash||
  !['','/'].includes(origin.pathname)))
  throw Error('Invalid index HTTPS origin');

// An operator chooses the database alias from server environment, not HTTP.
const port=directMcpKysely({
  LOC_DB_CONNECTIONS_JSON:profiles,
  LOC_MCP_DB_ALIAS:dbId,
  LOC_MCP_DB_NAMESPACE:namespace
},dbId);
const table=portableRelation(scopeId+'_galaxy',port.engine,port.namespace);
async function readSql({head=false,limit=50,offset=0}={}){
  if(head){
    const row=await port.db.selectFrom(table)
      .select(eb=>eb.fn.countAll().as('total')).executeTakeFirst();
    return {count:Number(row?.total||0)};
  }
  return {data:await port.db.selectFrom(table)
    .select(['uid','content']).orderBy('createtime','asc')
    .limit(limit).offset(offset).execute()};
}
async function indexCall(path,body,method='POST'){
  const response=await fetch(origin.origin+path,{
    method,headers:{'content-type':'application/json',
      authorization:'Bearer '+indexSecret},
    body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
    redirect:'error'
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.accepted!==true)
    throw Error('LOC_KV index '+path+' failed: HTTP '+response.status);
  return payload;
}
const startedAt=Date.now();
const count=await readSql({head:true,limit:1});
const expected=Number(count.count);
if(!Number.isSafeInteger(expected)||expected<0)
  throw Error('LOC native Kysely did not return an exact Galaxy row count');

async function* galaxyRows(){
  const pageSize=50;
  for(let offset=0;offset<expected;offset+=pageSize){
    const response=await readSql({head:false,limit:pageSize,offset});
    if(!Array.isArray(response.data)||!response.data.length||
       response.data.length>pageSize)
      throw Error('SQL index snapshot page was missing/invalid at '+offset);
    for(const row of response.data)yield row;
  }
}
const shardManifest=[];
let report;
try{report=await stageAndPublishLocIndex({
  rows:galaxyRows(),expected,scopeId,dbId,
  shardCount:LOC_SEARCH_INDEX_SHARDS,
  shardOf:locSearchShard,documentId:locSearchDocumentId,
  makeIndex:createLocSearchIndex,
  publish:async({phase,shard,parts})=>{
    if(verifyOnly)return;
    if(phase==='begin')
      await indexCall('/v1/reset',{scopeId,dbId,entityType:'galaxy'});
    else if(phase==='shard'){
      await indexCall('/v1/snapshot',{scopeId,dbId,entityType:'galaxy',shard,parts});
      shardManifest.push(shard);
    }
    else if(phase==='commit'){
      // Preserve immutable append deltas produced after SQL scanning began.
      await indexCall('/v1/prune-deltas',{
        scopeId,dbId,entityType:'galaxy',beforeMs:startedAt
      });
      await indexCall('/v1/coverage',{
        scopeId,dbId,entityType:'galaxy',complete:true,shards:shardManifest
      },'PUT');
    }
  }
});}
finally{await port.db.destroy();}
console.log(JSON.stringify({...report,scopeId,dbId,verifyOnly,
  complete:!verifyOnly&&report.complete}));
