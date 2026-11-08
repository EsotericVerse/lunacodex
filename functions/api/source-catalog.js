// Fixed-purpose LOC Source ZModel reader/writer on the existing Pages app.
// No generic SQL executor, no browser-supplied connection, schema or role.
// The native Kysely action enforces group-vs-Scope ownership in its transaction.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {sourceCatalogAction} from '../../app/loc/source-sql-service.mjs';
import {bindLocAuthorization} from '../../app/loc/providers/loc-authorization.mjs';
import {verifiedIdentity} from '../_loc-delegation.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const OPERATIONS=new Set(['read','save_scope','save_system']);
function reject(message,status=400){
  throw Object.assign(new Error(message),{httpStatus:status});
}
function respond(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}
function validate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>!['operation','scopeId','sources','names'].includes(k))||
     !OPERATIONS.has(input.operation)||!SCOPE.test(String(input.scopeId||'')))
    reject('Invalid Source operation');
  const {operation,scopeId}=input;
  if(operation==='read'){
    if(Object.hasOwn(input,'sources')||Object.hasOwn(input,'names'))reject('Unexpected Source data');
    return {name:'read_source_catalog',args:{p_scope_id:scopeId}};
  }
  if(operation==='save_system'){
    if(scopeId!=='loc'||Object.hasOwn(input,'sources')||
       !Array.isArray(input.names)||input.names.length>400||
       input.names.some(name=>typeof name!=='string'||!name.trim()||name.trim().length>80)||
       new Set(input.names.map(name=>name.normalize('NFKC').trim().toLowerCase())).size!==input.names.length)
      reject('Invalid LOC system source names');
    return {name:'update_group_default_article_class',
      args:{p_group_id:'loc',p_names:input.names.map(name=>name.trim())}};
  }
  if(scopeId==='loc'||Object.hasOwn(input,'names')||
     !Array.isArray(input.sources)||input.sources.length>400)
    reject('Invalid Scope Source entries');
  const entries=input.sources.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
       Object.keys(row).some(k=>!['uid','name','label'].includes(k))||
       typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>80||
       row.label!==undefined&&(typeof row.label!=='string'||row.label.trim().length>80)||
       row.uid!==undefined&&!UID.test(String(row.uid)))
      reject('Invalid Scope From entry');
    return {...(row.uid?{uid:row.uid}:{}),name:row.name.trim(),
      label:String(row.label||row.name).trim()};
  });
  if(new Set(entries.map(row=>row.name.normalize('NFKC').toLowerCase())).size!==entries.length)
    reject('Duplicate Scope From');
  return {name:'save_scope_sources',args:{p_scope_id:scopeId,p_sources:entries}};
}
export async function onRequestPost(context){
  try{
    const request=context.request;
    if(Number(request.headers.get('content-length')||0)>40000)
      reject('Source request too large',413);
    const raw=await request.text();
    if(raw.length>40000)reject('Source request too large',413);
    let input;try{input=JSON.parse(raw)}catch{reject('Invalid Source JSON')}
    const operation=validate(input);
    const {role,claims}=await verifiedIdentity(request,context.env);
    if(role!=='authenticated')reject('LOC Auth delegation required',401);
    const {db}=directMcpKysely(context.env);
    const result=await db.transaction().execute(async trx=>{
      bindLocAuthorization(trx,{role,claims});
      // The existing native action repeats the exact permission check on
      // this transaction before any configured Source table is read/written.
      if(operation.name==='read_source_catalog')
        return {data:await sourceCatalogAction(trx,operation.args),count:null};
      if(operation.name==='save_scope_sources')
        return {data:await sourceCatalogAction(trx,operation.args,true),count:null};
      // The global system array remains silver.loc.DefaultArticleClass until
      // LOC promotes Default to a physical Domain. This is its only writer.
      const names=operation.args.p_names;
      const {canManageLoc}=await import('../../app/loc/providers/loc-authorization.mjs');
      if(!await canManageLoc(trx,'group','loc'))
        reject('LOC Group edit permission required',403);
      const {sql}=await import('kysely');
      await sql`reset role`.execute(trx);
      const updated=await trx.updateTable('silver.loc')
        .set({DefaultArticleClass:JSON.stringify(names)})
        .where('id','=','loc').executeTakeFirst();
      if(Number(updated?.numUpdatedRows||0)!==1)
        reject('LOC system source update was not saved');
      return {data:true,count:null};
    });
    return respond({data:result.data});
  }catch(e){
    const status=Number.isInteger(e?.httpStatus)?e.httpStatus:
      Number.isInteger(e?.status)?e.status:503;
    return respond({error:status<500?String(e?.message||'Source request rejected'):
      'LOC 來源資料連線尚未就緒'},status);
  }
}
export function onRequestGet(){return respond({error:'POST required'},405);}
export function onRequestOptions(){return respond({error:'POST required'},405);}
