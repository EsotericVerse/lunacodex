// One in-memory query-result store for ALL scoped ZModel Anchor/Blocks.
// No Galaxy, identity, grants, private read, SQL indexes/idx tables, TTL,
// polling, ISR, persistent browser cache, or additional physical relations.
// Model mapping is taken from LOC's existing ZModel SchemaDef (not a new
// manually maintained table or index). LOC Blocks live in loc_anchor.
import {modelNameForSql} from './model-column-guard.mjs';
const RELATION=/^silver\.([a-z][a-z0-9]{0,14})_(anchor|blocks)$/;
const ALLOWED_MODELS=new Set([
  'LocAnchor','Lo3rwangAnchor','LrunesAnchor',
  'Lo3rwangBlocks','LrunesBlocks'
]);
const MAX_ENTRIES=120;
const entries=new Map();
const generations=new Map();

export function scopedReadRelation(value){
  const name=String(value||'').trim();
  const matched=RELATION.exec(name);
  if(!matched||name==='silver.loc_blocks'||matched[1]==='local')return null;
  const modelName=modelNameForSql('silver',name.slice('silver.'.length));
  if(!ALLOWED_MODELS.has(modelName))return null;
  return {name,scopeId:matched[1],kind:matched[2],modelName};
}
function abortError(signal){
  if(signal?.reason?.name==='AbortError')return signal.reason;
  const error=new Error('Shared Anchor read no longer has an active consumer');
  error.name='AbortError';
  return error;
}
function touch(key,entry){
  entries.delete(key);
  entries.set(key,entry);
  // Bound retained result keys (not lifetime or validity). An in-use request
  // may finish for its subscribers, but an unobserved request is aborted.
  while(entries.size>MAX_ENTRIES){
    const oldestKey=entries.keys().next().value;
    const oldest=entries.get(oldestKey);
    entries.delete(oldestKey);
    if(oldest&&!oldest.settled&&oldest.consumers===0)oldest.controller.abort();
  }
}
function subscribe(entry,signal){
  if(signal?.aborted)return Promise.reject(abortError(signal));
  entry.consumers++;
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    entry.consumers=Math.max(0,entry.consumers-1);
    if(!entry.settled&&entry.consumers===0&&entries.get(entry.key)===entry){
      entries.delete(entry.key);
      entry.controller.abort();
    }
  };
  if(!signal)return entry.promise.finally(release);
  let onAbort;
  const aborted=new Promise((_,reject)=>{
    onAbort=()=>reject(abortError(signal));
    signal.addEventListener('abort',onAbort,{once:true});
    if(signal.aborted)onAbort();
  });
  return Promise.race([entry.promise,aborted]).finally(()=>{
    signal.removeEventListener('abort',onAbort);
    release();
  });
}
export function invalidateScopedReadCache(relation){
  if(!relation){
    for(const entry of entries.values())
      if(!entry.settled)entry.controller.abort();
    entries.clear();
    for(const name of generations.keys())
      generations.set(name,(generations.get(name)||0)+1);
    return;
  }
  const parsed=scopedReadRelation(relation);
  if(!parsed)return false;
  const name=parsed.name;
  generations.set(name,(generations.get(name)||0)+1);
  for(const [key,entry] of entries){
    if(entry.relation===name){
      if(!entry.settled)entry.controller.abort();
      entries.delete(key);
    }
  }
  return true;
}
export function getOrLoadScopedRead(relation,descriptor,load,{
  cacheable=()=>true,signal=null
}={}){
  if(signal?.aborted)return Promise.reject(abortError(signal));
  const parsed=scopedReadRelation(relation);
  if(!parsed)return Promise.resolve().then(()=>load({signal}));
  const key=JSON.stringify([parsed.modelName,parsed.scopeId,parsed.name,descriptor]);
  const existing=entries.get(key);
  if(existing){
    touch(key,existing);
    return subscribe(existing,signal);
  }
  const revision=generations.get(parsed.name)||0;
  const controller=new AbortController();
  const entry={key,relation:parsed.name,controller,consumers:0,settled:false,promise:null};
  // Register before transport side effects so all active consumers share one
  // request. The final consumer leaving aborts it; successful results alone
  // remain in the bounded LRU for later page visits.
  entry.promise=Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw abortError(controller.signal);
    return load({signal:controller.signal});
  }).then(result=>{
    if(controller.signal.aborted)throw abortError(controller.signal);
    entry.settled=true;
    if(entries.get(key)===entry&&(generations.get(parsed.name)||0)===revision){
      if(cacheable(result))touch(key,entry);
      else entries.delete(key);
    }
    return result;
  }).catch(error=>{
    entry.settled=true;
    if(entries.get(key)===entry)entries.delete(key);
    throw error;
  });
  // A cancelled last subscriber may leave the server action finishing in the
  // background. Keep its eventual rejection observed without masking callers.
  entry.promise.catch(()=>{});
  touch(key,entry);
  return subscribe(entry,signal);
}
export function scopedReadCacheStats(){
  return Object.freeze({entries:entries.size,
    relations:[...new Set([...entries.values()].map(row=>row.relation))].sort()});
}
