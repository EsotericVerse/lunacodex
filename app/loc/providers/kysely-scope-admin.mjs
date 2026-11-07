import {canManageLoc} from './loc-authorization.mjs';
import {sql} from 'npm:kysely@0.29.8';
import {schema as fixedSchema} from '../../../zenstack/schema.mjs';
import {normalizeLocDomain} from './loc-domain.mjs';

// Verify the physical Registry columns against LOC's frozen ZModel contract
// once at module load; never introspect the database per request.
function fixedColumns(model,fields){
  const actual=fixedSchema.models[model]?.fields;
  if(!actual||fields.some(field=>!Object.hasOwn(actual,field)))
    throw new Error('LOC ZModel / Registry SQL field mismatch');
  return Object.freeze(fields);
}
const REGISTRY_RETURNING=fixedColumns('Manage',
  ['id','domain','directory','parent_scope_id','active','sort_order','manage_role']);

const ID=/^[a-z][a-z0-9]{0,14}$/;
const DIR=/^[a-z0-9][a-z0-9/_-]*$/;
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
    }).returning(REGISTRY_RETURNING).executeTakeFirst();
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
    .returning(REGISTRY_RETURNING).executeTakeFirst();
  if(!updated)fail('Scope Registry update failed');
  const named=await trx.updateTable('silver.loc').set({display_name}).where('id','=',id).executeTakeFirst();
  if(Number(named?.numUpdatedRows||0)!==1)fail('Group / Scope list name missing');
  return resultRow(updated,display_name);
}
// Schema freeze: existing Scope Registry data may be edited; Scope creation or
// deletion cannot run because they require table/policy DDL.
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
  if(action!=='manage_scope_registry')
    fail('LOC database schema is frozen: Scope provisioning and deletion are unavailable',409);
  await allowedGlobal(trx);
  await sql`reset role`.execute(trx);
  return {data:await managedRegistry(trx,args),count:null};
}
