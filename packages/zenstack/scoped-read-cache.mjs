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
  if(!matched||name==='silver.loc_blocks')return null;
  const modelName=modelNameForSql('silver',name.slice('silver.'.length));
  if(!ALLOWED_MODELS.has(modelName))return null;
  return {name,scopeId:matched[1],kind:matched[2],modelName};
}
function touch(key,entry){
  entries.delete(key);
  entries.set(key,entry);
  // Bound retained result keys (not lifetime or validity). LRU eviction
  // does not alter the lifetime of a mounted React component's own data.
  while(entries.size>MAX_ENTRIES){
    entries.delete(entries.keys().next().value);
  }
}
export function invalidateScopedReadCache(relation){
  if(!relation){
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
    if(entry.relation===name)entries.delete(key);
  }
  return true;
}
export function getOrLoadScopedRead(relation,descriptor,load,{cacheable=()=>true}={}){
  const parsed=scopedReadRelation(relation);
  if(!parsed)return Promise.resolve().then(load);
  const key=JSON.stringify([parsed.modelName,parsed.scopeId,parsed.name,descriptor]);
  const existing=entries.get(key);
  if(existing){
    touch(key,existing);
    return existing.promise;
  }
  const revision=generations.get(parsed.name)||0;
  const entry={relation:parsed.name,promise:null};
  // Load first in a microtask: entry is registered before synchronous
  // transport side effects, so concurrent consumers share one request.
  entry.promise=Promise.resolve().then(load).then(result=>{
    if(entries.get(key)===entry&&(generations.get(parsed.name)||0)===revision){
      if(cacheable(result))touch(key,entry);
      else entries.delete(key);
    }
    return result;
  }).catch(error=>{
    if(entries.get(key)===entry)entries.delete(key);
    throw error;
  });
  touch(key,entry);
  return entry.promise;
}
export function scopedReadCacheStats(){
  return Object.freeze({entries:entries.size,
    relations:[...new Set([...entries.values()].map(row=>row.relation))].sort()});
}
