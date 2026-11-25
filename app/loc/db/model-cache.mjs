// Explicit public Model projections, not page ISR or raw Galaxy content.
// R2 is optional for reads. The control object fences committed and in-flight
// SQL writes; a cache hit never opens a database connection.
const CONTROL='model-cache/control.json';
const PREFIX='model-cache/v1/';
const MAX_BYTES=8*1024*1024;
const MAX_ATTEMPTS=12;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const MODELS=new Set(['culture_anchors','culture_density','time_anchors',
  'statics_daily','statics_daily_total','statics_overview','statics_earliest',
  'statics_totals','statics_loc','trace_places','trace_territory',
  'trace_daily','trace_keywords','shared_classes','keyword_catalog','keyword_summary']);

export async function locModelCacheBinding(env={}){
  let bucket=env?.LOC_MODEL_CACHE;
  if(!bucket){
    try{
      const {getCloudflareContext}=await import('@opennextjs/cloudflare');
      bucket=(await getCloudflareContext({async:true}))?.env?.LOC_MODEL_CACHE;
    }catch{return null;}
  }
  return bucket&&typeof bucket.get==='function'&&typeof bucket.put==='function'
    ?bucket:null;
}
function uuid(){return globalThis.crypto.randomUUID();}
function initial(){return {enabled:true,revision:uuid(),writers:[]};}
function valid(state){
  return state&&typeof state.enabled==='boolean'&&typeof state.revision==='string'&&
    Array.isArray(state.writers)&&state.writers.every(id=>typeof id==='string');
}
async function loadControl(bucket){
  const object=await bucket.get(CONTROL);
  if(!object)return null;
  const value=await object.json();
  if(!valid(value))throw Error('Invalid LOC Model Cache control');
  return {value,etag:object.etag};
}
async function changeControl(bucket,change){
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    const current=await loadControl(bucket);
    const next=change(current?.value??initial());
    if(!valid(next))throw Error('Invalid LOC Model Cache change');
    const onlyIf=current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'};
    const result=await bucket.put(CONTROL,JSON.stringify(next),{onlyIf,
      httpMetadata:{contentType:'application/json'}});
    if(result)return next;
  }
  throw Error('LOC Model Cache control contention');
}
async function control(bucket){
  return (await loadControl(bucket))?.value??
    changeControl(bucket,state=>state);
}
function available(state){return state.enabled&&state.writers.length===0;}
function same(a,b){return available(b)&&a.revision===b.revision;}
function log(stage,error){
  console.warn('[LOC Model Cache]',stage,String(error?.message||error).slice(0,180));
}
export async function modelCacheStatus(env={}){
  const bucket=await locModelCacheBinding(env);
  if(!bucket)return {available:false,enabled:false,pending:0};
  const state=await control(bucket);
  return {available:true,enabled:state.enabled,pending:state.writers.length};
}
export async function setModelCacheEnabled(enabled,env={}){
  if(typeof enabled!=='boolean')throw Error('Invalid LOC Model Cache setting');
  const bucket=await locModelCacheBinding(env);
  if(!bucket)throw Error('LOC_MODEL_CACHE binding unavailable');
  const state=await changeControl(bucket,old=>({...old,enabled,revision:uuid()}));
  return {available:true,enabled:state.enabled,pending:state.writers.length};
}
export async function beginModelCacheWrite(env={}){
  const bucket=await locModelCacheBinding(env);
  if(!bucket)return async()=>{};
  const token=uuid();
  // Invalidate before the SQL transaction. While any writer is active all
  // readers bypass R2. An interrupted request leaves cache reads safely off.
  await changeControl(bucket,state=>({...state,revision:uuid(),
    writers:[...state.writers,token]}));
  return async()=>{
    try{
      await changeControl(bucket,state=>({...state,revision:uuid(),
        writers:state.writers.filter(id=>id!==token)}));
    }catch(error){log('finish-write; cache bypass remains active',error);}
  };
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(
    Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
async function signature(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
    JSON.stringify(stable(value))));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function readPublicModelCache({scope,model,args,publication},load,env={}){
  if(!SCOPE.test(String(scope))||!MODELS.has(model))return load();
  const bucket=await locModelCacheBinding(env);
  if(!bucket)return load();
  let state,key,hash,existing;
  try{
    state=await control(bucket);
    if(!available(state))return load();
    hash=await signature([args,publication]);
    // One fixed slot per public Model/Scope; arbitrary date ranges and
    // deployments do not create unbounded object keys.
    key=PREFIX+scope+'/'+model+'.json';
    existing=await bucket.get(key);
    if(existing&&existing.size<=MAX_BYTES){
      const record=await existing.json();
      if(record?.revision===state.revision&&record.hash===hash&&
        Object.hasOwn(record,'data')&&same(state,await control(bucket)))
        return record.data;
    }
  }catch(error){log('read',error);return load();}
  const data=await load();
  try{
    if(!same(state,await control(bucket)))return data;
    const payload=JSON.stringify({revision:state.revision,hash,data});
    if(new TextEncoder().encode(payload).byteLength<=MAX_BYTES){
      await bucket.put(key,payload,{onlyIf:existing
        ?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'},
        httpMetadata:{contentType:'application/json'}});
    }
  }catch(error){log('store',error);}
  return data;
}
