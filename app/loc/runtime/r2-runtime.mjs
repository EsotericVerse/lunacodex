import {getCloudflareContext} from '@opennextjs/cloudflare';
export const RUNTIME_CONTROL_KEY='loc-runtime/v1/control.json';
export const RUNTIME_STRUCTURE_KEY='loc-runtime/v1/structure.json';
export const RUNTIME_DEFAULTS=Object.freeze({version:1,r2Enabled:true,hyperdriveEnabled:true});
const UID=/^[A-Za-z0-9]{8}$/;
const TYPE=new Set(['category','class','group','item','pattern']);

export async function runtimeBucket(env={},getContext=getCloudflareContext){
  if(env?.LOC_RUNTIME)return env.LOC_RUNTIME;
  try{return (await getContext({async:true}))?.env?.LOC_RUNTIME||null;}
  catch{return null;}
}
export function normalizeRuntimeControl(value){
  if(!value||value.version!==1||typeof value.r2Enabled!=='boolean'||
    typeof value.hyperdriveEnabled!=='boolean')return null;
  return {version:1,r2Enabled:value.r2Enabled,hyperdriveEnabled:value.hyperdriveEnabled};
}
export async function readRuntimeControl(env={},getContext){
  const bucket=await runtimeBucket(env,getContext);
  if(!bucket)return null;
  try{
    const object=await bucket.get(RUNTIME_CONTROL_KEY);
    return object?normalizeRuntimeControl(await object.json()):null;
  }catch{
    console.warn('LOC runtime settings unavailable');
    return null;
  }
}
// Private fixed key; never accept a browser-supplied object path or credential.
// A conditional write prevents two Admin tabs from overwriting each other.
export async function patchRuntimeControl(patch,{env={},getContext}={}){
  if(!patch||Object.keys(patch).some(k=>!['r2Enabled','hyperdriveEnabled'].includes(k))||
    Object.values(patch).some(v=>typeof v!=='boolean'))
    throw new TypeError('Invalid runtime setting');
  const bucket=await runtimeBucket(env,getContext);
  if(!bucket)throw Error('R2 未設定');
  for(let i=0;i<3;i++){
    const old=await bucket.get(RUNTIME_CONTROL_KEY);
    const current=old?normalizeRuntimeControl(await old.json()):RUNTIME_DEFAULTS;
    if(!current)throw Error('R2 系統設定格式無效');
    const next={...current,...patch};
    const receipt=await bucket.put(RUNTIME_CONTROL_KEY,JSON.stringify(next),{
      onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'},
      httpMetadata:{contentType:'application/json'}
    });
    if(receipt)return next;
  }
  throw Error('系統設定已被更新，請重新讀取');
}
export function validateKeywordTemplate(value){
  if(!value||!UID.test(value.classUid)||!Array.isArray(value.rows)||
     value.rows.length>10000)return null;
  const seen=new Map();
  for(const row of value.rows){
    if(!row||!UID.test(row.uid)||seen.has(row.uid)||!TYPE.has(row.type)||
       row.invisible!==false||typeof row.title!=='string'||
       (row.description!=null&&typeof row.description!=='string')||
       !row.attr||typeof row.attr!=='object'||Array.isArray(row.attr))return null;
    if(row.type!=='pattern'&&(!Array.isArray(row.attr.uid)||
      row.attr.uid.some(uid=>!UID.test(uid))))return null;
    if(row.type==='item'&&(!Array.isArray(row.attr.keyword)||
      row.attr.keyword.some(word=>typeof word!=='string')))return null;
    seen.set(row.uid,row);
  }
  const childType={category:'class',class:'group',group:'item',item:'pattern'};
  for(const row of value.rows){
    if(row.type==='pattern')continue;
    if(row.attr.uid.some(id=>seen.get(id)?.type!==childType[row.type]))return null;
  }
  if(seen.get(value.classUid)?.type!=='class'||
    !value.rows.some(row=>row.type==='category'&&row.attr.uid.includes(value.classUid)))return null;
  // Expose only allowlisted definition fields; counts are not a data backup.
  return {classUid:value.classUid,rows:value.rows.map(row=>{
    const attr=row.type==='pattern'?{}:{uid:[...row.attr.uid]};
    if(row.type==='item')attr.keyword=[...row.attr.keyword];
    if(row.type==='group'||row.type==='item')attr.total=0;
    return {uid:row.uid,type:row.type,title:row.title,description:row.description??null,
      invisible:false,attr,num:row.type==='pattern'?0:attr.uid.length};
  })};
}
export async function readRuntimeStructure(env={},getContext){
  const bucket=await runtimeBucket(env,getContext);
  if(!bucket)return null;
  try{
    const control=await readRuntimeControl(env,getContext);
    if(control?.r2Enabled===false)return null;
    const object=await bucket.get(RUNTIME_STRUCTURE_KEY);
    if(!object||object.size>4*1024*1024)return null;
    const data=await object.json();
    if(data?.version!==1)return null;
    const scopes={};
    for(const id of ['lo3rwang','lrunes']){
      const template=validateKeywordTemplate(data.scopes?.[id]);
      if(template)scopes[id]=template;
    }
    const types=new Set(['universe','galaxy','domain','from']);
    const sourceRows=Array.isArray(data.sources)?data.sources:[];
    const sources=sourceRows.filter(row=>UID.test(row?.uid)&&types.has(row.type)&&
      row.invisible===false&&typeof row.title==='string'&&Array.isArray(row.attr?.uid)&&
      row.attr.uid.every(id=>UID.test(id))).map(row=>({
        uid:row.uid,type:row.type,title:row.title,description:row.description??null,
        invisible:false,attr:{uid:[...row.attr.uid]},num:row.attr.uid.length}));
    return {scopes,sources};
  }catch{
    console.warn('LOC R2 structural snapshot unavailable');
    return null;
  }
}
export async function readDefaultKeywordTemplate(env={},getContext){
  return (await readRuntimeStructure(env,getContext))?.scopes?.lo3rwang||null;
}
// Only a typed missing relation or backend connectivity failure is degradable.
// Auth errors, invalid arguments and unknown programming failures stay errors.
export function isDataUnavailable(error){
  const code=String(error?.code||'');
  if(error?.httpStatus===401||error?.httpStatus===403)return false;
  return code==='BACKEND_UNAVAILABLE'||/^08[0-9A-Z]{3}$/.test(code)||
    ['42P01','3F000','57P01','57P02','57P03','53300','ECONNREFUSED',
     'ECONNRESET','ETIMEDOUT','ENOTFOUND','EPIPE','EHOSTUNREACH',
     'ENETUNREACH','CONNECT_TIMEOUT'].includes(code)||
    (error?.cause&&error.cause!==error&&isDataUnavailable(error.cause));
}
export function standaloneResult(result){
  return result&&typeof result==='object'&&!Array.isArray(result)
    ?{...result,runtimeMode:'standalone'}:result;
}
export function emptyGalaxyFeature(operation){
  if(operation.result==='count')return {total:0};
  if(operation.result==='earliest')return {earliest:null};
  if(operation.result==='uids')return {uids:[],hasMore:false,nextCursor:null};
  if(operation.result==='articles')return {rows:[],hasMore:false,nextCursor:null,
    totalCount:operation.includeTotal?0:null};
  return {rows:[]};
}
