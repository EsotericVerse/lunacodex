// LOC Search Index: FlexSearch in-memory shard snapshots persisted in LOC_KV.
// No SQL provider, Scope table, RLS policy, or database location is encoded here.
// This service is private to the LOC SQL Gateway; the browser never receives
// direct index access or a search-service credential.
import {createLocSearchIndex,LOC_SEARCH_INDEX_FORMAT,LOC_SEARCH_INDEX_PREFIX} from '../../app/loc/search-index-factory.mjs';
import {parseLocGlobalUid} from '../../zenstack/global-identity.mjs';
import {locSearchShard,locSearchDocumentId,LOC_SEARCH_INDEX_SHARDS} from '../../app/loc/search-index-shard.mjs';

const PREFIX=LOC_SEARCH_INDEX_PREFIX;
const MAX_HITS=200;
const MAX_SHARDS=96;
const encoder=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SOURCE=/^[a-z][a-z0-9_-]{0,63}$/;
const TYPE=/^[a-z][a-z0-9_]{0,31}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const invalid=(message)=>Object.assign(new Error(message),{status:400});

function checked(value,pattern,label){
  if(typeof value!=='string'||!pattern.test(value))throw invalid('Invalid '+label);
  return value;
}
function identity(doc){
  const scopeId=checked(doc.scopeId,SCOPE,'scopeId');
  const dbId=checked(doc.dbId,SOURCE,'dbId');
  const entityType=checked(doc.entityType||'galaxy',TYPE,'entityType');
  const uid=checked(doc.uid,UID,'uid');
  // JSON array encoding is injective even when two SQL databases reuse a UID.
  return {scopeId,dbId,entityType,uid,id:locSearchDocumentId({scopeId,dbId,entityType,uid})};
}
const base=({scopeId,dbId,entityType})=>PREFIX+'data/'+scopeId+'/'+dbId+'/'+entityType+'/';
const readyKey=({scopeId,dbId,entityType})=>PREFIX+'ready/'+scopeId+'/'+dbId+'/'+entityType;
function readReadyManifest(value){
  if(typeof value!=='string')return null;
  let data;
  try{data=JSON.parse(value);}catch{return null;}
  const shards=data?.shards;
  if(data?.version!==LOC_SEARCH_INDEX_FORMAT||
     !Array.isArray(shards)||shards.length>LOC_SEARCH_INDEX_SHARDS||
     shards.some(x=>!Number.isInteger(x)||x<0||x>=LOC_SEARCH_INDEX_SHARDS)||
     new Set(shards).size!==shards.length)return null;
  return data;
}
const shardKey=doc=>base(doc)+String(locSearchShard(doc.uid)).padStart(2,'0');
function makeIndex(){return createLocSearchIndex();}
async function loadShard(kv,key){
  const snapshot=await kv.get(key,'json');
  const index=makeIndex();
  // A manifest-referenced base shard or listed delta must exist. Treating a
  // temporarily invisible KV key as an empty index would drop valid hits.
  if(snapshot===null)
    throw Object.assign(new Error('Index shard not visible yet'),{status:503});
  if(snapshot?.version!==LOC_SEARCH_INDEX_FORMAT||!snapshot.parts||
     typeof snapshot.parts!=='object')
    throw Error('Unsupported or corrupt LOC index snapshot');
  for(const [part,value] of Object.entries(snapshot.parts))
    await index.import(part,value);
  return index;
}
async function writeShard(kv,key,index){
  const parts={};
  await index.export(async(part,value)=>{if(value!==undefined&&value!==null)parts[part]=value;});
  const payload=JSON.stringify({version:LOC_SEARCH_INDEX_FORMAT,parts});
  if(encoder.encode(payload).length>24*1024*1024)
    throw Object.assign(new Error('LOC index shard exceeds KV value size; increase shard count'),{status:413});
  await kv.put(key,payload);
}
async function checkBearer(request,env){
  const secret=String(env.LOC_SEARCH_INDEX_SECRET||'');
  const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]||'';
  if(secret.length<32||token.length!==secret.length)return false;
  const a=encoder.encode(token),b=encoder.encode(secret);
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
async function payloadOf(request,maxBytes=900000){
  const text=await request.text();
  if(encoder.encode(text).length>maxBytes)
    throw Object.assign(new Error('Index request too large'),{status:413});
  try{return JSON.parse(text);}catch{throw invalid('Invalid JSON');}
}
function checkedSource(raw){
  const scopeId=checked(raw.scopeId,SCOPE,'scopeId');
  const dbId=checked(raw.dbId,SOURCE,'dbId');
  const entityType=checked(raw.entityType||'galaxy',TYPE,'entityType');
  return {scopeId,dbId,entityType};
}
async function mutate(env,body){
  const docs=body?.documents;
  if(!Array.isArray(docs)||!docs.length||docs.length>50)
    throw invalid('Expected 1-50 documents');
  const groups=new Map();
  for(const entry of docs){
    const doc=identity(entry);
    const operation=String(entry.operation||'upsert');
    if(!['upsert','append','remove'].includes(operation))throw invalid('Invalid index operation');
    if(operation!=='remove'&&(typeof entry.content!=='string'||entry.content.length>140000))
      throw invalid('Invalid document content');
    const prefix=PREFIX+'delta/'+doc.scopeId+'/'+doc.dbId+'/'+doc.entityType+'/';
    if(!groups.has(prefix))groups.set(prefix,[]);
    groups.get(prefix).push({...doc,operation,content:entry.content||''});
  }
  // Immutable delta segments are ONE KV write per logical source/batch.
  // Appending new text never rewrites or races with a shared base shard.
  // Old postings from edits/deletes are harmless candidates: SQL verifies
  // every article's current content, publication and Scope permission.
  for(const [prefix,items] of groups){
    const index=makeIndex();
    let changed=0;
    for(const item of items){
      if(item.operation==='remove')continue; // SQL revalidation rejects deleted rows.
      if(index.contain(item.id)){
        if(item.operation==='append')index.append(item.id,item.content);
        else index.update(item.id,item.content);
      }else index.add(item.id,item.content);
      changed++;
    }
    if(!changed)continue;
    const parts={};
    await index.export(async(part,value)=>{
      if(value!==undefined&&value!==null)parts[part]=value;
    });
    const data=JSON.stringify({version:LOC_SEARCH_INDEX_FORMAT,parts});
    if(encoder.encode(data).length>24*1024*1024)
      throw Object.assign(new Error('Index delta exceeds KV limit'),{status:413});
    const key=prefix+Date.now().toString(36)+'-'+crypto.randomUUID();
    await env.LOC_KV.put(key,data);
  }
  return {accepted:true,documents:docs.length,segments:groups.size};
}
async function replaceSnapshot(env,body){
  const source=checkedSource(body||{});
  const shard=Number(body.shard);
  if(!Number.isInteger(shard)||shard<0||shard>=LOC_SEARCH_INDEX_SHARDS)
    throw invalid('Invalid index shard');
  const parts=body.parts;
  if(!parts||typeof parts!=='object'||Array.isArray(parts)||
     Object.entries(parts).some(([k,v])=>!k||k.length>100||typeof v!=='string'))
    throw invalid('Invalid index snapshot');
  const key=base(source)+String(shard).padStart(2,'0');
  const index=makeIndex();
  for(const [part,value] of Object.entries(parts))await index.import(part,value);
  await writeShard(env.LOC_KV,key,index);
  return {accepted:true,shard};
}
async function resetSource(env,body){
  const source=checkedSource(body||{});
  await env.LOC_KV.delete(readyKey(source));
  const prefix=base(source);
  const page=await env.LOC_KV.list({prefix,limit:MAX_SHARDS+1});
  if(page.list_complete===false||page.keys.length>MAX_SHARDS)
    throw Object.assign(new Error('Too many index shards for bounded reset'),{status:409});
  for(const item of page.keys)await env.LOC_KV.delete(item.name);
  return {accepted:true,removed:page.keys.length};
}
async function pruneDeltas(env,body){
  const source=checkedSource(body||{});
  const cutoff=Number(body.beforeMs);
  if(!Number.isSafeInteger(cutoff)||cutoff<1||cutoff>Date.now())
    throw invalid('Invalid compaction cutoff');
  const prefix=PREFIX+'delta/'+source.scopeId+'/'+source.dbId+'/'+source.entityType+'/';
  // Compaction is an explicit operation after a verified SQL backfill.
  // The cutoff is captured BEFORE the SQL scan: any newer appended text
  // remains in immutable deltas rather than being deleted with old postings.
  const page=await env.LOC_KV.list({prefix,limit:1001});
  if(page.list_complete===false||page.keys.length>1000)
    throw Object.assign(new Error('Index delta prune exceeds bounded limit'),{status:409});
  let removed=0;
  for(const entry of page.keys){
    const raw=entry.name.slice(prefix.length).split('-')[0];
    const created=Number.parseInt(raw,36);
    if(Number.isSafeInteger(created)&&created<cutoff){
      await env.LOC_KV.delete(entry.name);
      removed++;
    }
  }
  return {accepted:true,removed};
}
async function find(env,body){
  const scopeId=checked(body?.scopeId,SCOPE,'scopeId');
  const entityType=checked(body?.entityType||'galaxy',TYPE,'entityType');
  const dbIds=Array.isArray(body?.dbIds)?body.dbIds:[body?.dbId];
  if(!dbIds.length||dbIds.length>16)throw invalid('Invalid requested datasets');
  const sources=[...new Set(dbIds.map(dbId=>checked(dbId,SOURCE,'dbId')))]
    .map(dbId=>({scopeId,dbId,entityType}));
  const query=String(body.query||'').trim();
  if(query.length<2||query.length>160||/[\u0000-\u001f\u007f]/u.test(query))
    throw invalid('Invalid search text');
  const found=new Set();
  // Read a committed shard manifest, not a bare readiness flag. A remote
  // KV point-of-presence might see the marker before it sees every snapshot.
  // Direct GETs of every named shard fail to SQL rather than losing hits.
  for(const source of sources){
    const ready=readReadyManifest(await env.LOC_KV.get(readyKey(source)));
    if(!ready)return {complete:false,hits:[],reason:'dataset-incomplete'};
    const deltaPrefix=PREFIX+'delta/'+source.scopeId+'/'+source.dbId+'/'+source.entityType+'/';
    const delta=await env.LOC_KV.list({prefix:deltaPrefix,limit:49});
    if(delta.list_complete===false||delta.keys.length>48)
      return {complete:false,hits:[],reason:'index-needs-compaction'};
    const keys=[
      ...ready.shards.map(shard=>base(source)+String(shard).padStart(2,'0')),
      ...delta.keys.map(item=>item.name)
    ];
    for(let offset=0;offset<keys.length;offset+=4){
      const batches=keys.slice(offset,offset+4);
      const result=await Promise.all(batches.map(async key=>{
        const idx=await loadShard(env.LOC_KV,key);
        return idx.search(query,{limit:MAX_HITS+1});
      }));
      for(const ids of result)for(const id of ids)found.add(id);
      if(found.size>MAX_HITS)
        return {complete:false,hits:[],reason:'candidate-limit'};
    }
  }
  const hits=[];
  for(const id of found){
    let decoded;try{decoded=JSON.parse(id);}catch{continue;}
    if(!Array.isArray(decoded)||decoded.length!==2||decoded[0]!==entityType)
      continue;
    let qualified;try{qualified=parseLocGlobalUid(decoded[1]);}catch{continue;}
    if(qualified.scopeId===scopeId&&sources.some(s=>s.dbId===qualified.databaseId))
      hits.push({scopeId:qualified.scopeId,dbId:qualified.databaseId,
        entityType,uid:qualified.uid,globalUid:decoded[1]});
  }
  return {complete:true,hits};
}
async function coverage(env,body){
  const source=checkedSource(body||{});
  if(body.complete===true){
    const shards=body.shards;
    if(!Array.isArray(shards)||shards.length>LOC_SEARCH_INDEX_SHARDS||
       shards.some(x=>!Number.isInteger(x)||x<0||x>=LOC_SEARCH_INDEX_SHARDS)||
       new Set(shards).size!==shards.length)
      throw invalid('Index coverage requires an explicit shard manifest');
    await env.LOC_KV.put(readyKey(source),JSON.stringify({
      version:LOC_SEARCH_INDEX_FORMAT,shards:[...shards].sort((a,b)=>a-b)
    }));
  }else if(body.complete===false)
    await env.LOC_KV.delete(readyKey(source));
  else throw invalid('Invalid completeness flag');
  return {accepted:true,complete:body.complete};
}
async function sourceStatus(env,body){
  const source=checkedSource(body||{});
  const ready=readReadyManifest(await env.LOC_KV.get(readyKey(source)));
  const prefix=PREFIX+'delta/'+source.scopeId+'/'+source.dbId+'/'+source.entityType+'/';
  const delta=await env.LOC_KV.list({prefix,limit:49});
  const tooMany=delta.list_complete===false||delta.keys.length>48;
  return {accepted:true,scopeId:source.scopeId,dbId:source.dbId,
    entityType:source.entityType,indexVersion:LOC_SEARCH_INDEX_FORMAT,
    ready:Boolean(ready),baseShards:ready?.shards.length||0,
    deltaSegments:delta.keys.length,needsCompaction:tooMany,
    complete:Boolean(ready)&&!tooMany};
}
export default {
  async fetch(request,env){
    const pathname=new URL(request.url).pathname;
    if(request.method==='GET'&&pathname==='/health')return json({ready:Boolean(env.LOC_KV)});
    if(!await checkBearer(request,env))return json({error:'unauthorized'},401);
    try{
      if(request.method==='POST'&&pathname==='/v1/search')
        return json(await find(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/status')
        return json(await sourceStatus(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/documents')
        return json(await mutate(env,await payloadOf(request)));
      if(request.method==='PUT'&&pathname==='/v1/coverage')
        return json(await coverage(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/snapshot')
        return json(await replaceSnapshot(env,await payloadOf(request,20*1024*1024)));
      if(request.method==='POST'&&pathname==='/v1/reset')
        return json(await resetSource(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/prune-deltas')
        return json(await pruneDeltas(env,await payloadOf(request)));
      return json({error:'not found'},404);
    }catch(error){
      const status=Number(error?.status)||500;
      if(status>=500)console.error('[loc-search-index]',error);
      return json({error:status>=500?'Index unavailable':String(error?.message||'Invalid request')},status);
    }
  }
};
