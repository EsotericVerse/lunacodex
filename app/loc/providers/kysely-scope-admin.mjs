import {canManageLoc} from './loc-authorization.mjs';
import {allocateAnchorUid} from '../unified-anchor-compat.mjs';
import {sql} from 'npm:kysely@0.29.8';
import {schema as fixedSchema} from '../../../zenstack/schema.mjs';
import {normalizeLocDomain} from './loc-domain.mjs';

const ID=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const DIR=/^[a-z0-9][a-z0-9/_-]*$/;

// Fixed LOC Registry models come from the same ZModel-backed schema contract as
// the ZenStack client. Dynamic Scope relations remain trusted Kysely paths.
const FIXED_MODELS=Object.freeze({manage:fixedSchema.models.Manage,loc:fixedSchema.models.Loc});
function modelFields(model,fields){
  if(!model||fields.some(field=>!Object.hasOwn(model.fields,field)))
    throw new Error('LOC fixed ZModel / Kysely field contract mismatch');
  return fields;
}
const MANAGE_ROUTE_FIELDS=modelFields(FIXED_MODELS.manage,
  ['id','domain','directory','parent_scope_id','active','sort_order','manage_role']);
const LOC_NAME_FIELDS=modelFields(FIXED_MODELS.loc,['id','display_name','locale','birthday']);
function fail(message,status=400){throw Object.assign(new Error(message),{httpStatus:status});}
function scope(value){const id=String(value??'').trim().toLowerCase();
  if(!ID.test(id))fail('Invalid Scope ID');return id;}
async function allowedGlobal(trx){
  if(!await canManageLoc(trx,'global'))fail('Global administrator permission required',403);
}
function route(values,existing={}){
  const domain=normalizeLocDomain(values.domain??existing.domain??null)||'';
  let directory=String(values.directory??existing.directory??'').trim().toLowerCase();
  if(Boolean(domain)===Boolean(directory))fail('Exactly one domain or directory is required');
  if(directory){directory='/'+directory.replace(/^\/+|\/+$/g,'');
    if(!DIR.test(directory.slice(1)))fail('Invalid route directory');}
  return {domain:domain||null,directory:directory||null};
}
function resultRow(row,name=''){return {
  scope_id:row.id,display_name:name||row.display_name||row.id,
  scope_kind:row.manage_role==='group'?'group':row.manage_role==='system'?'system':'scope',
  domain:row.domain,directory:row.directory,parent_scope_id:row.parent_scope_id,
  active:row.active,sort_order:row.sort_order
};}
async function group(trx,id){
  const row=await trx.selectFrom('api.manage').select(['id','manage_role','active'])
    .where('id','=',id).executeTakeFirst();
  if(row?.manage_role!=='group'||row.active!==true)
    fail('Parent Scope Group does not exist or is inactive');
  return row;
}
async function nextSort(trx,parent){
  const r=await trx.selectFrom('api.manage')
    .select(sql`coalesce(max(sort_order),0)+10`.as('next'))
    .where('parent_scope_id','=',parent).executeTakeFirst();
  return Number(r?.next||10);
}
async function managedRegistry(trx,args){
  const operation=String(args.p_operation||'').trim().toLowerCase();
  const id=scope(args.p_scope_id),values=args.p_values??{};
  if(!values||typeof values!=='object'||Array.isArray(values))
    fail('Invalid Registry values');
  const existing=await trx.selectFrom('api.manage').selectAll()
    .where('id','=',id).forUpdate().executeTakeFirst();
  if(operation==='create_group'){
    if(existing)fail('Scope Registry ID already exists');
    const display_name=String(values.display_name||'').trim();
    if(!display_name)fail('Group display name required');
    const {domain,directory}=route(values);
    const parent=scope(values.parent_scope_id??'loc');
    await group(trx,parent);
    const active=values.active===undefined?true:values.active===true;
    const sort=Object.hasOwn(values,'sort_order')
      ?Number(values.sort_order)||0:await nextSort(trx,parent);
    const inserted=await trx.insertInto('api.manage').values({
      id,domain,directory,parent_scope_id:parent,
      active,sort_order:sort,manage_role:'group'
    }).returning(MANAGE_ROUTE_FIELDS).executeTakeFirst();
    if(!inserted)fail('Scope Group was not created');
    await trx.insertInto('silver.loc').values({id,display_name,locale:'zh-Hant'}).executeTakeFirst();
    return resultRow(inserted,display_name);
  }
  if(operation!=='update'||!existing)fail('Scope Registry row missing or unsupported operation');
  if(existing.manage_role==='system')fail('System Registry is immutable');
  const nameRow=await trx.selectFrom('silver.loc').select('display_name')
    .where('id','=',id).executeTakeFirst();
  const display_name=String(values.display_name??nameRow?.display_name??id).trim();
  if(!display_name)fail('Scope display name is required');
  const {domain,directory}=route(values,existing);
  const parentText=values.parent_scope_id===undefined
    ?String(existing.parent_scope_id||''):String(values.parent_scope_id||'').trim().toLowerCase();
  const parent=parentText?scope(parentText):null;
  const active=values.active===undefined?existing.active:values.active===true;
  const sort=Object.hasOwn(values,'sort_order')
    ?Number(values.sort_order)||0:existing.sort_order;
  if(id==='loc'){
    if(parent||!active)fail('LOC root Group must remain active and parentless');
  }else{
    if(!parent||parent===id)fail('Scope must have a different parent Group');
    await group(trx,parent);
  }
  if(existing.manage_role==='group'&&parent){
    const visited=new Set();
    let current=parent;
    while(current){
      if(current===id||visited.has(current))fail('Scope Group hierarchy cycle');
      visited.add(current);
      const row=await trx.selectFrom('api.manage').select('parent_scope_id')
        .where('id','=',current).executeTakeFirst();
      current=row?.parent_scope_id||null;
    }
  }
  if(existing.manage_role==='group'&&!active){
    const child=await trx.selectFrom('api.manage').select('id')
      .where('parent_scope_id','=',id).where('active','=',true).executeTakeFirst();
    if(child)fail('Disable or move active Scope Group children first');
  }
  const updated=await trx.updateTable('api.manage')
    .set({domain,directory,parent_scope_id:parent,active,sort_order:sort})
    .where('id','=',id)
    .returning(MANAGE_ROUTE_FIELDS).executeTakeFirst();
  if(!updated)fail('Scope Registry update failed');
  const named=await trx.updateTable('silver.loc').set({display_name}).where('id','=',id).executeTakeFirst();
  if(Number(named?.numUpdatedRows||0)!==1)fail('Group / Scope list name missing');
  return resultRow(updated,display_name);
}
async function existsRelation(trx,relation){
  const r=await sql`select to_regclass(${relation}) is not null as present`.execute(trx);
  return r.rows[0]?.present===true;
}
async function deleteScope(trx,args){
  const id=scope(args.p_scope_id);
  if(['loc','lrunes','lo3rwang','admin'].includes(id))fail('Built-in Scopes cannot be deleted');
  const row=await trx.selectFrom('api.manage').select('manage_role')
    .where('id','=',id).forUpdate().executeTakeFirst();
  if(row?.manage_role!=='scope')fail('Only existing non-system Scopes may be deleted');
  const child=await trx.selectFrom('api.manage').select('id')
    .where('parent_scope_id','=',id).executeTakeFirst();
  if(child)fail('Scope has child Registry entries');
  const anchor=await existsRelation(trx,'silver.'+id+'_anchor');
  const old=await existsRelation(trx,'silver.'+id+'_keywords');
  if(!anchor&&!old)fail('Scope metadata relation missing');
  for(const suffix of ['_anchor','_galaxy_media','_trace','_time',
    '_keywords','_place','_galaxy','_blocks','']){
    const relation='silver.'+id+suffix;
    if(await existsRelation(trx,relation)){
      await sql`drop table ${sql.ref(relation)} restrict`.execute(trx);
    }else if(['_galaxy','_blocks',''].includes(suffix)){
      fail('Required Scope relation missing: '+relation);
    }
  }
  await trx.deleteFrom('api.manage').where('id','=',id).executeTakeFirst();
  await trx.deleteFrom('silver.loc').where('id','=',id).executeTakeFirst();
  await sql`notify pgrst,'reload schema'`.execute(trx);
  return {scope_id:id,deleted:true};
}
async function copyDefaultKeywordClass(trx,id,target){
  const config=await trx.selectFrom('silver.lo3rwang')
    .select('current_keyword_class_uid').where('id','=','lo3rwang').executeTakeFirst();
  const src=String(config?.current_keyword_class_uid||'');
  if(!UID.test(src))fail('Default Keyword Class unavailable');
  // The target Anchor was just created by provisionScope, so there are no
  // existing target UIDs to fetch. Reserve only this copy's generated UIDs.
  const assigned=new Set();
  const nextUid=()=>{
    const uid=allocateAnchorUid(assigned);
    assigned.add(uid);
    return uid;
  };
  const source='silver.lo3rwang_anchor';
  const root=await trx.selectFrom(source).select(['uid','title','description','attr'])
    .where('uid','=',src).where('type','=','class').executeTakeFirst();
  if(!root)fail('Source Keyword Class missing');
  const category=await trx.selectFrom(source).select(['title','description'])
    .where('type','=','category')
    .where(sql`attr->'uid' ? ${src}`).executeTakeFirst();
  if(!category)fail('Source Keyword Category missing');
  const insert=async(uid,type,row,attr)=>{
    await trx.insertInto(target).values({uid,type,title:row.title,
      description:row.description,attr:sql`${JSON.stringify(attr)}::jsonb`})
      .executeTakeFirst();
  };
  const categoryId=nextUid(),newClass=nextUid();
  await insert(categoryId,'category',category,{uid:[newClass]});
  const groupUids=[];let itemCount=0;
  for(const groupId of Array.isArray(root.attr?.uid)?root.attr.uid:[]){
    if(!UID.test(String(groupId)))fail('Source Group UID invalid');
    const groupRow=await trx.selectFrom(source)
      .select(['uid','title','description','attr'])
      .where('uid','=',groupId).where('type','=','group').executeTakeFirst();
    if(!groupRow)fail('Source Group missing');
    const mapped=[],newGroup=nextUid();
    for(const itemId of Array.isArray(groupRow.attr?.uid)?groupRow.attr.uid:[]){
      const item=await trx.selectFrom(source)
        .select(['uid','title','description','attr'])
        .where('uid','=',itemId).where('type','=','item').executeTakeFirst();
      if(!item)fail('Source Keyword Item missing');
      const newItem=nextUid();
      await insert(newItem,'item',item,{keyword:Array.isArray(item.attr?.keyword)
        ?item.attr.keyword:[],total:0});
      mapped.push(newItem);itemCount++;
    }
    await insert(newGroup,'group',groupRow,{uid:mapped,total:0});
    groupUids.push(newGroup);
  }
  await insert(newClass,'class',root,{uid:groupUids});
  return {uid:newClass,count:itemCount};
}
async function provisionScope(trx,args){
  const id=scope(args.p_scope_id);
  const display=String(args.p_display_name||'').trim();
  const email=String(args.p_email||'').trim().toLowerCase();
  const theme=String(args.p_theme||'system-default').trim().toLowerCase();
  const parent=scope(args.p_parent_scope_id??'loc');
  const {domain,directory}=route({domain:args.p_domain,directory:args.p_directory});
  if(!display||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
     theme!=='system-default'&&!/^theme-[1-8]$/.test(theme))
    fail('Invalid Scope owner, name, or theme');
  await group(trx,parent);
  if(await trx.selectFrom('api.manage').select('id').where('id','=',id).executeTakeFirst())
    fail('Scope already exists');
  if(domain&&await trx.selectFrom('api.manage').select('id')
    .where(sql`lower(domain)=${domain}`).executeTakeFirst())fail('Domain already allocated');
  if(directory&&await trx.selectFrom('api.manage').select('id')
    .where(sql`lower(directory)=${directory}`).executeTakeFirst())fail('Directory already allocated');
  const variants=[id,id+'_galaxy',id+'_galaxy_media',id+'_time',
    id+'_keywords',id+'_blocks',id+'_anchor'];
  for(const name of variants)if(await existsRelation(trx,'silver.'+name))
    fail('Scope relation already exists');
  const config=sql.ref('silver.'+id);
  const galaxy=sql.ref('silver.'+id+'_galaxy');
  const anchor=sql.ref('silver.'+id+'_anchor');
  const blocks=sql.ref('silver.'+id+'_blocks');
  await sql`create table ${config} (like silver.lo3rwang including all)`.execute(trx);
  // LOC owns display-name synchronisation in the same Kysely transaction
  // (managedRegistry / provisionScope). Do not attach a vendor SQL trigger.
  await sql`alter table ${config} drop column if exists home_blocks`.execute(trx);
  await sql`alter table ${config} drop column if exists governance_blocks`.execute(trx);
  await sql`create table ${blocks} (like silver.lo3rwang_blocks including all)`.execute(trx);
  await sql`create table ${galaxy} (like silver.lo3rwang_galaxy including all)`.execute(trx);
  // New Scopes must never reintroduce the retired Galaxy.able column.
  await sql`alter table ${galaxy} drop column if exists able restrict`.execute(trx);
  await sql`create table ${anchor} (like silver.lrunes_anchor including all)`.execute(trx);
  for(const table of [config,galaxy,anchor,blocks])
    await sql`alter table ${table} enable row level security`.execute(trx);
  // PostgreSQL compatibility boundary only: the trusted Kysely Gateway
  // has verified an LOC-issued delegation and bound its grants to this SQL
  // transaction. Other SQL dialects authorize in LOC/Kysely before execution.
  // New Scope policies must NOT call api.manage() or any database Auth RPC.
  const canUseScope=sql`coalesce(
    (current_setting('request.jwt.claims',true)::jsonb -> 'grants')
       ? ${sql.lit(id+':manage')}
    or (current_setting('request.jwt.claims',true)::jsonb -> 'grants')
       ? 'global:manage',false)`;
  await sql`create policy ${sql.ref(id+'_config_public_read')} on ${config}
    for select to anonymous,authenticated using (true)`.execute(trx);
  await sql`create policy ${sql.ref(id+'_config_scope_update')} on ${config}
    for update to authenticated using (${canUseScope}) with check (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_galaxy_public_read')} on ${galaxy}
    for select to anonymous,authenticated using (true)`.execute(trx);
  await sql`create policy ${sql.ref(id+'_galaxy_scope_update')} on ${galaxy}
    for update to authenticated using (${canUseScope}) with check (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_anchor_public_read')} on ${anchor}
    for select to anonymous,authenticated
    using (type in ('date','period','era','point','path','trace',
      'image','video','rune','suno') and invisible is false)`.execute(trx);
  await sql`create policy ${sql.ref(id+'_anchor_owner_read')} on ${anchor}
    for select to authenticated using (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_anchor_owner_insert')} on ${anchor}
    for insert to authenticated with check (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_anchor_owner_update')} on ${anchor}
    for update to authenticated using (${canUseScope}) with check (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_anchor_owner_delete')} on ${anchor}
    for delete to authenticated using (${canUseScope})`.execute(trx);
  await sql`create policy ${sql.ref(id+'_blocks_public_read')} on ${blocks}
    for select to anonymous,authenticated using (true)`.execute(trx);
  await sql`create policy ${sql.ref(id+'_blocks_scope_all')} on ${blocks}
    for all to authenticated using (${canUseScope}) with check (${canUseScope})`.execute(trx);
  for(const table of [config,galaxy,anchor,blocks]){
    await sql`grant select on ${table} to anonymous,authenticated`.execute(trx);
  }
  await sql`grant update on ${config} to authenticated`.execute(trx);
  await sql`grant update on ${galaxy} to authenticated`.execute(trx);
  for(const table of [anchor,blocks])
    await sql`grant insert,update,delete on ${table} to authenticated`.execute(trx);
  const sort=await nextSort(trx,parent);
  await trx.insertInto('api.manage').values({
    id,email,domain,directory,parent_scope_id:parent,
    active:true,sort_order:sort,manage_role:'scope'
  }).executeTakeFirst();
  const cloned=args.p_copy_keywords===false?null:await copyDefaultKeywordClass(trx,id,'silver.'+id+'_anchor');
  await trx.insertInto('silver.'+id).values({
    id,email,display_name:display,search_intro:'',search_aliases:[id,display],
    theme,locale:'zh-Hant',search:true,statics:true,culture:true,trace:true,
    keyword_min_chars:32,keyword_min_documents:100,
    current_keyword_class_uid:cloned?.uid||null,keyword_class_share_enabled:false,
    keyword_meta:sql`'{}'::jsonb`,staticstime:null,updated_at:sql`now()`
  }).executeTakeFirst();
  await trx.insertInto('silver.loc').values(Object.fromEntries(
    LOC_NAME_FIELDS.map(field=>[field,({
      id,display_name:display,locale:'zh-Hant',birthday:args.p_birthday||null
    })[field]]))).executeTakeFirst();
  await sql`notify pgrst,'reload schema'`.execute(trx);
  return {scope_id:id,display_name:display,parent_scope_id:parent,
    route_mode:domain?'domain':'directory',route_value:domain||directory,
    keyword_rows:cloned?.count||0,keyword_class_uid:cloned?.uid||null};
}
export async function executeKyselyScopeAdmin(trx,body){
  const action=String(body?.name||''),args=body?.args??{};
  const options={
    manage_scope_registry:['p_operation','p_scope_id','p_values'],
    provision_scope:['p_scope_id','p_display_name','p_email','p_birthday',
      'p_domain','p_directory','p_parent_scope_id','p_theme','p_copy_keywords'],
    delete_scope:['p_scope_id']
  };
  if(!options[action]||!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(k=>!options[action].includes(k)))
    fail('Unknown Scope administration action');
  await allowedGlobal(trx);
  await sql`reset role`.execute(trx);
  if(action==='manage_scope_registry')return {data:await managedRegistry(trx,args),count:null};
  if(action==='delete_scope')return {data:await deleteScope(trx,args),count:null};
  return {data:await provisionScope(trx,args),count:null};
}
