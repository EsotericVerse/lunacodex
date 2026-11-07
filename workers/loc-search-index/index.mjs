// LOC Search Index: FlexSearch in-memory shard snapshots persisted in LOC_KV.
// No SQL provider, Scope table, RLS policy, or database location is encoded here.
// This service is private to the LOC SQL Gateway; the browser never receives
// direct index access or a search-service credential.
import {Index} from 'flexsearch';
import {locSearchShard,locSearchDocumentId,LOC_SEARCH_INDEX_SHARDS} from '../../app/loc/search-index-shard.mjs';

const PREFIX='loc-search/v1/';
const MAX_HITS=200;
const MAX_SHARDS=96;
const encoder=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const SOURCE=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TYPE=/^[a-z][a-z0-9_]{0,31}$/;
const UID=/^[A-Za-z0-9_.~-]{1,128}$/;
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
const shardKey=doc=>base(doc)+String(locSearchShard(doc.uid)).padStart(2,'0');
function makeIndex(){return new Index({tokenize:'full',resolution:3,cache:false});}
async function loadShard(kv,key){
  const snapshot=await kv.get(key,'json');
  const index=makeIndex();
  if(snapshot!==null){
    if(snapshot?.version!==1||!snapshot.parts||typeof snapshot.parts!=='object')
      throw Error('Unsupported or corrupt LOC index snapshot');
    for(const [part,value] of Object.entries(snapshot.parts))
      await index.import(part,value);
  }
  return index;
}
async function writeShard(kv,key,index){
  const parts={};
  await index.export(async(part,value)=>{if(value!==undefined&&value!==null)parts[part]=value;});
  const payload=JSON.stringify({version:1,parts});
  if(encoder.encode(payload).length>24*1024*1024)
    throw Object.assign(new Error('LOC index shard exceeds KV value size; increase shard count'),{status:413});
  await kv.put(key,payload);
}
async function checkBearer(request,env){
  const secret=String(env.LOC_SEARCH_INDEX_SECRET||'');
  const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]||'';
  if(secret.length<32||token.length!==secret.length)return false;
  const a=encoder.encode(token),b=encoder.encode(secret);
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
  if(!Array.isArray(docs)||!docs.length||docs.length>50)throw invalid('Expected 1-50 documents');
  const groups=new Map();
  for(const entry of docs){
    const doc=identity(entry);
    const operation=String(entry.operation||'upsert');
    if(!['upsert','append','remove'].includes(operation))throw invalid('Invalid index operation');
    if(operation!=='remove'&&(typeof entry.content!=='string'||entry.content.length>140000))
      throw invalid('Invalid document content');
    const key=shardKey(doc);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({...doc,operation,content:entry.content||''});
  }
  // Import writes may contain many docs for the same shard: perform one
  // read / export / KV write per affected shard, not one write per article.
  for(const [key,items] of groups){
    const index=await loadShard(env.LOC_KV,key);
    for(const item of items){
      if(item.operation==='remove')index.remove(item.id);
      else if(item.operation==='append'&&index.contain(item.id))
        index.append(item.id,item.content);
      else if(index.contain(item.id))index.update(item.id,item.content);
      else index.add(item.id,item.content);
    }
    await writeShard(env.LOC_KV,key,index);
  }
  return {accepted:true,documents:docs.length,shards:groups.size};
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
async function find(env,body){
  const source=checkedSource(body||{});
  const query=String(body.query||'').trim();
  if(query.length<2||query.length>160||/[\u0000-\u001f\u007f]/u.test(query))throw invalid('Invalid search text');
  const covered=(await env.LOC_KV.get(readyKey(source)))==='v1';
  if(!covered)return {complete:false,hits:[]};
  const found=new Set();
  const prefix=base(source);
  const page=await env.LOC_KV.list({prefix,limit:MAX_SHARDS+1});
  if(page.list_complete===false||page.keys.length>MAX_SHARDS)
    return {complete:false,hits:[],reason:'index-too-many-shards'};
  const keys=page.keys.map(k=>k.name);
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
  const hits=[];
  for(const id of found){
    let decoded;try{decoded=JSON.parse(id);}catch{continue;}
    if(Array.isArray(decoded)&&decoded.length===4&&
       decoded[0]===source.scopeId&&decoded[1]===source.dbId&&
       decoded[2]===source.entityType&&UID.test(String(decoded[3])))
      hits.push({scopeId:decoded[0],dbId:decoded[1],entityType:decoded[2],uid:decoded[3]});
  }
  return {complete:true,hits};
}
async function coverage(env,body){
  const source=checkedSource(body||{});
  if(body.complete===true)await env.LOC_KV.put(readyKey(source),'v1');
  else if(body.complete===false)await env.LOC_KV.delete(readyKey(source));
  else throw invalid('Invalid completeness flag');
  return {accepted:true,complete:body.complete};
}
export default {
  async fetch(request,env){
    const pathname=new URL(request.url).pathname;
    if(request.method==='GET'&&pathname==='/health')return json({ready:Boolean(env.LOC_KV)});
    if(!await checkBearer(request,env))return json({error:'unauthorized'},401);
    try{
      if(request.method==='POST'&&pathname==='/v1/search')
        return json(await find(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/documents')
        return json(await mutate(env,await payloadOf(request)));
      if(request.method==='PUT'&&pathname==='/v1/coverage')
        return json(await coverage(env,await payloadOf(request)));
      if(request.method==='POST'&&pathname==='/v1/snapshot')
        return json(await replaceSnapshot(env,await payloadOf(request,20*1024*1024)));
      if(request.method==='POST'&&pathname==='/v1/reset')
        return json(await resetSource(env,await payloadOf(request)));
      return json({error:'not found'},404);
    }catch(error){
      const status=Number(error?.status)||500;
      if(status>=500)console.error('[loc-search-index]',error);
      return json({error:status>=500?'Index unavailable':String(error?.message||'Invalid request')},status);
    }
  }
};
