import {sql} from 'npm:kysely@0.29.6';

const ID=/^[a-z][a-z0-9_]*$/i;
const UID=/^[A-Za-z0-9]{8}$/;
const SCOPED_SUFFIXES=['_galaxy_media','_galaxy','_anchor','_blocks'];

function reject(message,status=400){
  const error=new Error(message);
  error.httpStatus=status;
  throw error;
}
function tableName(value){
  const match=String(value||'').match(/^silver\.([a-z][a-z0-9_]*)$/i);
  if(!match)reject('Invalid managed relation');
  return match[1];
}
function validateRows(value){
  if(!Array.isArray(value)||!value.length||value.length>10000)reject('Invalid managed rows');
  for(const row of value){
    if(!row||typeof row!=='object'||Array.isArray(row)||!Object.keys(row).length||
       Object.keys(row).some(key=>!ID.test(key)))reject('Invalid managed row');
  }
  return value;
}
function validateFilters(value){
  if(!Array.isArray(value)||!value.length||value.length>20)reject('Managed write requires filters');
  for(const filter of value){
    if(!filter||typeof filter!=='object'||!ID.test(filter.column)||
       (filter.operator||'eq')!=='eq')reject('Invalid managed filter');
  }
  return value;
}
function withFilters(query,filters){
  for(const filter of filters){
    query=query.where(filter.column,filter.value===null?'is':'=',filter.value);
  }
  return query;
}
async function canManage(trx,type,scope=''){
  const response=type==='global'
    ?await sql`select coalesce((select allowed from silver.manage('global')),false) as allowed`.execute(trx)
    :await sql`select coalesce((select allowed from silver.manage(${type},${scope})),false) as allowed`.execute(trx);
  return response.rows[0]?.allowed===true;
}
function scopeFromTable(table){
  for(const suffix of SCOPED_SUFFIXES){
    if(table.endsWith(suffix))return table.slice(0,-suffix.length);
  }
  return table;
}
async function authorizeRelation(trx,table,operation,values,filters,rows){
  if(table==='manage'||table==='loc'){
    if(!await canManage(trx,'global'))reject('Global management permission required',403);
    return;
  }
  if(table==='loc_blocks'){
    const global=await canManage(trx,'global');
    if(global)return;
    if(!await canManage(trx,'group','loc'))reject('LOC Group management permission required',403);
    if(operation==='insert'){
      if(rows.some(row=>row.page_name!=='index'))reject('Group may insert homepage blocks only',403);
    }else if(operation==='update'||operation==='delete'){
      if(filters.length!==1||filters[0].column!=='uid'||
        operation==='update'&&values.page_name!=='index')
        reject('Group may edit homepage blocks only',403);
      const existing=await trx.selectFrom('silver.loc_blocks').select('uid')
        .where('uid','=',filters[0].value).where('page_name','=','index').executeTakeFirst();
      if(!existing)reject('Group may edit homepage blocks only',403);
    }else reject('Group blocks do not support this operation',403);
    return;
  }
  const scope=scopeFromTable(table);
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||!await canManage(trx,'scope',scope))
    reject('Scope management permission required',403);
  // Verify the dynamic registry mapping before escalating to the trusted
  // server connection. Caller input can never pick an arbitrary table.
  const registry=await sql`select id,manage_role,galaxy_table,anchor_table
    from silver.manage where id=${scope} limit 1`.execute(trx);
  const record=registry.rows[0];
  if(!record||record.manage_role!=='scope')reject('Scope is not registered',403);
  const galaxy=String(record.galaxy_table||'galaxy');
  const anchor=String(record.anchor_table||'anchor');
  if(!ID.test(galaxy)||!ID.test(anchor))reject('Scope registry is invalid',403);
  const allowed=new Set([scope,scope+'_blocks',scope+'_'+galaxy,
    scope+'_'+galaxy+'_media',scope+'_'+anchor]);
  if(!allowed.has(table))reject('Relation is not managed by this Scope',403);
}
async function writeBatch(trx,table,rows){
  if(!/^[a-z][a-z0-9_]*_galaxy$/.test(table))reject('Article batch updates require a Galaxy table');
  if(!Array.isArray(rows)||rows.length>10000)reject('Invalid article batch size');
  if(!rows.length)return 0;
  const supported=new Set(['uid','title','content','place_id','url','media_link']);
  const seen=new Set();
  for(const row of validateRows(rows)){
    if(!UID.test(String(row.uid||''))||!Object.keys(row).some(k=>k!=='uid')||
      Object.keys(row).some(k=>!supported.has(k))||seen.has(row.uid))
      reject('Invalid article update batch');
    seen.add(row.uid);
  }
  const ref=sql.ref('silver.'+table);
  const media=sql`(jsonb_populate_record(NULL::${ref},j.item)).media_link`;
  const result=await sql`
    update ${ref} as g set
      title=case when j.item ? 'title' then j.item->>'title' else g.title end,
      content=case when j.item ? 'content' then j.item->>'content' else g.content end,
      place_id=case when coalesce(btrim(g.place_id),'')=''
        then coalesce(nullif(btrim(j.item->>'place_id'),''),g.place_id) else g.place_id end,
      url=case when j.item ? 'url' then j.item->>'url' else g.url end,
      media_link=case when j.item ? 'media_link' then ${media} else g.media_link end,
      "UpdateTime"=now()
    from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) as j(item)
    where g.uid=(j.item->>'uid')::char(8) and (
      (j.item ? 'title' and g.title is distinct from j.item->>'title')
      or (j.item ? 'content' and g.content is distinct from j.item->>'content')
      or (j.item ? 'place_id' and coalesce(btrim(g.place_id),'')=''
        and nullif(btrim(j.item->>'place_id'),'') is not null)
      or (j.item ? 'url' and g.url is distinct from j.item->>'url')
      or (j.item ? 'media_link' and g.media_link is distinct from ${media})
    )
  `.execute(trx);
  return Number(result.numAffectedRows||0);
}
export async function executeManagedKyselyWrite(trx,body){
  const payload=body?.payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    reject('Invalid managed write payload');
  const table=tableName(payload.p_table);
  const operation=payload.p_operation;
  if(!['insert','update','delete','update_batch'].includes(operation))
    reject('Invalid managed write operation');
  const rows=operation==='insert'?validateRows(payload.p_rows):[];
  const values=payload.p_values;
  const filters=['update','delete'].includes(operation)?validateFilters(payload.p_filters):[];
  if(operation==='update'&&(!values||typeof values!=='object'||Array.isArray(values)||
    !Object.keys(values).length||Object.keys(values).some(key=>!ID.test(key)||key==='uid'||key==='id')))
    reject('Invalid managed update values');
  if(operation==='update_batch'&&table.endsWith('_galaxy')===false)
    reject('Article batches must target a Galaxy table');
  await authorizeRelation(trx,table,operation,values,filters,rows);
  // Above checks execute as the verified Clerk principal. Only after Scope
  // authorization is proved do trusted server-side Kysely mutations run
  // with the connection's original role (same privilege as old definer RPC).
  await sql`reset role`.execute(trx);
  const name='silver.'+table;
  if(operation==='update'){
    const pk=await sql`select a.attname as name from pg_index i
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indrelid=${name}::regclass and i.indisprimary`.execute(trx);
    if(pk.rows.some(row=>Object.hasOwn(values,String(row.name))))
      reject('Primary keys cannot be updated');
  }
  let count=0;
  if(operation==='update_batch')count=await writeBatch(trx,table,payload.p_rows);
  else if(operation==='insert'){
    const groups=[];
    for(const row of rows){
      const keys=Object.keys(row).sort().join('\0');
      const last=groups[groups.length-1];
      if(last?.keys===keys)last.rows.push(row);
      else groups.push({keys,rows:[row]});
    }
    for(const group of groups){
      const columns=Object.keys(group.rows[0]);
      const columnRefs=columns.map(column=>sql.ref(column));
      const relation=sql.ref(name);
      // One typed JSONB parameter, rather than thousands of bound values:
      // preserves defaults and avoids PostgreSQL's 65,535-parameter ceiling.
      const result=await sql`insert into ${relation} (${sql.join(columnRefs)})
        select ${sql.join(columnRefs)} from
        jsonb_populate_recordset(NULL::${relation},${JSON.stringify(group.rows)}::jsonb)`
        .execute(trx);
      count+=Number(result.numAffectedRows||0);
    }
  }else{
    const base=operation==='update'?trx.updateTable(name).set(values):trx.deleteFrom(name);
    const result=await withFilters(base,filters).execute();
    count=Number(result[0]?.numUpdatedRows??result[0]?.numDeletedRows??result[0]?.numAffectedRows??0);
  }
  return {data:{count},count:null};
}

const ACTIONS=new Set(['read_group_members','update_group_member_name',
  'update_group_default_article_class','is_current_email_blocklisted','move_scope_block']);
function validScope(value){
  const id=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(id))reject('Invalid Scope ID');
  return id;
}
function validUid(value){
  const uid=String(value||'').trim();
  if(!UID.test(uid))reject('Invalid block UID');
  return uid;
}
export async function executeManagedKyselyAction(trx,body,claims={}){
  const name=String(body?.name||'');
  if(!ACTIONS.has(name)||!body.args||typeof body.args!=='object'||
    Array.isArray(body.args))reject('Unknown Kysely action');
  const args=body.args;
  const keys={
    read_group_members:['p_group_id'],
    update_group_member_name:['p_group_id','p_member_id','p_display_name'],
    update_group_default_article_class:['p_group_id','p_names'],
    is_current_email_blocklisted:[],
    move_scope_block:['p_scope_id','p_page_name','p_uid','p_direction']
  }[name];
  if(Object.keys(args).some(key=>!keys.includes(key)))reject('Unexpected Kysely action argument');
  if(name==='is_current_email_blocklisted'){
    const email=String(claims.email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))reject('Verified email unavailable',403);
    await sql`reset role`.execute(trx);
    const config=await trx.selectFrom('silver.loc').select('blacklist')
      .where('id','=','loc').executeTakeFirst();
    const list=config?.blacklist?.email;
    return {data:Array.isArray(list)&&list.some(item=>
      String(item?.email||'').trim().toLowerCase()===email),count:null};
  }
  if(name==='read_group_members'){
    const group=validScope(args.p_group_id);
    if(!await canManage(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const rows=await trx.selectFrom('silver.manage')
      .select(['id','display_name','parent_scope_id','active','sort_order'])
      .where('parent_scope_id','=',group).where('manage_role','=','scope')
      .orderBy('sort_order','asc').orderBy('id','asc').execute();
    return {data:rows,count:null};
  }
  if(name==='update_group_member_name'){
    const group=validScope(args.p_group_id);
    const member=validScope(args.p_member_id);
    const title=String(args.p_display_name||'').trim();
    if(!title||title.length>120)reject('Group member name must contain 1–120 characters');
    if(!await canManage(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const parent=await trx.selectFrom('silver.manage').select('id')
      .where('id','=',member).where('parent_scope_id','=',group)
      .where('manage_role','=','scope').executeTakeFirst();
    if(!parent)reject('Scope is outside this Group',403);
    const updated=await trx.updateTable('silver.'+member)
      .set({display_name:title,updated_at:sql`now()`})
      .where('id','=',member).executeTakeFirst();
    if(Number(updated?.numUpdatedRows||0)!==1)reject('Group member configuration was not updated');
    const registry=await trx.updateTable('silver.manage')
      .set({display_name:title,updated_at:sql`now()`})
      .where('id','=',member).where('parent_scope_id','=',group)
      .where('manage_role','=','scope').executeTakeFirst();
    if(Number(registry?.numUpdatedRows||0)!==1)reject('Group member registry was not updated');
    return {data:true,count:null};
  }
  if(name==='update_group_default_article_class'){
    const group=validScope(args.p_group_id);
    const names=args.p_names;
    if(group!=='loc'||!Array.isArray(names)||
      names.some(n=>typeof n!=='string'||n.trim().length<1||n.trim().length>80)||
      new Set(names.map(n=>n.trim().toLowerCase())).size!==names.length)
      reject('Invalid Group article classifications');
    if(!await canManage(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const exists=await trx.selectFrom('silver.loc').select('id')
      .where('id','=',group).forUpdate().executeTakeFirst();
    if(!exists)reject('Group config not found');
    const updated=await trx.updateTable('silver.loc')
      .set({DefaultArticleClass:sql`${JSON.stringify(names)}::jsonb`})
      .where('id','=',group).executeTakeFirst();
    if(Number(updated?.numUpdatedRows||0)!==1)reject('Group classification update failed');
    return {data:true,count:null};
  }
  const scope=validScope(args.p_scope_id);
  const page=String(args.p_page_name||'').trim().toLowerCase();
  const uid=validUid(args.p_uid);
  const direction=Number(args.p_direction);
  if(!page||page.length>80||![-1,1].includes(direction))
    reject('Invalid block move');
  const authorized=scope==='loc'
    ?(await canManage(trx,'global')||(page==='index'&&await canManage(trx,'group','loc')))
    :await canManage(trx,'scope',scope);
  if(!authorized)reject('Block management permission required',403);
  await sql`reset role`.execute(trx);
  const relation='silver.'+scope+'_blocks';
  await sql`select pg_advisory_xact_lock(hashtext(${scope}),hashtext(${page}))`.execute(trx);
  const original=await trx.selectFrom(relation).select(['uid','block_order'])
    .where('uid','=',uid).where('page_name','=',page).executeTakeFirst();
  if(!original)reject('Block not found on this page');
  let neighbor=trx.selectFrom(relation).select(['uid','block_order'])
    .where('page_name','=',page)
    .where('block_order',direction===-1?'<':'>',original.block_order);
  neighbor=neighbor.orderBy('block_order',direction===-1?'desc':'asc')
    .orderBy('uid',direction===-1?'desc':'asc');
  const next=await neighbor.limit(1).executeTakeFirst();
  if(!next)reject('Block is already at the page boundary');
  const ref=sql.ref(relation);
  const result=await sql`update ${ref}
    set block_order=case when uid=${uid} then ${next.block_order} else ${original.block_order} end
    where page_name=${page} and uid in (${uid},${next.uid})`.execute(trx);
  if(Number(result.numAffectedRows||0)!==2)reject('Block order update incomplete');
  return {data:{uid,block_order:next.block_order,
    neighbor_uid:next.uid,neighbor_order:original.block_order},count:null};
}
