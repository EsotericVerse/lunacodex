import {sql} from 'npm:kysely@0.29.6';

const ID=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const DOMAIN=/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
const DIR=/^[a-z0-9][a-z0-9/_-]*$/;
function fail(message,status=400){throw Object.assign(new Error(message),{httpStatus:status});}
function scope(value){const id=String(value??'').trim().toLowerCase();
  if(!ID.test(id))fail('Invalid Scope ID');return id;}
async function allowedGlobal(trx){
  const check=await sql`select coalesce((select allowed from silver.manage('global')),false) as allowed`.execute(trx);
  if(check.rows[0]?.allowed!==true)fail('Global administrator permission required',403);
}
function route(values,existing={}){
  const domain=String(values.domain??existing.domain??'').trim().toLowerCase();
  let directory=String(values.directory??existing.directory??'').trim().toLowerCase();
  if(Boolean(domain)===Boolean(directory))fail('Exactly one domain or directory is required');
  if(domain&&!DOMAIN.test(domain))fail('Invalid route domain');
  if(directory){directory='/'+directory.replace(/^\/+|\/+$/g,'');
    if(!DIR.test(directory.slice(1)))fail('Invalid route directory');}
  return {domain:domain||null,directory:directory||null};
}
function resultRow(row){return {
  scope_id:row.id,display_name:row.display_name,
  scope_kind:row.manage_role==='group'?'group':row.manage_role==='system'?'system':'scope',
  domain:row.domain,directory:row.directory,parent_scope_id:row.parent_scope_id,
  active:row.active,sort_order:row.sort_order
};}
async function group(trx,id){
  const row=await trx.selectFrom('silver.manage').select(['id','manage_role','active'])
    .where('id','=',id).executeTakeFirst();
  if(row?.manage_role!=='group'||row.active!==true)
    fail('Parent Scope Group does not exist or is inactive');
  return row;
}
async function nextSort(trx,parent){
  const r=await trx.selectFrom('silver.manage')
    .select(sql`coalesce(max(sort_order),0)+10`.as('next'))
    .where('parent_scope_id','=',parent).executeTakeFirst();
  return Number(r?.next||10);
}
async function managedRegistry(trx,args){
  const operation=String(args.p_operation||'').trim().toLowerCase();
  const id=scope(args.p_scope_id),values=args.p_values??{};
  if(!values||typeof values!=='object'||Array.isArray(values))
    fail('Invalid Registry values');
  const existing=await trx.selectFrom('silver.manage').selectAll()
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
    const inserted=await trx.insertInto('silver.manage').values({
      id,display_name,domain,directory,parent_scope_id:parent,
      active,sort_order:sort,manage_role:'group'
    }).returning(['id','display_name','domain','directory','parent_scope_id',
      'active','sort_order','manage_role']).executeTakeFirst();
    if(!inserted)fail('Scope Group was not created');
    return resultRow(inserted);
  }
  if(operation!=='update'||!existing)fail('Scope Registry row missing or unsupported operation');
  if(existing.manage_role==='system')fail('System Registry is immutable');
  const display_name=String(values.display_name??existing.display_name??'').trim();
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
      const row=await trx.selectFrom('silver.manage').select('parent_scope_id')
        .where('id','=',current).executeTakeFirst();
      current=row?.parent_scope_id||null;
    }
  }
  if(existing.manage_role==='group'&&!active){
    const child=await trx.selectFrom('silver.manage').select('id')
      .where('parent_scope_id','=',id).where('active','=',true).executeTakeFirst();
    if(child)fail('Disable or move active Scope Group children first');
  }
  const updated=await trx.updateTable('silver.manage')
    .set({display_name,domain,directory,parent_scope_id:parent,
      active,sort_order:sort,updated_at:sql`now()`})
    .where('id','=',id)
    .returning(['id','display_name','domain','directory','parent_scope_id',
      'active','sort_order','manage_role']).executeTakeFirst();
  if(!updated)fail('Scope Registry update failed');
  return resultRow(updated);
}
async function existsRelation(trx,relation){
  const r=await sql`select to_regclass(${relation}) is not null as present`.execute(trx);
  return r.rows[0]?.present===true;
}
async function deleteScope(trx,args){
  const id=scope(args.p_scope_id);
  if(['loc','lrunes','lo3rwang','admin'].includes(id))fail('Built-in Scopes cannot be deleted');
  const row=await trx.selectFrom('silver.manage').select('manage_role')
    .where('id','=',id).forUpdate().executeTakeFirst();
  if(row?.manage_role!=='scope')fail('Only existing non-system Scopes may be deleted');
  const child=await trx.selectFrom('silver.manage').select('id')
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
  await trx.deleteFrom('silver.manage').where('id','=',id).executeTakeFirst();
  await sql`notify pgrst,'reload schema'`.execute(trx);
  return {scope_id:id,deleted:true};
}
async function nextUid(trx,scopeId){
  const response=await sql`select silver.new_keyword_tree_uid(${scopeId}) as uid`.execute(trx);
  const id=String(response.rows[0]?.uid||'');
  if(!UID.test(id))fail('Keyword UID allocator failed');
  return id;
}
async function copyDefaultKeywordClass(trx,id,target){
  const config=await trx.selectFrom('silver.lo3rwang')
    .select('current_keyword_class_uid').where('id','=','lo3rwang').executeTakeFirst();
  const src=String(config?.current_keyword_class_uid||'');
  if(!UID.test(src))fail('Default Keyword Class unavailable');
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
  const categoryId=await nextUid(trx,id),newClass=await nextUid(trx,id);
  await insert(categoryId,'category',category,{uid:[newClass]});
  const groupUids=[];let itemCount=0;
  for(const groupId of Array.isArray(root.attr?.uid)?root.attr.uid:[]){
    if(!UID.test(String(groupId)))fail('Source Group UID invalid');
    const groupRow=await trx.selectFrom(source)
      .select(['uid','title','description','attr'])
      .where('uid','=',groupId).where('type','=','group').executeTakeFirst();
    if(!groupRow)fail('Source Group missing');
    const mapped=[],newGroup=await nextUid(trx,id);
    for(const itemId of Array.isArray(groupRow.attr?.uid)?groupRow.attr.uid:[]){
      const item=await trx.selectFrom(source)
        .select(['uid','title','description','attr'])
        .where('uid','=',itemId).where('type','=','item').executeTakeFirst();
      if(!item)fail('Source Keyword Item missing');
      const newItem=await nextUid(trx,id);
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
  const {domain,directory}=route(args);
  if(!display||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
     theme!=='system-default'&&!/^theme-[1-8]$/.test(theme))
    fail('Invalid Scope owner, name, or theme');
  await group(trx,parent);
  if(await trx.selectFrom('silver.manage').select('id').where('id','=',id).executeTakeFirst())
    fail('Scope already exists');
  if(domain&&await trx.selectFrom('silver.manage').select('id')
    .where(sql`lower(domain)=${domain}`).executeTakeFirst())fail('Domain already allocated');
  if(directory&&await trx.selectFrom('silver.manage').select('id')
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
  await sql`create trigger sync_scope_display_name
    after insert or update of display_name on ${config}
    for each row execute function silver.sync_scope_config_display_name()`.execute(trx);
  await sql`alter table ${config} drop column if exists home_blocks`.execute(trx);
  await sql`alter table ${config} drop column if exists governance_blocks`.execute(trx);
  await sql`create table ${blocks} (like silver.lo3rwang_blocks including all)`.execute(trx);
  await sql`create table ${galaxy} (like silver.lo3rwang_galaxy including all)`.execute(trx);
  // New Scopes must never reintroduce the retired Galaxy.able column.
  await sql`alter table ${galaxy} drop column if exists able restrict`.execute(trx);
  await sql`create table ${anchor} (like silver.lrunes_anchor including all)`.execute(trx);
  for(const table of [config,galaxy,anchor,blocks])
    await sql`alter table ${table} enable row level security`.execute(trx);
  const owner=sql.lit(id);
  const can=sql`coalesce((select allowed from silver.manage('scope',${owner})),false)`;
  const policy=async(suffix,table,command,qual,check)=>{
    const name=sql.ref(id+suffix);
    await sql`create policy ${name} on ${table} ${sql.raw(command)}
      ${sql.raw(qual)} ${sql.raw(check||'')}`.execute(trx);
  };
  await policy('_config_public_read',config,
    'for select to anonymous,authenticated','using (true)');
  await policy('_config_scope_update',config,'for update to authenticated',
    'using ('+can.compile(trx).sql+')','with check ('+can.compile(trx).sql+')');
  await policy('_galaxy_public_read',galaxy,
    'for select to anonymous,authenticated','using (true)');
  await policy('_galaxy_scope_update',galaxy,'for update to authenticated',
    'using ('+can.compile(trx).sql+')','with check ('+can.compile(trx).sql+')');
  const publicType=sql.raw("type in ('date','period','era','point','path','trace','image','video','rune','suno') and invisible is false");
  await sql`create policy ${sql.ref(id+'_anchor_public_read')} on ${anchor}
    for select to anonymous,authenticated using (${publicType})`.execute(trx);
  await policy('_anchor_owner_read',anchor,'for select to authenticated',
    'using ('+can.compile(trx).sql+')');
  await policy('_anchor_owner_insert',anchor,'for insert to authenticated',
    'with check ('+can.compile(trx).sql+')');
  await policy('_anchor_owner_update',anchor,'for update to authenticated',
    'using ('+can.compile(trx).sql+')','with check ('+can.compile(trx).sql+')');
  await policy('_anchor_owner_delete',anchor,'for delete to authenticated',
    'using ('+can.compile(trx).sql+')');
  await policy('_blocks_public_read',blocks,
    'for select to anonymous,authenticated','using (true)');
  await policy('_blocks_scope_all',blocks,'for all to authenticated',
    'using ('+can.compile(trx).sql+')','with check ('+can.compile(trx).sql+')');
  for(const table of [config,galaxy,anchor,blocks]){
    await sql`grant select on ${table} to anonymous,authenticated`.execute(trx);
  }
  await sql`grant update on ${config} to authenticated`.execute(trx);
  await sql`grant update on ${galaxy} to authenticated`.execute(trx);
  for(const table of [anchor,blocks])
    await sql`grant insert,update,delete on ${table} to authenticated`.execute(trx);
  const sort=await nextSort(trx,parent);
  await trx.insertInto('silver.manage').values({
    id,display_name:display,email,domain,directory,parent_scope_id:parent,
    active:true,sort_order:sort,manage_role:'scope',birthday:args.p_birthday||null
  }).executeTakeFirst();
  const cloned=args.p_copy_keywords===false?null:await copyDefaultKeywordClass(trx,id,'silver.'+id+'_anchor');
  await trx.insertInto('silver.'+id).values({
    id,email,display_name:display,search_intro:'',search_aliases:[id,display],
    theme,locale:'zh-Hant',search_able:true,statistics_able:true,culture_able:true,
    keyword_min_chars:32,keyword_min_documents:100,
    current_keyword_class_uid:cloned?.uid||null,keyword_class_share_enabled:false,
    keyword_meta:sql`'{}'::jsonb`,staticstime:null,updated_at:sql`now()`
  }).executeTakeFirst();
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
