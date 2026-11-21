// LOC native public data service. No app framework, ORM, arbitrary SQL or
// client-selected relation names. The only runtime driver is PostgreSQL pg.
import {Client} from 'pg';
import {defineModel} from '../../modules/loc/core/model.mjs';
import {compileSelect,compileCount,compileGroupCount} from '../../modules/loc/core/sql.mjs';

const SCOPES=Object.freeze(['lo3rwang','lrunes']);
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:HEADERS});
const galaxy=scope=>defineModel({name:scope+'Galaxy',table:'silver.'+scope+'_galaxy',fields:{
  uid:{type:'text',primary:true},title:{type:'text'},content:{type:'text'},
  date:{type:'date'},createtime:{type:'date'},site:{type:'text'},
  place_id:{type:'text'},location:{type:'text'},
  search:{type:'boolean'},culture:{type:'boolean'},statics:{type:'boolean'},
  trace:{type:'boolean'}
}});
const anchor=scope=>defineModel({name:scope+'Anchor',table:'silver.'+scope+'_anchor',fields:{
  uid:{type:'text',primary:true},title:{type:'text'},
  type:{type:'text'},attr:{type:'json'},invisible:{type:'boolean'}
}});
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function requestParams(request){
  const url=new URL(request.url);
  const scope=url.searchParams.get('scope')||'loc';
  const kind=url.searchParams.get('kind')||'culture';
  const uid=url.searchParams.get('uid')||'';
  const search=(url.searchParams.get('q')||'').trim();
  const offset=Number(url.searchParams.get('offset')||0);
  const limit=Number(url.searchParams.get('limit')||40);
  if(!['loc',...SCOPES].includes(scope))throw error('Unknown LOC Scope');
  if(!['culture','statics','search','trace','overview','article'].includes(kind))
    throw error('Unknown LOC capability');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||
    !Number.isSafeInteger(offset)||offset<0||offset>10000)
    throw error('Invalid LOC pagination');
  if(search.length>120)throw error('LOC search input too long');
  if(kind==='article'&&(!SCOPES.includes(scope)||!/^[A-Za-z0-9]{8}$/.test(uid)))
    throw error('Invalid LOC article identity');
  return {scope,kind,search,uid,limit,offset};
}
function active(flag){
  return {column:flag,value:true};
}
async function readScope(db,scope,{kind,search,uid,limit,offset}){
  const model=galaxy(scope);
  const execute=async statement=>{
    const result=await db.query(statement.text,[...statement.params]);
    return result.rows;
  };
  if(kind==='overview'){
    const counts=await Promise.all(['search','culture','statics','trace'].map(async key=>{
      const result=await execute(compileCount(model,{where:active(key)}));
      return [key,Number(result[0]?.total||0)];
    }));
    return Object.fromEntries(counts);
  }
  if(kind==='culture'){
    const rows=await execute(compileGroupCount(model,{
      column:'date',where:{all:[active('culture'),{column:'date',operator:'ne',value:null}]}
    }));
    return rows.map(row=>({date:row.value instanceof Date?row.value.toISOString().slice(0,10):String(row.value||'').slice(0,10),total:Number(row.total||0)}));
  }
  if(kind==='statics'){
    const rows=await execute(compileGroupCount(model,{
      column:'site',where:active('statics')
    }));
    return rows.map(row=>({site:String(row.value||'未分類'),total:Number(row.total||0)}));
  }
  if(kind==='article'){
    const rows=await execute(compileSelect(model,{
      columns:['uid','title','content','date','createtime','site'],
      where:{all:[active('search'),{column:'uid',value:uid}]},limit:1
    }));
    return rows.map(row=>({...row,scope}));
  }
  if(kind==='search'){
    if(!search)return [];
    const where={all:[active('search'),{any:[
      {column:'title',operator:'like',value:'%'+search+'%'},
      {column:'content',operator:'like',value:'%'+search+'%'}
    ]}]};
    const rows=await execute(compileSelect(model,{
      columns:['uid','title','date','createtime','site'],
      where,orderBy:[{column:'createtime',descending:true}],limit,offset
    }));
    return rows.map(row=>({...row,scope}));
  }
  const points=await execute(compileSelect(model,{
    columns:['uid','title','date','location','place_id'],
    where:{all:[active('trace'),{column:'place_id',operator:'ne',value:null}]},
    orderBy:[{column:'createtime',descending:true}],limit,offset
  }));
  if(!points.length)return [];
  const ids=[...new Set(points.map(row=>row.place_id).filter(Boolean))];
  const places=await execute(compileSelect(anchor(scope),{
    columns:['uid','title','attr'],
    where:{all:[
      {column:'uid',operator:'in',value:ids},
      {column:'type',value:'point'},
      {column:'invisible',operator:'ne',value:true}
    ]}
  }));
  const lookup=new Map(places.map(place=>[place.uid,place]));
  return points.map(row=>{
    const place=lookup.get(row.place_id);
    const coordinates=place?.attr?.point??place?.attr??{};
    const latitude=Number(coordinates?.latitude),longitude=Number(coordinates?.longitude);
    return {...row,scope,
      place:place?.title||row.location||'',
      latitude:Number.isFinite(latitude)&&Math.abs(latitude)<=90?latitude:null,
      longitude:Number.isFinite(longitude)&&Math.abs(longitude)<=180?longitude:null};
  }).filter(row=>row.latitude!==null&&row.longitude!==null);
}
function aggregate(kind,records){
  if(kind==='overview'){
    const total={search:0,culture:0,statics:0,trace:0};
    for(const value of records)for(const key of Object.keys(total))total[key]+=value[key]||0;
    return total;
  }
  if(!['culture','statics'].includes(kind))return records.flat();
  const key=kind==='culture'?'date':'site';
  const merged=new Map();
  for(const rows of records)for(const row of rows){
    const value=row[key];
    merged.set(value,(merged.get(value)||0)+row.total);
  }
  return [...merged].map(([value,total])=>({[key]:value,total}))
    .sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
}
export async function onRequestGet({request,env}){
  let options;
  try{options=requestParams(request)}
  catch(cause){return respond({error:cause.message},cause.status||400)}
  const connectionString=String(env?.LOC_DATABASE_URI||'').trim();
  if(!connectionString)return respond({error:'LOC data source unavailable'},503);
  const client=new Client({connectionString,connectionTimeoutMillis:6000,
    ssl:{rejectUnauthorized:true}});
  try{
    await client.connect();
    const scopeIds=options.scope==='loc'?SCOPES:[options.scope];
    const results=[];
    for(const scope of scopeIds)results.push(await readScope(client,scope,options));
    return respond({scope:options.scope,kind:options.kind,
      data:aggregate(options.kind,results)});
  }catch(cause){
    // SQL text, credentials, and database errors are never returned to clients.
    console.error('LOC framework public read failed',cause?.code||cause?.name||'unknown');
    return respond({error:'LOC 資料暫時無法讀取'},503);
  }finally{
    await client.end().catch(()=>{});
  }
}
export function onRequest(){return respond({error:'GET required'},405)}
