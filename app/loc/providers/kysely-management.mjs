import {canManageLoc,locManageRows} from './loc-authorization.mjs';
import {schema as fixedSchema} from '../../../zenstack/schema.mjs';
import {indexZModelAnchorHierarchy} from '../../../zenstack/anchor-hierarchy.mjs';
import {validateLocRegistryDomain} from './loc-domain.mjs';
import {sql} from 'npm:kysely@0.29.8';
import {saveBlocksKysely} from './kysely-blocks.mjs';
import {allocateAnchorUid} from '../unified-anchor-compat.mjs';
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
import {keywordPatternItemMetrics} from '../keyword-search-pattern.mjs';

const ID=/^[a-z][a-z0-9_]*$/i;
const UID=/^[A-Za-z0-9]{8}$/;
const SCOPED_SUFFIXES=['_galaxy','_anchor','_blocks'];

function reject(message,status=400){
  const error=new Error(message);
  error.httpStatus=status;
  throw error;
}
function tableName(value){
  if(value==='api.manage')return 'manage';
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

// node-postgres serializes a JS array as a PostgreSQL array literal ("{3,...}"),
// which is invalid for a jsonb column. Keep JSONB values as one explicitly
// typed JSON document instead; never rewrite the stored bubble structure.
// Only known JSONB fields are encoded, leaving SQL array columns untouched.
const MANAGED_JSONB_COLUMNS=new Set([
  'block_entity','attr','status','blacklist','theme','keywords',
  'database','keyword_meta','DefaultArticleClass','search_aliases','caches'
]);
export function postgresManagedJsonbValues(values){
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[
    key,MANAGED_JSONB_COLUMNS.has(key)&&value!==null&&typeof value==='object'
      ?sql`${JSON.stringify(value)}::jsonb`:value
  ]));
}
function scopeFromTable(table){
  for(const suffix of SCOPED_SUFFIXES){
    if(table.endsWith(suffix))return table.slice(0,-suffix.length);
  }
  return table;
}
/** PK contract for the only relations accepted by authorizeRelation().
 * No pg_catalog SELECT: verified against actual Registry/Scope primary keys.
 */
export function managedPrimaryKeyColumns(table,modelName=''){
  const idFields=modelName?fixedSchema.models[modelName]?.idFields:null;
  if(modelName&&(!idFields||!idFields.length))
    reject('Invalid fixed LOC primary key metadata');
  return idFields||
    [SCOPED_SUFFIXES.some(suffix=>table.endsWith(suffix))?'uid':'id'];
}
async function authorizeRelation(trx,table,operation,values,filters,rows){
  if(table==='manage'||table==='loc'){
    if(!await canManageLoc(trx,'global'))reject('Global management permission required',403);
    return;
  }
  if(table==='loc_blocks'){
    const global=await canManageLoc(trx,'global');
    if(global)return;
    if(!await canManageLoc(trx,'group','loc'))reject('LOC Group management permission required',403);
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
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||!await canManageLoc(trx,'scope',scope))
    reject('Scope management permission required',403);
  // Verify the dynamic registry mapping before escalating to the trusted
  // server connection. Caller input can never pick an arbitrary table.
  const record=await trx.selectFrom('api.manage')
    .select(['id','manage_role','galaxy_table','anchor_table'])
    .where('id','=',scope).executeTakeFirst();
  if(!record||record.manage_role!=='scope')reject('Scope is not registered',403);
  const galaxy=String(record.galaxy_table||'galaxy');
  const anchor=String(record.anchor_table||'anchor');
  if(!ID.test(galaxy)||!ID.test(anchor))reject('Scope registry is invalid',403);
  const allowed=new Set([scope,scope+'_blocks',scope+'_'+galaxy,
    scope+'_'+anchor]);
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
export async function executeManagedKyselyWrite(trx,body,{modelName=''}={}){
  const payload=body?.payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    reject('Invalid managed write payload');
  const table=tableName(payload.p_table);
  // Only the two fixed global Registry models can use this privileged model
  // mapping. Other relations retain their existing Kysely/Scope boundary.
  if(modelName&&!(modelName==='Manage'&&table==='manage'||
      modelName==='Loc'&&table==='loc'))
    reject('Invalid fixed LOC model for management write',403);
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
  if(table==='manage'){
    if(operation==='insert')for(let i=0;i<rows.length;i++)
      rows[i]=validateLocRegistryDomain(rows[i]);
    if(operation==='update'&&Object.hasOwn(values,'domain'))
      Object.assign(values,validateLocRegistryDomain(values));
  }
  await authorizeRelation(trx,table,operation,values,filters,rows);
  // Above checks execute as the verified Clerk principal. Only after Scope
  // authorization is proved do trusted server-side Kysely mutations run
  // with the connection's original role (same privilege as old definer RPC).
  await sql`reset role`.execute(trx);
  const name=modelName||(table==='manage'?'api.manage':'silver.'+table);
  if(operation==='update'){
    // Every authorized managed relation has a fixed single-column PK:
    // Registry and Scope config -> id; Galaxy/Anchor/Blocks -> uid.
    // These were checked against the live PostgreSQL catalog. There is no
    // need for one pg_index SELECT on every edit, including dynamic Scopes.
    const keys=managedPrimaryKeyColumns(table,modelName);
    if(keys.some(key=>Object.hasOwn(values,key)))
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
    const base=operation==='update'?trx.updateTable(name).set(postgresManagedJsonbValues(values)):trx.deleteFrom(name);
    const result=await withFilters(base,filters).execute();
    count=Number(result[0]?.numUpdatedRows??result[0]?.numDeletedRows??result[0]?.numAffectedRows??0);
  }
  // The Scope configuration and LOC directory name are one logical write.
  // This is the Kysely replacement for the old database sync trigger.
  if(count>0&&/^[a-z][a-z0-9]{0,14}$/.test(table)&&table!=='loc'&&
      operation==='update'&&Object.hasOwn(values,'display_name')){
    const title=String(values.display_name??'').trim();
    if(!title)reject('Scope display name cannot be empty');
    await trx.updateTable('silver.loc').set({display_name:title})
      .where('id','=',table).execute();
  }
  if(count>0&&/^[a-z][a-z0-9]{0,14}$/.test(table)&&table!=='loc'&&
      operation==='insert'){
    for(const row of rows){
      if(String(row.id||'')!==table||!Object.hasOwn(row,'display_name'))continue;
      const title=String(row.display_name??'').trim();
      if(!title)reject('Scope display name cannot be empty');
      await trx.updateTable('silver.loc').set({display_name:title})
        .where('id','=',table).execute();
    }
  }
  return {data:{count},count:null};
}


const GALAXY_BULK_FLAGS=new Set(['statics','culture','search','trace','list','keyword','extract','others']);
async function bulkUpdateGalaxyFlags(trx,args){
  const scope=String(args.p_scope_id||'').trim().toLowerCase();
  const site=String(args.p_site||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||!/^[a-z][a-z0-9_. -]{0,63}$/.test(site))
    reject('Invalid Scope or source');
  const flags=args.p_flags;
  if(!flags||typeof flags!=='object'||Array.isArray(flags)||
     Object.keys(flags).length===0||
     Object.keys(flags).some(key=>!GALAXY_BULK_FLAGS.has(key)||typeof flags[key]!=='boolean'))
    reject('Bulk update requires explicit Galaxy Boolean values');
  if(['mcp','github'].includes(site)&&Object.values(flags).some(Boolean))
    reject('Private MCP and GitHub sources cannot be publicly enabled',403);
  if(!await canManageLoc(trx,'scope',scope))reject('Scope management permission required',403);
  // Reuse the Scope Registry. Do not trust user-supplied SQL relation names.
  const registry=await trx.selectFrom('api.manage').select(['manage_role','galaxy_table'])
    .where('id','=',scope).executeTakeFirst();
  if(registry?.manage_role!=='scope'||registry.galaxy_table!=='galaxy')
    reject('Scope Galaxy mapping unavailable',403);
  const table=sql.ref('silver.'+scope+'_galaxy');
  const values=Object.entries(flags);
  const different=sql.join(values.map(([name,value])=>
    sql`${sql.ref('g.'+name)} is distinct from ${value}`),sql` or `);
  await sql`set local statement_timeout = '12000ms'`.execute(trx);
  const totalQuery=await sql`select count(*)::int as n from ${table} as g
    where lower(coalesce(g.site,''))=${site} and (${different})`.execute(trx);
  const matching=Number(totalQuery.rows[0]?.n||0);
  if(args.p_apply!==true)return {matching,updated:0,remaining:matching};
  if(!Number.isInteger(args.p_expected_count)||args.p_expected_count!==matching)
    reject('Bulk preview is stale; preview again before writing',409);
  const limit=args.p_batch_size===undefined?250:Number(args.p_batch_size);
  if(!Number.isInteger(limit)||limit<1||limit>500)reject('Invalid bulk batch size');
  if(!matching)return {matching:0,updated:0,remaining:0};
  // Only trusted Kysely code, with server-side Scope permission already verified,
  // may run this bounded mutation. Each row is changed once, no UID ordering.
  await sql`reset role`.execute(trx);
  const assignments=sql.join(values.map(([name,value])=>
    sql`${sql.ref(name)}=${value}`),sql`, `);
  const result=await sql`
    with targets as (
      select g.uid from ${table} as g
      where lower(coalesce(g.site,''))=${site} and (${different})
      order by g.createtime asc nulls last
      limit ${limit} for update skip locked
    )
    update ${table} as g set ${assignments}, "UpdateTime"=now()
    from targets as t where g.uid=t.uid
  `.execute(trx);
  const updated=Number(result.numAffectedRows||0);
  return {matching,updated,remaining:matching-updated};
}


// Source-list control uses the existing per-Scope Anchor table, not Galaxy
// article scans or a new SQL schema. Privileged reads happen only after
// verifying LOC Group or the requested Scope, never across sibling Scopes.
const sourceUidList=row=>Array.isArray(row?.attr?.uid)?row.attr.uid:[];
const sourceNames=value=>{
  if(typeof value==='string'){try{value=JSON.parse(value)}catch{return []}}
  return Array.isArray(value)?value.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[];
};
async function sourceMemberScopes(trx,viewer){
  if(viewer!=='loc')return [viewer];
  const records=await trx.selectFrom('api.manage').select('id')
    .where('parent_scope_id','=','loc').where('manage_role','=','scope')
    .where('active','=',true).orderBy('sort_order','asc').orderBy('id','asc').execute();
  return records.map(row=>row.id).filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id));
}
async function sourceCatalogAction(trx,args,save=false){
  const viewer=validScope(args.p_scope_id);
  const group=viewer==='loc';
  if(!(await canManageLoc(trx,group?'group':'scope',viewer)))
    reject('Source catalog permission denied',403);
  // The caller never provides a target sibling Scope. Even LOC has no
  // permission to save a member's Domain/From catalogue through this action.
  if(save&&group)reject('LOC cannot edit child Scope sources',403);
  const scopes=await sourceMemberScopes(trx,viewer);
  await sql`reset role`.execute(trx);
  if(save){
    const entries=args.p_sources;
    if(!Array.isArray(entries)||entries.length>400||
       entries.some(v=>!v||typeof v!=='object'||Array.isArray(v)||
         Object.keys(v).some(k=>!['uid','name','label'].includes(k))||
         typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>80||
         v.label!==undefined&&(typeof v.label!=='string'||v.label.trim().length>80)||
         v.uid!==undefined&&!UID.test(String(v.uid))))
      reject('Invalid source names');
    const names=entries.map(item=>item.name.trim());
    if(new Set(names.map(n=>n.normalize('NFKC').toLowerCase())).size!==names.length)
      reject('Duplicate source names');
    const anchor='silver.'+viewer+'_anchor';
    await sql`select pg_advisory_xact_lock(hashtext(${viewer}),hashtext('source-anchor'))`.execute(trx);
    const existing=await trx.selectFrom(anchor).select(['uid','type','title','attr'])
      .where('type','in',['domain','from']).execute();
    const domains=existing.filter(row=>row.type==='domain'&&row.title===viewer);
    if(domains.length>1)reject('Duplicate Scope source Domain');
    const current=domains[0]||null,owned=new Set(sourceUidList(current));
    const oldFrom=new Map(existing.filter(row=>row.type==='from'&&owned.has(row.uid))
      .map(row=>[row.uid,row]));
    if(owned.size!==oldFrom.size)reject('Broken source hierarchy references');
    // Keep source edits bounded: never scan the full Anchor table for a new UID.
    // The physical UID primary key remains the final collision guard.
    const assigned=new Set(existing.map(row=>row.uid));
    const next=[];
    for(const item of entries){
      const name=item.name.trim(),label=String(item.label||name).trim();
      let uid=item.uid;
      if(uid&&!owned.has(uid))reject('Cannot edit a foreign source UID',403);
      if(uid&&!oldFrom.has(uid))reject('Source UID does not belong to Domain');
      if(uid){
        // From title is the Galaxy.site comparison key, never a mutable label.
        if(oldFrom.get(uid).title!==name)reject('Source site key is immutable; use source correction',409);
        if((oldFrom.get(uid).description||name)!==label)
          await trx.updateTable(anchor).set({description:label===name?null:label})
            .where('uid','=',uid).where('type','=','from').execute();
      }else{
        uid=allocateAnchorUid(assigned);assigned.add(uid);
        await trx.insertInto(anchor).values({uid,type:'from',title:name,
          description:label===name?null:label,invisible:false,attr:sql`'{}'::jsonb`}).execute();
      }
      next.push(uid);
    }
    if(new Set(next).size!==next.length)reject('Duplicate source UID');
    if(!current){
      const uid=allocateAnchorUid(assigned);
      await trx.insertInto(anchor).values({uid,type:'domain',title:viewer,
        description:null,invisible:false,attr:sql`${JSON.stringify({uid:next})}::jsonb`}).execute();
    }else{
      await trx.updateTable(anchor).set({attr:sql`${JSON.stringify({uid:next})}::jsonb`})
        .where('uid','=',current.uid).where('type','=','domain').execute();
    }
    const removed=[...owned].filter(uid=>!next.includes(uid));
    if(removed.length)await trx.deleteFrom(anchor).where('type','=','from')
      .where('uid','in',removed).execute();
    return {count:next.length,removed:removed.length};
  }
  const global=await trx.selectFrom('silver.loc').select('DefaultArticleClass')
    .where('id','=','loc').executeTakeFirst();
  const system=sourceNames(global?.DefaultArticleClass);
  const records=[];
  for(const id of scopes){
    const registry=await trx.selectFrom('api.manage').select(['id','manage_role','anchor_table'])
      .where('id','=',id).where('manage_role','=','scope').where('active','=',true)
      .executeTakeFirst();
    if(!registry)continue;
    const suffix=String(registry.anchor_table||'anchor');
    if(!/^[a-z][a-z0-9_]*$/.test(suffix))reject('Invalid source Anchor mapping');
    const anchor='silver.'+id+'_'+suffix;
    const rows=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
      .where('type','in',['domain','from']).execute();
    const domains=rows.filter(row=>row.type==='domain'&&row.title===id);
    if(domains.length>1)reject('Duplicate source Domain');
    // Use the already-defined ZModel Source hierarchy over the authorized
    // Domain/From rows. Universe/Galaxy remain presentation parents until
    // their physical Anchor nodes exist; do not fabricate local UIDs.
    const sourceGraph=indexZModelAnchorHierarchy(rows,{family:'source'});
    const domain=domains[0]||null;
    if(domain&&sourceGraph.descendants(domain.uid).missing.length)
      reject('Source Domain references missing From');
    const linked=domain?sourceGraph.childrenOf(domain.uid):[];
    const byUid=new Map(rows.filter(row=>row.type==='from').map(row=>[row.uid,row]));
    const sources=linked.map(uid=>byUid.get(uid));
    if(sources.some(item=>!item))reject('Source Domain references missing From');
    records.push({scopeid:id,domain:domain?{uid:domain.uid,title:domain.title}:null,
      sources:sources.map(row=>({uid:row.uid,name:row.title,label:row.description||row.title}))});
  }
  return {universe:'Eosteric',galaxy:'LOC',system,scopes:records};
}

const ACTIONS=new Set(['read_source_catalog','save_scope_sources','read_group_members','update_group_member_name',
  'update_group_default_article_class','is_current_email_blocklisted','move_scope_block',
  'preview_or_fill_galaxy_place','batch_fill_galaxy_location',
  'rename_scope_site_batch','save_scope_trace_place_names','save_blocks','loc_admin_settings',
  'refresh_scope_search_summary','merge_scope_trace_place_names','import_shared_keyword_class','manage','find_galaxy_duplicates','read_scope_registry_admin','bulk_update_galaxy_able',
  'sync_search_patterns','suggest_search_patterns','keyword_pattern_statistics']);
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


async function keywordPatternStatistics(trx,args){
  const scope=validScope(args.p_scope_id),classUid=validUid(args.p_class_uid);
  const owner=await canManageLoc(trx,'scope',scope);
  await sql`reset role`.execute(trx);
  const config=await trx.selectFrom('silver.'+scope)
    .select('keyword_meta').where('id','=',scope).executeTakeFirst();
  if(!owner&&config?.keyword_meta?.class_shares?.[classUid]!==true)
    reject('Keyword Class not shared or authorized',403);
  const table='silver.'+scope+'_anchor';
  const root=await trx.selectFrom(table).select(['uid','type','title','attr'])
    .where('uid','=',classUid).where('type','=','class').executeTakeFirst();
  if(!root)reject('Unknown Keyword Class');
  const attributes=node=>{
    if(typeof node?.attr==='string')return JSON.parse(node.attr);
    return node?.attr||{};
  };
  const links=(node,key)=>{
    const attr=attributes(node),source=attr[key]??attr.uid??[];
    return Array.isArray(source)?[...new Set(source.filter(uid=>UID.test(String(uid))))]:[];
  };
  const groupUids=links(root,'groups');
  const groupRows=groupUids.length?await trx.selectFrom(table)
    .select(['uid','type','title','attr'])
    .where('type','=','group').where('uid','in',groupUids).execute():[];
  const byGroup=new Map(groupRows.map(row=>[row.uid,row]));
  if(groupUids.some(uid=>!byGroup.has(uid)))reject('Keyword Group link incomplete');
  const itemUids=[...new Set(groupRows.flatMap(group=>links(group,'items')))];
  const itemRows=itemUids.length?await trx.selectFrom(table)
    .select(['uid','type','title','attr'])
    .where('type','=','item').where('uid','in',itemUids).execute():[];
  const byItem=new Map(itemRows.map(row=>[row.uid,row]));
  if(itemUids.some(uid=>!byItem.has(uid)))reject('Keyword Item link incomplete');
  const items=groupUids.flatMap(groupUid=>links(byGroup.get(groupUid),'items').map(uid=>{
    const row=byItem.get(uid);
    return {
      uid,item_name:String(row.title||''),group_uid:groupUid,
      keywords:Array.isArray(attributes(row).keyword)?attributes(row).keyword:[]
    };
  }));
  // The Anchor supplies hierarchy and words only. Every hit/UID/count comes
  // exclusively from loc_search_pattern, including newly composed Items.
  const patterns=await trx.selectFrom('silver.loc_search_pattern')
    .select(['pattern','count','uid_list','update_time'])
    .where('scopeid','=',scope).execute();
  const start=String(args.p_start_date||''),end=String(args.p_end_date||'');
  const source=String(args.p_source||'').trim();
  if([start,end].some(value=>value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))||
     start&&end&&start>end||source.length>120)
    reject('Invalid Keyword statistics date or source');
  let allowed=null;
  if(start||end||source){
    allowed=new Set();
    const uids=[...new Set(patterns.flatMap(row=>row.uid_list||[]))];
    // Only dated/source metadata for already indexed UIDs. No article text,
    // Anchor count, JSONB join or separate stored statistics.
    for(let i=0;i<uids.length;i+=500){
      let query=trx.selectFrom('silver.'+scope+'_galaxy')
        .select('uid').where('uid','in',uids.slice(i,i+500))
        .where('keyword','=',true);
      if(start)query=query.where('date','>=',start);
      if(end)query=query.where('date','<=',end);
      if(source)query=query.where('site','=',source);
      for(const row of await query.execute())allowed.add(String(row.uid));
    }
  }
  const metrics=keywordPatternItemMetrics(items,patterns,{articleUids:allowed});
  const groups=groupUids.map(uid=>{
    const members=metrics.items.filter(item=>item.group_uid===uid);
    const hits=members.reduce((sum,item)=>sum+item.hit_count,0);
    return {uid,name:String(byGroup.get(uid).title||''),hit_count:hits,
      document_count:Number(metrics.group_document_counts?.[uid])||0,
      ratio:metrics.total_hits?100*hits/metrics.total_hits:0};
  });
  return {
    class_uid:classUid,class_name:String(root.title||''),groups,
    ...metrics
  };
}

// Indexed Keyword suggestions stay inside the verified LOC Scope-management
// channel. No anonymous SELECT exposes private Item vocabulary or article UIDs.
async function suggestSearchPatterns(trx,args){
  const requested=args.p_scope_ids;
  const query=String(args.p_query??'').normalize('NFKC').trim();
  if(!Array.isArray(requested)||requested.length<1||requested.length>50||
     requested.some(scope=>typeof scope!=='string'||!/^[a-z][a-z0-9]{0,14}$/.test(scope))||
     query.length>120)reject('Invalid search-pattern request');
  const granted=[];
  for(const id of new Set(requested)){
    if(await canManageLoc(trx,'scope',id))granted.push(id);
  }
  if(!granted.length)reject('No authorized search-pattern Scope',403);
  await sql`reset role`.execute(trx);
  const escaped=query.replace(/[\\%_]/gu,char=>'\\'+char);
  const rows=await trx.selectFrom('silver.loc_search_pattern')
    .select('pattern').select(eb=>eb.fn.sum('count').as('count'))
    .where('scopeid','in',granted)
    .where('pattern','ilike',escaped+'%')
    .groupBy('pattern')
    .orderBy('count','desc').orderBy('pattern','asc')
    .limit(10).execute();
  return rows.map(row=>({pattern:row.pattern,count:Number(row.count)||0}));
}

async function syncSearchPatterns(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const classUid=validUid(args.p_class_uid);
  const proposed=args.p_patterns;
  if(args.p_final!==undefined&&typeof args.p_final!=='boolean')
    reject('Invalid search-pattern finalization flag');
  if(!Array.isArray(proposed)||proposed.length>4000)
    reject('Invalid search-pattern batch');
  const anchor='silver.'+scope+'_anchor';
  const klass=await trx.selectFrom(anchor).select('uid')
    .where('uid','=',classUid).where('type','=','class').executeTakeFirst();
  if(!klass)reject('Keyword Class not found for Scope');
  // Only Keyword Item titles and literal aliases may appear in this table.
  // This source read is bounded by the keyword library, not article content.
  const items=await trx.selectFrom(anchor).select(['title','attr'])
    .where('type','=','item').execute();
  const active=new Set();
  const id=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
  for(const item of items){
    const attr=typeof item.attr==='string'?JSON.parse(item.attr):item.attr||{};
    const literalAliases=(Array.isArray(attr.keyword)?attr.keyword:[])
      .filter(word=>typeof word==='string'&&
        !parseRuneKeywordRuleSentence(word).rules.length);
    for(const word of [item.title,...literalAliases]){
      const value=id(word);
      if(value&&value.length<=256)active.add(value);
    }
  }
  const seen=new Set();
  for(const row of proposed){
    const word=String(row?.pattern??'').normalize('NFKC').trim();
    const key=id(word);
    if(row?.scopeid!==scope||!key||word.length>256||!active.has(key)||
       seen.has(key)||!Number.isSafeInteger(row.count)||row.count<0||
       !Array.isArray(row.uid_list)||row.uid_list.length>100000||
       row.uid_list.some(uid=>typeof uid!=='string'||!UID.test(uid))||
       new Set(row.uid_list).size!==row.uid_list.length||
       row.count!==row.uid_list.length)
      reject('Invalid or duplicated Keyword search pattern');
    seen.add(key);
  }
  const stored=await trx.selectFrom('silver.loc_search_pattern')
    .select(['pattern','count','uid_list','update_time'])
    .where('scopeid','=',scope).execute();
  const prior=new Map(stored.map(row=>[id(row.pattern),row]));
  const now=new Date().toISOString();
  const changed=[],renamed=[];
  for(const row of proposed){
    const old=prior.get(id(row.pattern));
    const uids=[...row.uid_list].sort();
    const sameUids=Array.isArray(old?.uid_list)&&old.uid_list.length===uids.length&&
      [...old.uid_list].sort().every((uid,i)=>uid===uids[i]);
    // PK uses the visible spelling, but the word identity is NFKC/case
    // normalized. Remove an old spelling before inserting the new one to
    // avoid duplicate results after a title/alias casing change.
    if(old?.pattern!==undefined&&old.pattern!==row.pattern)renamed.push(old.pattern);
    if(old&&old.pattern===row.pattern&&Number(old.count)===row.count&&sameUids)continue;
    changed.push({scopeid:scope,pattern:row.pattern,count:row.count,
      uid_list:uids,update_time:old&&sameUids?old.update_time:now});
  }
  for(let i=0;i<renamed.length;i+=100){
    await trx.deleteFrom('silver.loc_search_pattern')
      .where('scopeid','=',scope)
      .where('pattern','in',renamed.slice(i,i+100)).execute();
  }
  for(let i=0;i<changed.length;i+=100){
    const batch=changed.slice(i,i+100);
    await trx.insertInto('silver.loc_search_pattern').values(batch)
      .onConflict(oc=>oc.columns(['scopeid','pattern']).doUpdateSet(eb=>({
        count:eb.ref('excluded.count'),
        uid_list:eb.ref('excluded.uid_list'),
        update_time:eb.ref('excluded.update_time')
      }))).execute();
  }
  // Intermediate uploads must not prune words: a full Class may exceed the
  // SQL transport's 1 MiB POST limit. The final batch alone performs cleanup.
  // Do not remove another Class's live words when this Class is reanalyzed.
  const obsolete=args.p_final===false?[]:
    stored.filter(row=>!active.has(id(row.pattern))).map(row=>row.pattern);
  for(let i=0;i<obsolete.length;i+=100){
    await trx.deleteFrom('silver.loc_search_pattern')
      .where('scopeid','=',scope).where('pattern','in',obsolete.slice(i,i+100)).execute();
  }
  return {patterns:proposed.length,changed:changed.length,deleted:obsolete.length};
}

export async function executeManagedKyselyAction(trx,body,claims={}){
  const name=String(body?.name||'');
  if(!ACTIONS.has(name)||!body.args||typeof body.args!=='object'||
    Array.isArray(body.args))reject('Unknown Kysely action');
  const args=body.args;
  const keys={
    read_source_catalog:['p_scope_id'],
    save_scope_sources:['p_scope_id','p_sources'],
    read_group_members:['p_group_id'],
    update_group_member_name:['p_group_id','p_member_id','p_display_name'],
    update_group_default_article_class:['p_group_id','p_names'],
    is_current_email_blocklisted:[],
    move_scope_block:['p_scope_id','p_page_name','p_uid','p_direction'],
    save_blocks:['p_scope_id','p_type','p_rows'],
    preview_or_fill_galaxy_place:['p_scope_id','p_start_date','p_end_date','p_place','p_apply','p_expected_count'],
    batch_fill_galaxy_location:['p_scope_id','p_uids','p_place','p_apply','p_expected_count'],
    rename_scope_site_batch:['p_scope_id','p_before','p_after','p_batch_size'],
    save_scope_trace_place_names:['p_scope_id','p_uid','p_names'],
    loc_admin_settings:['p_section','p_operation','p_key','p_value'],
    refresh_scope_search_summary:['p_scope_id'],
    bulk_update_galaxy_able:['p_scope_id','p_site','p_flags','p_apply','p_expected_count','p_batch_size'],
    merge_scope_trace_place_names:['p_scope_id','p_keep_uid','p_remove_uids'],
    import_shared_keyword_class:['p_target_scope','p_source_scope','p_class_uid'],
    manage:['p_type','p_id'],
    find_galaxy_duplicates:['p_scope_id'],
    read_scope_registry_admin:[],
    sync_search_patterns:['p_scope_id','p_class_uid','p_patterns','p_final'],
    suggest_search_patterns:['p_scope_ids','p_query'],
    keyword_pattern_statistics:['p_scope_id','p_class_uid','p_start_date','p_end_date','p_source']
  }[name];
  if(Object.keys(args).some(key=>!keys.includes(key)))reject('Unexpected Kysely action argument');
  if(name==='keyword_pattern_statistics')return {data:await keywordPatternStatistics(trx,args),count:null};
  if(name==='sync_search_patterns')return {data:await syncSearchPatterns(trx,args),count:null};
  if(name==='suggest_search_patterns')return {data:await suggestSearchPatterns(trx,args),count:null};
  if(name==='read_source_catalog')return {data:await sourceCatalogAction(trx,args),count:null};
  if(name==='save_scope_sources')return {data:await sourceCatalogAction(trx,args,true),count:null};
  if(name==='save_blocks'){
    const scope=validScope(args.p_scope_id);
    const page=String(args.p_type||'').trim();
    const authType=scope==='loc'&&page!=='index'?'global':'scope';
    if(!await canManageLoc(trx,authType,scope))reject('Block write permission denied',403);
    // One verification for the entire page, followed by a transactional batch.
    await sql`reset role`.execute(trx);
    return {data:await saveBlocksKysely(trx,args),count:null};
  }
  if(name==='read_scope_registry_admin'){
    if(!await canManageLoc(trx,'global'))reject('Global administrator required',403);
    await sql`reset role`.execute(trx);
    const rows=await trx.selectFrom('api.manage as m')
      .leftJoin('silver.loc as l','l.id','m.id')
      .select(['m.id as id','l.display_name as display_name','m.email as email',
        'm.manage_role as manage_role','m.domain as domain','m.directory as directory',
        'm.parent_scope_id as parent_scope_id','m.active as active',
        'm.sort_order as sort_order','m.galaxy_table as galaxy_table',
        'm.anchor_table as anchor_table','l.birthday as birthday',
        'l.title_tw as title_tw','l.desc_tw as desc_tw'])
      .orderBy('m.sort_order','asc').orderBy('m.id','asc').execute();
    return {data:rows.filter(row=>row.manage_role!=='reserve'),count:null};
  }
  if(name==='bulk_update_galaxy_able')return {data:await bulkUpdateGalaxyFlags(trx,args),count:null};
  if(name==='find_galaxy_duplicates')return {data:await findGalaxyDuplicates(trx,args),count:null};
  if(name==='manage'){
    const type=String(args.p_type||'').toLowerCase();
    if(!['self','global','group','scope'].includes(type))reject('Invalid management type');
    const id=type==='self'?null:args.p_id??null;
    if(['group','scope'].includes(type)&&!/^[a-z][a-z0-9]{0,14}$/.test(String(id||'')))
      reject('Invalid management Scope');
    return {data:await locManageRows(trx,type,id),count:null};
  }
  if(name==='merge_scope_trace_place_names')return {data:await mergeScopePoints(trx,args),count:null};
  if(name==='import_shared_keyword_class')return {data:await importSharedKeywordClass(trx,args),count:null};
  if(name==='refresh_scope_search_summary')return {data:await refreshScopeSearchSummary(trx,args),count:null};
  if(name==='loc_admin_settings')return {data:await managedLocSettings(trx,args,claims),count:null};
  if(name==='preview_or_fill_galaxy_place')return {data:await previewOrFillGalaxyPlace(trx,args),count:null};
  if(name==='batch_fill_galaxy_location')return {data:await batchFillGalaxyLocation(trx,args),count:null};
  if(name==='rename_scope_site_batch')return {data:await renameScopeSiteBatch(trx,args),count:null};
  if(name==='save_scope_trace_place_names')return {data:await saveScopePointAliases(trx,args),count:null};
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
    if(!await canManageLoc(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const rows=await trx.selectFrom('api.manage as m')
      .innerJoin('silver.loc as l','l.id','m.id')
      .select(['m.id as id','l.display_name as display_name',
        'm.parent_scope_id as parent_scope_id','m.active as active',
        'm.sort_order as sort_order'])
      .where('m.parent_scope_id','=',group).where('m.manage_role','=','scope')
      .orderBy('m.sort_order','asc').orderBy('m.id','asc').execute();
    return {data:rows,count:null};
  }
  if(name==='update_group_member_name'){
    const group=validScope(args.p_group_id);
    const member=validScope(args.p_member_id);
    const title=String(args.p_display_name||'').trim();
    if(!title||title.length>120)reject('Group member name must contain 1–120 characters');
    if(!await canManageLoc(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const parent=await trx.selectFrom('api.manage').select('id')
      .where('id','=',member).where('parent_scope_id','=',group)
      .where('manage_role','=','scope').executeTakeFirst();
    if(!parent)reject('Scope is outside this Group',403);
    const updated=await trx.updateTable('silver.'+member)
      .set({display_name:title,updated_at:sql`now()`})
      .where('id','=',member).executeTakeFirst();
    if(Number(updated?.numUpdatedRows||0)!==1)reject('Group member configuration was not updated');
    // LOC and its Scope config are updated atomically by Kysely, without a
    // PostgreSQL sync trigger or another SQL round trip to a stored function.
    const synced=await trx.updateTable('silver.loc').set({display_name:title})
      .where('id','=',member).executeTakeFirst();
    if(Number(synced?.numUpdatedRows||0)!==1)
      reject('Group / Scope list name missing');
    return {data:true,count:null};
  }
  if(name==='update_group_default_article_class'){
    const group=validScope(args.p_group_id);
    const names=args.p_names;
    if(group!=='loc'||!Array.isArray(names)||
      names.some(n=>typeof n!=='string'||n.trim().length<1||n.trim().length>80)||
      new Set(names.map(n=>n.trim().toLowerCase())).size!==names.length)
      reject('Invalid Group article classifications');
    if(!await canManageLoc(trx,'group',group))reject('Group management permission required',403);
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
    ?(await canManageLoc(trx,'global')||(page==='index'&&await canManageLoc(trx,'group','loc')))
    :await canManageLoc(trx,'scope',scope);
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
  neighbor=neighbor.orderBy('block_order',direction===-1?'desc':'asc');
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

async function scopedWrite(trx,input){
  const scope=validScope(input);
  if(!await canManageLoc(trx,'scope',scope))reject('Scope write permission required',403);
  const registry=await trx.selectFrom('api.manage').select(['id','manage_role','active'])
    .where('id','=',scope).executeTakeFirst();
  if(!registry||registry.manage_role!=='scope'||registry.active!==true)
    reject('Unknown or inactive Scope',403);
  await sql`reset role`.execute(trx);
  return scope;
}
function placeLabel(value){
  const label=String(value??'').trim();
  if(!label||label.length>200)reject('Place must have 1–200 characters');
  return label;
}
async function previewOrFillGalaxyPlace(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const start=String(args.p_start_date||''),end=String(args.p_end_date||'');
  const place=placeLabel(args.p_place);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||
     start>end||start<'1900-01-01'||end>='2100-01-01')reject('Invalid date interval');
  const rel=sql.ref('silver.'+scope+'_galaxy');
  const condition=sql`createtime>=(${start}::date::timestamp at time zone 'Asia/Taipei')
    and createtime<((${end}::date+1)::timestamp at time zone 'Asia/Taipei')
    and nullif(btrim(location),'') is null`;
  const tally=await sql`select count(*)::integer as count from ${rel}
    where ${condition}`.execute(trx);
  const count=Number(tally.rows[0]?.count||0);
  if(args.p_apply===true){
    const expected=Number(args.p_expected_count);
    if(!Number.isInteger(expected)||expected<1||expected!==count)
      reject('Preview is stale; repeat the preview',409);
    const result=await sql`update ${rel} set location=${place}
      where ${condition}`.execute(trx);
    if(Number(result.numAffectedRows||0)!==expected)
      reject('Article count changed during update',409);
    return {count:expected,applied:true};
  }
  const first=await sql`select btrim(uid::text) as uid,coalesce(title,'') as title,
      to_char(createtime at time zone 'Asia/Taipei','YYYY-MM-DD') as date
    from ${rel} where ${condition}
    order by createtime asc limit 3`.execute(trx);
  const last=await sql`select btrim(uid::text) as uid,coalesce(title,'') as title,
      to_char(createtime at time zone 'Asia/Taipei','YYYY-MM-DD') as date
    from ${rel} where ${condition}
    order by createtime desc limit 3`.execute(trx);
  return {count,first:first.rows,last:last.rows,applied:false};
}
async function batchFillGalaxyLocation(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const place=placeLabel(args.p_place);
  const values=args.p_uids;
  if(!Array.isArray(values)||values.length<1||values.length>200||
     values.some(uid=>!UID.test(String(uid||''))))reject('Select 1–200 valid articles');
  const uids=[...new Set(values)];
  const table='silver.'+scope+'_galaxy';
  const found=await trx.selectFrom(table).select('uid').where('uid','in',uids).execute();
  if(found.length!==uids.length)reject('Article selection changed',409);
  const eligible=await trx.selectFrom(table).select('uid').where('uid','in',uids)
    .where(sql`nullif(btrim(location),'') is null`).execute();
  if(args.p_apply!==true)return {applied:false,selected:uids.length,
    eligible:eligible.length,skipped:uids.length-eligible.length};
  const expected=Number(args.p_expected_count);
  if(!Number.isInteger(expected)||expected<1||expected!==eligible.length)
    reject('Preview is stale; repeat selection',409);
  const result=await trx.updateTable(table).set({location:place})
    .where('uid','in',uids).where(sql`nullif(btrim(location),'') is null`).executeTakeFirst();
  const count=Number(result?.numUpdatedRows||0);
  if(count!==expected)reject('Article count changed during update',409);
  return {applied:true,selected:uids.length,count,skipped:uids.length-count};
}
async function renameScopeSiteBatch(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const before=String(args.p_before??'').trim(),after=String(args.p_after??'').trim();
  const limit=args.p_batch_size===undefined?1000:Number(args.p_batch_size);
  if(!before||!after||before===after||before.length>80||after.length>80||
     !Number.isInteger(limit)||limit<1||limit>1000)
    reject('Invalid source correction');
  const table='silver.'+scope+'_galaxy';
  const targets=await trx.selectFrom(table).select('uid')
    .where('site','=',before).orderBy('createtime','asc')
    .limit(limit).forUpdate().skipLocked().execute();
  if(!targets.length)return 0;
  const result=await trx.updateTable(table).set({site:after})
    .where('uid','in',targets.map(row=>row.uid)).executeTakeFirst();
  return Number(result?.numUpdatedRows||0);
}
async function saveScopePointAliases(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const uid=validUid(args.p_uid);
  const requested=args.p_names;
  if(!Array.isArray(requested)||requested.length>250||
     requested.some(name=>typeof name!=='string'))reject('Invalid Point aliases');
  const table='silver.'+scope+'_anchor';
  const point=await trx.selectFrom(table).select('attr')
    .where('uid','=',uid).where('type','=','point')
    .forUpdate().executeTakeFirst();
  if(!point)reject('Selected Point not found');
  const previous=point.attr?.location;
  const old=Array.isArray(previous)?previous:typeof previous==='string'?[previous]:[];
  const aliases=[...new Set([...old,...requested].map(n=>String(n).trim())
    .filter(n=>n&&n.length<=320))].sort();
  const change=aliases.length
    ?sql`jsonb_set(attr,'{location}',${JSON.stringify(aliases)}::jsonb,true)`
    :sql`attr-'location'`;
  const result=await trx.updateTable(table).set({attr:change})
    .where('uid','=',uid).where('type','=','point').executeTakeFirst();
  return Number(result?.numUpdatedRows||0);
}

function validCatalog(value,label){
  if(!Array.isArray(value))reject('LOC '+label+' is unavailable');
  return value;
}
function catalogObject(value){
  return value&&typeof value==='object'&&!Array.isArray(value);
}
async function managedLocSettings(trx,args,claims){
  if(!await canManageLoc(trx,'global'))reject('Global administrator required',403);
  const section=String(args.p_section||'');
  const operation=String(args.p_operation||'read');
  const key=String(args.p_key??'').trim();
  const value=args.p_value;
  if(!['theme','keywords','email','scopeid'].includes(section))
    reject('Invalid LOC settings section');
  // Permission was established with the signed Clerk identity; no arbitrary
  // table is addressable through this route.
  await sql`reset role`.execute(trx);
  if(section==='scopeid'){
    // Routing-reserved names are system records. The real Admin ID remains
    // role=admin, but its protected-route note is editable alongside reserves.
    const rows=await trx.selectFrom('api.manage')
      .select(['id','note','manage_role'])
      .where('manage_role','in',['reserve','admin'])
      .orderBy('id','asc').execute();
    if(operation==='read')return rows.map(({id,note})=>({id,note}));
    if(operation!=='note'||!key)reject('Reserved Scope notes only');
    const target=rows.find(item=>item.id===key);
    if(!target)reject('Reserved Scope ID not found');
    const note=String(value??'').trim()||null;
    await trx.updateTable('api.manage').set({note})
      .where('id','=',key).executeTakeFirst();
    return rows.map(item=>({id:item.id,note:item.id===key?note:item.note}));
  }
  const row=await trx.selectFrom('silver.loc')
    .select(['theme','keywords','blacklist'])
    .where('id','=','loc').forUpdate().executeTakeFirst();
  if(!row)reject('LOC Group settings unavailable');
  const saved=validCatalog(
    section==='theme'?row.theme:section==='keywords'?row.keywords:row.blacklist?.[section],section);
  if(operation==='read')return saved;
  let updated=[],column='blacklist',returnValue;
  if(section==='theme'){
    if(operation!=='upsert'||!/^[1-8]$/.test(key)||!catalogObject(value)||
       value.theme_id!==key||!['dark','light'].includes(value.scheme)||
       !String(value.theme_name||'').trim())reject('Invalid Theme update');
    const previous=saved.find(item=>String(item?.theme_id)===key);
    if(!previous||saved.length!==8||!catalogObject(previous))reject('Theme slot missing');
    const a=Object.keys(previous).sort(),b=Object.keys(value).sort();
    if(a.join('\0')!==b.join('\0'))reject('Incomplete Theme palette');
    for(const [field,raw] of Object.entries(value)){
      if(field==='theme_id'||field==='theme_order')continue;
      if(raw===null||!String(raw).trim()||/[;{}<>\\]/.test(String(raw))||
         /url\s*\(|@import|!important/i.test(String(raw)))
        reject('Unsafe Theme palette');
    }
    updated=saved.map(item=>String(item.theme_id)===key?value:item);
    column='theme';returnValue=value;
  }else if(section==='keywords'){
    if(!['upsert','delete'].includes(operation))reject('Invalid Keyword operation');
    let oldScope='',oldName='';
    if(args.p_key!==undefined&&args.p_key!==null){
      let decoded;try{decoded=JSON.parse(args.p_key)}catch{reject('Invalid Keyword identifier')}
      if(!Array.isArray(decoded)||decoded.length!==2)reject('Invalid Keyword identifier');
      [oldScope,oldName]=decoded;
    }
    let next=null;
    if(operation==='upsert'){
      const id=value?.scope_id,category=String(value?.class_name||'').trim(),hash=value?.hash;
      if(!catalogObject(value)||!/^[a-z][a-z0-9]{0,14}$/.test(String(id||''))||
         !category||category.length>120||!/^[0-9a-f]{32}$/.test(String(hash||'')))
        reject('Invalid Keyword record');
      next={scope_id:id,class_name:category,hash};
    }
    let found=false;
    for(const item of saved){
      if(args.p_key!==undefined&&args.p_key!==null&&item?.scope_id===oldScope&&item?.class_name===oldName){
        found=true;if(operation==='upsert')updated.push(next);
      }else updated.push(item);
    }
    if(args.p_key!==undefined&&args.p_key!==null&&!found)reject('Keyword registry entry not found');
    if(operation==='upsert'&&(args.p_key===undefined||args.p_key===null))updated.push(next);
    const seen=new Set();
    for(const item of updated){
      const signature=JSON.stringify([item?.scope_id,item?.class_name]);
      if(seen.has(signature))reject('Duplicate Scope and Keyword Class');
      seen.add(signature);
    }
    column='keywords';returnValue=operation==='delete'?{deleted:true}:next;
  }else if(section==='email'){
    const email=key.toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['add','remove'].includes(operation))
      reject('Invalid email blacklist operation');
    if(operation==='add'&&email===String(claims.email||'').trim().toLowerCase())
      reject('Current administrator cannot be blocked');
    updated=saved.filter(item=>operation==='add'||
      String(item?.email||'').toLowerCase()!==email);
    if(operation==='add'&&!saved.some(item=>String(item?.email||'').toLowerCase()===email))
      updated.push({email,created_at:new Date().toISOString()});
    returnValue=updated;
  }else{
    if(operation!=='note'||!key)reject('Reserved Scope notes only');
    let found=false;
    updated=saved.map(item=>{
      if(item?.id!==key)return item;
      found=true;const note=String(value??'').trim();
      return {...item,note:note||null};
    });
    if(!found)reject('Reserved Scope ID not found');
    returnValue=updated;
  }
  if(column==='blacklist'){
    await trx.updateTable('silver.loc').set({
      blacklist:sql`jsonb_set(blacklist,ARRAY[${section}]::text[],
        ${JSON.stringify(updated)}::jsonb,true)`
    }).where('id','=','loc').executeTakeFirst();
  }else{
    await trx.updateTable('silver.loc').set({
      [column]:sql`${JSON.stringify(updated)}::jsonb`
    }).where('id','=','loc').executeTakeFirst();
  }
  return returnValue;
}

async function refreshScopeSearchSummary(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const galaxy=sql.ref('silver.'+scope+'_galaxy');
  const response=await sql`select count(*)::integer as article_count,
      coalesce(sum(char_length(regexp_replace(
        regexp_replace(content,'<[^>]*>','','g'),
        '[[:space:]　]+','','g'))),0)::bigint as word_count,
      min(coalesce(date,(createtime at time zone 'Asia/Taipei')::date))::text as first_date,
      max(coalesce(date,(createtime at time zone 'Asia/Taipei')::date))::text as last_date
    from ${galaxy}
    where search is true and nullif(btrim(content),'') is not null`.execute(trx);
  const row=response.rows[0]||{};
  const snapshot={article_count:Number(row.article_count||0),
    word_count:Number(row.word_count||0),
    first_date:row.first_date||null,last_date:row.last_date||null,
    refreshed_at:new Date().toISOString()};
  if(!Number.isSafeInteger(snapshot.word_count))reject('Search word count exceeds safe integer limit');
  const result=await trx.updateTable('silver.'+scope)
    .set({status:sql`jsonb_set(coalesce(status,'{}'::jsonb),
      '{search}',${JSON.stringify(snapshot)}::jsonb,true)`})
    .where('id','=',scope).executeTakeFirst();
  if(Number(result?.numUpdatedRows||0)!==1)
    reject('Scope search summary was not saved');
  return {scope_id:scope,...snapshot};
}

async function mergeScopePoints(trx,args){
  const keep=validUid(args.p_keep_uid),removed=args.p_remove_uids;
  if(!Array.isArray(removed)||removed.length<1||removed.length>100||
     removed.some(id=>!UID.test(String(id))||id===keep)||
     new Set(removed).size!==removed.length)reject('Invalid Point merge UIDs');
  const scope=await scopedWrite(trx,args.p_scope_id);
  const anchor='silver.'+scope+'_anchor',galaxy='silver.'+scope+'_galaxy';
  const points=await trx.selectFrom(anchor).select(['uid','title','attr'])
    .where('type','=','point').where('uid','in',[keep,...removed]).forUpdate().execute();
  if(points.length!==removed.length+1)reject('Missing or cross-Scope Points');
  const ref=sql.ref(anchor);
  const overlap=await sql`select exists(
    select 1 from ${ref} a where a.type in ('path','trace')
      and jsonb_typeof(a.attr->'point')='array'
      and (a.attr->'point') ? ${keep}
      and (a.attr->'point') ?| ${removed}::text[]
    ) as conflict`.execute(trx);
  if(overlap.rows[0]?.conflict===true)
    reject('Route already contains kept and removed Points');
  const aliases=[...new Set(points.flatMap(p=>{
    const raw=p.attr?.location,stored=Array.isArray(raw)?raw:
      typeof raw==='string'?[raw]:[];
    return [p.title,...stored];
  }).filter(t=>typeof t==='string'&&t.trim()).map(t=>t.trim()))].sort();
  // A merged place_id can have many historical location spellings. Preserve
  // every timestamp in both Points and their linked Galaxy articles before
  // the original place_id references are rewritten.
  const galaxyRef=sql.ref(galaxy);
  const allUids=[keep,...removed];
  const sources=await sql`select coalesce(jsonb_agg(t.ts order by t.ts),'[]'::jsonb) as times
    from (
      select distinct ts from (
        select x.value as ts from ${ref} a
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(a.attr->'times')='array'
              then a.attr->'times' else '[]'::jsonb end) x(value)
          where a.type='point' and a.uid=any(${allUids}::text[])
        union all
        select to_char(g.createtime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ts
          from ${galaxyRef} g where g.place_id=any(${allUids}::text[])
            and g.createtime is not null
      ) x where ts is not null and ts<>''
    ) t`.execute(trx);
  const mergedTimes=sources.rows[0]?.times||[];
  // Both route and article links must move before source points are deleted.
  await sql`update ${ref} a set attr=jsonb_set(a.attr,'{point}',
    (select coalesce(jsonb_agg(case when x.value=any(${removed}::text[])
      then to_jsonb(${keep}::text) else to_jsonb(x.value) end
      order by x.ord),'[]'::jsonb)
      from jsonb_array_elements_text(a.attr->'point')
      with ordinality x(value,ord)),true)
    where a.type in ('path','trace') and jsonb_typeof(a.attr->'point')='array'
      and (a.attr->'point') ?| ${removed}::text[]`.execute(trx);
  const galaxyResult=await trx.updateTable(galaxy)
    .set({place_id:keep}).where('place_id','in',removed).executeTakeFirst();
  const keepResult=await trx.updateTable(anchor)
    .set({attr:sql`jsonb_set(
      jsonb_set(attr,'{location}',${JSON.stringify(aliases)}::jsonb,true),
      '{times}',${JSON.stringify(mergedTimes)}::jsonb,true)`})
    .where('uid','=',keep).where('type','=','point').executeTakeFirst();
  if(Number(keepResult?.numUpdatedRows||0)!==1)reject('Kept Point not updated');
  const deleted=await trx.deleteFrom(anchor)
    .where('type','=','point').where('uid','in',removed).executeTakeFirst();
  const count=Number(deleted?.numDeletedRows||0);
  if(count!==removed.length)reject('Point merge was not complete',409);
  return count;
}
async function importSharedKeywordClass(trx,args){
  const from=validScope(args.p_source_scope),to=validScope(args.p_target_scope);
  const classUid=validUid(args.p_class_uid);
  if(from===to)reject('Source and target Scopes must differ');
  // Authorization on target is inherited from the established Clerk session.
  await scopedWrite(trx,to);
  const sourceRegistry=await trx.selectFrom('api.manage')
    .select('id').where('id','=',from).where('manage_role','=','scope')
    .where('active','=',true).executeTakeFirst();
  if(!sourceRegistry)reject('Source Scope unavailable');
  const sourceConfig=await trx.selectFrom('silver.'+from).select('keyword_meta')
    .where('id','=',from).executeTakeFirst();
  if(sourceConfig?.keyword_meta?.class_shares?.[classUid]!==true)
    reject('Source Keyword Class is not public',403);
  const source='silver.'+from+'_anchor',target='silver.'+to+'_anchor';
  const root=await trx.selectFrom(source)
    .select(['uid','title','description','invisible','attr'])
    .where('uid','=',classUid).where('type','=','class').executeTakeFirst();
  if(!root)reject('Source Class not found');
  // CSPRNG Base62 identities and the target UID primary key replace the
  // PostgreSQL-only advisory lock; this operation remains transactional.
  // Use the existing UID primary key to reject rare collisions as part of
  // INSERT itself; no per-key SELECT or full table comparison is needed.
  const assigned=new Set();
  const insertCopy=async(type,node,attr)=>{
    for(let attempt=0;attempt<32;attempt++){
      const uid=allocateAnchorUid(assigned);
      assigned.add(uid);
      const inserted=await trx.insertInto(target).values({
        uid,type,title:node.title,description:node.description,
        invisible:node.invisible,attr
      }).onConflict(oc=>oc.column('uid').doNothing())
        .returning('uid').executeTakeFirst();
      if(inserted?.uid===uid)return uid;
    }
    reject('Cannot allocate unique Anchor UID');
  };
  const readChild=async(uid,type)=>{
    const row=await trx.selectFrom(source)
      .select(['uid','title','description','invisible','attr'])
      .where('uid','=',uid).where('type','=',type).executeTakeFirst();
    if(!row)reject('Source Keyword '+type+' reference not found');
    return row;
  };
  const links=node=>Array.isArray(node?.attr?.uid)?node.attr.uid:[];
  const groupIds=[];
  let items=0;
  for(const groupId of links(root)){
    if(!UID.test(String(groupId)))reject('Invalid source Group UID');
    const group=await readChild(groupId,'group');
    const mapped=[];
    for(const itemId of links(group)){
      if(!UID.test(String(itemId)))reject('Invalid source Item UID');
      const item=await readChild(itemId,'item');
      const terms=Array.isArray(item.attr?.keyword)?item.attr.keyword:[];
      const uid=await insertCopy('item',item,{keyword:terms});
      mapped.push(uid);items++;
    }
    const uid=await insertCopy('group',group,{uid:mapped});
    groupIds.push(uid);
  }
  const newClass=await insertCopy('class',root,{uid:groupIds});
  return {scopeid:to,uid:newClass,source_scopeid:from,
    source_uid:classUid,group_count:groupIds.length,item_count:items};
}

async function findGalaxyDuplicates(trx,args){
  const scope=await scopedWrite(trx,args.p_scope_id);
  const galaxy=sql.ref('silver.'+scope+'_galaxy');
  const result=await sql`select site,createtime,count(*)::integer as dup_count,
      array_agg(uid::text order by "UpdateTime" desc nulls last) as uids,
      array_agg(title::text order by "UpdateTime" desc nulls last) as titles,
      array_agg("UpdateTime" order by "UpdateTime" desc nulls last) as update_times,
      array_agg((content ~ E'[\\r\\n]' or content ~ E'\\\\[nrt]')
        order by "UpdateTime" desc nulls last) as newline_flags
    from ${galaxy}
    where createtime is not null and content is not null and content<>''
    group by site,createtime,
      regexp_replace(content,E'[\\s\\\\]|\\\\[nrt]','','g')
    having count(*)>1 order by createtime`.execute(trx);
  return result.rows.map(group=>({
    site:group.site,createtime:group.createtime,
    dup_count:Number(group.dup_count),uids:group.uids,
    titles:group.titles,update_times:group.update_times,
    newline_flags:group.newline_flags
  }));
}
