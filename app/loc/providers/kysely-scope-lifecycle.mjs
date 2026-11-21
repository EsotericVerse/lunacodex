// LOC Scope lifecycle belongs to LOC's authenticated Kysely transaction.
// No legacy SECURITY DEFINER functions, RLS policies, schema migration,
// second connection, or client-selected SQL identifiers.
// Transactional PostgreSQL DDL creates the same four physical Scope models
// already expected by Galaxy/Anchor/Blocks/Config. Only server-side actions
// with global:manage may reach these functions.
import {sql} from 'kysely';
import {canLocAccess} from './loc-authorization.mjs';
import {allocateAnchorUid} from '../model/uid.js';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUILTIN=new Set(['admin','loc','lrunes','lo3rwang']);
const REGISTRY_FIELDS=['id','display_name','email','domain','directory',
  'parent_scope_id','manage_role','active','sort_order'];
const EDIT_FIELDS=new Set(['display_name','domain','directory',
  'parent_scope_id','active','sort_order']);

const reject=(message,status=400)=>{
  throw Object.assign(new Error(message),{httpStatus:status});
};
const scopeId=value=>{
  const id=String(value||'').trim().toLowerCase();
  if(!SCOPE.test(id))reject('Invalid LOC Scope ID');
  return id;
};
const text=value=>String(value??'').trim();
const nonEmptyName=value=>{
  const v=text(value);
  if(!v||v.length>120)reject('Scope display name must contain 1–120 characters');
  return v;
};
function route(domain,directory){
  const host=text(domain).toLowerCase(),prefix=text(directory).toLowerCase();
  if(Boolean(host)===Boolean(prefix))
    reject('Exactly one Domain or Directory must be configured');
  if(host&&!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host))
    reject('Invalid Scope Domain');
  const normalized=prefix?'/'+prefix.replace(/^\/+|\/+$/g,''):'';
  if(normalized&&!/^\/[a-z0-9][a-z0-9/_-]*$/.test(normalized))
    reject('Invalid Scope Directory');
  return {domain:host||null,directory:normalized||null};
}
const jsonb=value=>sql`${JSON.stringify(value)}::jsonb`;
const linked=node=>{
  const raw=node?.attr?.uid??[];
  return Array.isArray(raw)?raw.map(value=>text(value)):[];
};
const record=name=>sql.ref('silver.'+name);

function registered(rows,id){
  return rows.find(row=>row.id===id)||null;
}
function parentGroup(rows,id){
  const row=registered(rows,id);
  if(!row||row.manage_role!=='group'||row.active!==true)
    reject('Parent Scope Group is missing or inactive',409);
  return row;
}
function checkRouteUnique(rows,{domain,directory},except=''){
  if(rows.some(row=>row.id!==except&&(
    domain&&String(row.domain||'').toLowerCase()===domain||
    directory&&String(row.directory||'').toLowerCase()===directory)))
    reject('Scope Domain or Directory is already registered',409);
}
async function registryRows(trx){
  // Serializable is selected by the caller. Lock the existing Registry
  // records as well, so re-parenting cannot race with another deletion.
  return trx.selectFrom('api.manage')
    .select(REGISTRY_FIELDS).orderBy('id','asc').forUpdate().execute();
}
function requireGlobal(trx){
  if(!canLocAccess(trx,'global'))
    reject('LOC global management permission required',403);
}
function ensureObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    reject('Invalid LOC Scope values');
  return value;
}
function receipt(scope,name,routeInfo,extra={}){
  return {scope_id:scope,display_name:name,
    route_mode:routeInfo.domain?'domain':'directory',
    route_value:routeInfo.domain||routeInfo.directory,...extra};
}
async function updateSummary(trx,scope,name){
  const rows=await trx.updateTable('silver.loc')
    .set({display_name:name})
    .where('id','=',scope).returning('id').execute();
  if(rows.length>1)reject('Duplicate LOC Scope summary',409);
  if(!rows.length){
    // Legacy Registry Groups may have no silver.loc projection.
    await trx.insertInto('silver.loc').values({id:scope,display_name:name}).execute();
  }
}
function assertAllowedUpdate(values){
  for(const key of Object.keys(values))
    if(!EDIT_FIELDS.has(key))reject('Scope Registry field is immutable: '+key);
}
export async function manageScopeRegistryNative(trx,args){
  requireGlobal(trx);
  const operation=text(args.p_operation).toLowerCase();
  if(!['create_group','update'].includes(operation))
    reject('Unsupported Scope Registry operation');
  const id=scopeId(args.p_scope_id);
  const values=ensureObject(args.p_values);
  assertAllowedUpdate(values);
  const rows=await registryRows(trx);
  const current=registered(rows,id);
  if(operation==='create_group'&&current)reject('Scope ID already exists',409);
  if(operation==='update'&&!current)reject('Scope Registry row not found',404);
  if(operation==='update'&&current.manage_role==='system')
    reject('System Scope Registry cannot be edited',403);
  const name=nonEmptyName(values.display_name??current?.display_name);
  const target=route(values.domain!==undefined?values.domain:current?.domain,
    values.directory!==undefined?values.directory:current?.directory);
  checkRouteUnique(rows,target,operation==='update'?id:'');
  const parent=scopeId(values.parent_scope_id??current?.parent_scope_id??'loc');
  const active=values.active===undefined
    ?current?.active!==false:values.active;
  if(typeof active!=='boolean')reject('Invalid Scope active status');
  if(id==='loc'){
    if(operation!=='update'||values.parent_scope_id!==undefined||
      !active)reject('Root LOC Group cannot be moved or disabled',403);
  }else parentGroup(rows,parent);
  if(current?.manage_role==='group'){
    let cursor=parent;
    const visited=new Set();
    while(cursor&&cursor!=='loc'){
      if(cursor===id||visited.has(cursor))reject('Scope Group cycle',409);
      visited.add(cursor);
      cursor=registered(rows,cursor)?.parent_scope_id||'';
    }
    if(!active&&rows.some(row=>row.parent_scope_id===id&&row.active))
      reject('Cannot disable Group with active children',409);
  }
  const siblings=rows.filter(row=>row.parent_scope_id===parent&&row.id!==id);
  const requestedSort=values.sort_order;
  const sort=requestedSort===undefined
    ?operation==='update'?Number(current.sort_order):
      Math.max(0,...siblings.map(row=>Number(row.sort_order)||0))+10
    :requestedSort;
  if(!Number.isSafeInteger(sort)||sort<0)
    reject('Invalid Scope sort order');
  const fields={display_name:name,...target,parent_scope_id:id==='loc'?null:parent,
    active,sort_order:sort};
  if(operation==='create_group'){
    await trx.insertInto('api.manage').values({
      id,manage_role:'group',...fields
    }).execute();
    await trx.insertInto('silver.loc').values({id,display_name:name}).execute();
  }else{
    const saved=await trx.updateTable('api.manage').set(fields)
      .where('id','=',id).returning('id').execute();
    if(saved.length!==1)reject('Scope Registry UPDATE incomplete',409);
    await updateSummary(trx,id,name);
  }
  return receipt(id,name,target,{parent_scope_id:id==='loc'?null:parent,
    scope_kind:operation==='create_group'?'group':current.manage_role,
    active,sort_order:sort});
}

function keywordSource(rows,uid){
  const row=rows.find(value=>text(value.uid)===uid);
  if(!row)reject('Default Keyword Class is incomplete',409);
  return row;
}
async function copyDefaultKeywordClass(trx,target){
  const source=await trx.selectFrom('silver.lo3rwang')
    .select('current_keyword_class_uid').where('id','=','lo3rwang')
    .executeTakeFirst();
  const classUid=text(source?.current_keyword_class_uid);
  if(!classUid)reject('Default Keyword Class is not configured',409);
  const rows=await trx.selectFrom('silver.lo3rwang_anchor')
    .select(['uid','type','title','description','attr'])
    .where('type','in',['category','class','group','item']).execute();
  const root=keywordSource(rows,classUid);
  if(root.type!=='class')reject('Default Keyword Class type is invalid',409);
  const category=rows.find(row=>row.type==='category'&&linked(row).includes(classUid));
  if(!category)reject('Default Keyword Category is missing',409);
  const assigned=new Set(),insertions=[];
  const uid=()=>{const id=allocateAnchorUid(assigned);assigned.add(id);return id;};
  const categoryId=uid(),newClassId=uid(),groups=[];
  const add=(node,kind,id,attr)=>insertions.push({
    uid:id,type:kind,title:node.title,description:node.description,
    attr:jsonb(attr)
  });
  add(category,'category',categoryId,{uid:[newClassId]});
  for(const oldGroupId of linked(root)){
    const group=keywordSource(rows,oldGroupId);
    if(group.type!=='group')reject('Default Keyword Group mismatch',409);
    const groupId=uid(),items=[];
    groups.push(groupId);
    for(const oldItemId of linked(group)){
      const item=keywordSource(rows,oldItemId);
      if(item.type!=='item')reject('Default Keyword Item mismatch',409);
      const words=Array.isArray(item.attr?.keyword)?item.attr.keyword:[];
      if(words.some(word=>typeof word!=='string'))
        reject('Default Keyword Item contains invalid terms',409);
      const newItemId=uid();
      add(item,'item',newItemId,{keyword:words,total:0});
      items.push(newItemId);
    }
    add(group,'group',groupId,{uid:items,total:0});
  }
  add(root,'class',newClassId,{uid:groups});
  await trx.insertInto('silver.'+target+'_anchor')
    .values(insertions).execute();
  return {classUid:newClassId,items:insertions.filter(row=>row.type==='item').length};
}
export async function provisionScopeNative(trx,args){
  requireGlobal(trx);
  const scope=scopeId(args.p_scope_id);
  if(BUILTIN.has(scope))reject('Reserved LOC Scope',403);
  const name=nonEmptyName(args.p_display_name);
  const email=text(args.p_email).toLowerCase();
  if(!EMAIL.test(email)||email.length>254)
    reject('Invalid LOC Scope administrator email');
  const parent=scopeId(args.p_parent_scope_id||'loc');
  const target=route(args.p_domain,args.p_directory);
  const theme=text(args.p_theme||'system-default');
  if(theme!=='system-default'&&!/^theme-[1-8]$/.test(theme))
    reject('Invalid LOC Scope theme');
  const locale=text(args.p_locale||'zh-Hant');
  if(!['zh-Hant','zh-Hans','en','ja','ko'].includes(locale))
    reject('Invalid LOC Scope locale');
  const birthday=args.p_birthday;
  if(birthday!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(birthday)))
    reject('Invalid birthday');
  const copyKeywords=args.p_copy_keywords!==false;
  const rows=await registryRows(trx);
  if(registered(rows,scope))reject('Scope already exists',409);
  parentGroup(rows,parent);checkRouteUnique(rows,target);
  const sort=Math.max(0,...rows.filter(row=>row.parent_scope_id===parent)
    .map(row=>Number(row.sort_order)||0))+10;
  const models=['', '_blocks','_galaxy','_anchor'];
  const templates=['lo3rwang','lo3rwang_blocks',
    'lo3rwang_galaxy','lrunes_anchor'];
  // One catalog SELECT, all four CREATE TABLE operations within this same
  // PostgreSQL transaction. No RLS policies, public GRANTs or DB functions.
  const existing=await sql`select relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='silver' and c.relname in
      (${sql.join(models.map(suffix=>sql`${scope+suffix}`))})`
    .execute(trx);
  if(existing.rows.length)reject('Scope data relation already exists',409);
  for(let i=0;i<models.length;i++)
    await sql`create table ${record(scope+models[i])}
      (like ${record(templates[i])} including all)`.execute(trx);
  let classUid=null,keywordCount=0;
  if(copyKeywords){
    const copied=await copyDefaultKeywordClass(trx,scope);
    classUid=copied.classUid;keywordCount=copied.items;
  }
  await trx.insertInto('silver.'+scope).values({
    id:scope,display_name:name,theme,locale,
    search_intro:'',search_aliases:[scope,name],
    search:true,statics:true,culture:true,trace:true,
    keyword_min_chars:32,keyword_min_documents:100,
    current_keyword_class_uid:classUid
  }).execute();
  await trx.insertInto('silver.loc').values({
    id:scope,display_name:name,
    ...(birthday?{birthday}: {})
  }).execute();
  await trx.insertInto('api.manage').values({
    id:scope,display_name:name,email,
    ...target,parent_scope_id:parent,active:true,
    sort_order:sort,manage_role:'scope',
    galaxy_table:'galaxy',anchor_table:'anchor'
  }).execute();
  return receipt(scope,name,target,{
    parent_scope_id:parent,keyword_rows:keywordCount,
    keyword_class_uid:classUid,locale,created:true});
}

export async function deleteScopeNative(trx,args){
  requireGlobal(trx);
  const scope=scopeId(args.p_scope_id);
  if(BUILTIN.has(scope))reject('Built-in LOC Scope cannot be deleted',403);
  const rows=await registryRows(trx);
  const current=registered(rows,scope);
  if(!current||current.manage_role!=='scope')
    reject('Only an existing non-system Scope may be deleted',404);
  if(rows.some(row=>row.parent_scope_id===scope))
    reject('Scope has child Registry entries',409);
  const suffixes=['_anchor','_galaxy_media','_trace','_time','_keywords',
    '_place','_galaxy','_blocks',''];
  const names=suffixes.map(suffix=>scope+suffix);
  const existing=await sql`select c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='silver' and c.relname in
      (${sql.join(names.map(name=>sql`${name}`))})`.execute(trx);
  const present=new Set(existing.rows.map(row=>row.relname));
  if(!present.has(scope)||!present.has(scope+'_galaxy')||
    !present.has(scope+'_blocks')||
    !['anchor','keywords'].some(type=>present.has(scope+'_'+type)))
    reject('Scope data relation missing; refusing partial deletion',409);
  for(const name of names)if(present.has(name))
    await sql`drop table ${record(name)} restrict`.execute(trx);
  const registryDeleted=await trx.deleteFrom('api.manage')
    .where('id','=',scope).where('manage_role','=','scope')
    .returning('id').execute();
  if(registryDeleted.length!==1)reject('Scope Registry deletion incomplete',409);
  const summary=await trx.deleteFrom('silver.loc').where('id','=',scope')
    .returning('id').execute();
  if(summary.length>1)reject('Scope summary deletion incomplete',409);
  return {scope_id:scope,deleted:true,tables_removed:present.size};
}
