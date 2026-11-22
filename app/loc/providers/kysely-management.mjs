// CURRENT management pipeline: verified LOC Web grant -> physical Kysely
// transaction -> ZModel field/policy checks -> typed Tree/Model validation.
// Historical RPC/legacy payload helpers are not independent authorities;
// Tree Models do not grant access, run SQL, or create additional relations.
import {canLocAccess,locAccessRows} from './loc-authorization.mjs';
import {fixedManageScope} from '../permissions/fixed-manage-registry.mjs';
import {publishedManagedScope} from './published-managed-scope.mjs';
import {provisionScopeNative,manageScopeRegistryNative,deleteScopeNative}
  from './kysely-scope-lifecycle.mjs';
import {modelFieldsForSql,modelNameForSql,modeledPrimaryKeyColumns,
  modeledBooleanColumns,zmodelRegistryJoin,verifyModeledSqlFields}
  from '../../../packages/zenstack/model-column-guard.mjs';
import {managedRowsIssue,managedUpdateValuesValid,managedFiltersValid,
  MANAGED_FILTER_SQL} from '../../../packages/zenstack/sql-input-shape.mjs';
import {assertZModelGalaxyManagedValues,assertZModelAnchorBlockManagedValues,
  assertZModelSelectRows} from '../../../packages/zenstack/import-validation.mjs';
import {validateLocRegistryDomain} from './loc-domain.mjs';
import {sql} from 'kysely';
import {repairBeforeUidDelete} from './uid-dependency-before-delete.mjs';
import {saveBlocksKysely} from './kysely-blocks.mjs';
import {saveTracePageInTransaction} from './kysely-trace-page.mjs';
import {decodeRuntimeIo,encodeRuntimeIo} from '../query/query-batch-size.mjs';
import {allocateAnchorUid} from '../model/uid.js';
import {ANCHOR_TYPE_GROUPS,PERSISTED_ANCHOR_TYPES,mediaAnchorProjection}
  from '../../../packages/zenstack/anchor-hierarchy.mjs';
import * as z from 'zod';
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
import {readItemKeywordProjection,itemKeywordStatistics,
  itemKeywordSuggestions} from '../keywords/item-count-analysis.mjs';
import {parseSearchQuery} from '../search/query.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';

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
  const issue=managedRowsIssue(value);
  if(issue)reject(issue==='batch'?'Invalid managed rows':'Invalid managed row');
  return value;
}
function validateFilters(value){
  if(!Array.isArray(value)||!value.length||value.length>20)
    reject('Managed write requires filters');
  if(!managedFiltersValid(value))reject('Invalid managed filter');
  return value;
}
function withFilters(query,filters){
  for(const filter of filters)
    query=query.where(filter.column,MANAGED_FILTER_SQL[filter.operator||'eq'],filter.value);
  return query;
}

// node-postgres serializes JS arrays as PostgreSQL array literals, not JSON.
// Consult the existing ZModel field types for the authorized physical relation
// rather than maintaining a second hand-written JSONB column list. This adds
// no schema introspection, database call, connection or ORM write path.
export function postgresManagedJsonbValues(values,relation){
  const [namespace,table]=String(relation||'').split('.');
  const fields=namespace&&table?modelFieldsForSql(namespace,table):null;
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[
    key,fields?.[key]?.type==='Json'&&value!==null&&typeof value==='object'
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
  const namespace=table==='manage'?'api':'silver';
  // The same physical-to-ZModel mapping used by SQL column guards and Zod.
  // An explicitly bound PolicyPlugin model must match the physical relation.
  const mapped=modelNameForSql(namespace,table);
  if(modelName&&mapped!==modelName)
    reject('Invalid fixed LOC primary key metadata');
  const keys=modeledPrimaryKeyColumns(namespace,table);
  if(keys?.length)return keys;
  if(modelName)reject('Invalid fixed LOC primary key metadata');
  // Registry-approved custom Scope configurations and nonstandard physical
  // table names are not in the frozen 17-model snapshot. Preserve their
  // existing Kysely primary-key behavior after authorizeRelation(), rather
  // than guessing a ZModel or changing database routing.
  return [SCOPED_SUFFIXES.some(suffix=>table.endsWith(suffix))?'uid':'id'];
}
// Every operation in one managed transaction uses the SAME trusted registry
// snapshot. Do not issue one api.manage SELECT per Anchor/Galaxy operation.
// Cache lives only as long as the owning Kysely transaction object; a write
// to api.manage invalidates it before any subsequent operation in that trx.
const transactionRegistry=new WeakMap();
async function registeredScope(trx,scope){
  // Built-in Scope table names are fixed public JS data: zero Registry SQL.
  // Unpublished custom Scopes continue to use transactional SQL lookup.
  const fixed=publishedManagedScope(scope);
  if(fixed)return fixed;
  let cache=transactionRegistry.get(trx);
  if(!cache){cache=new Map();transactionRegistry.set(trx,cache);}
  if(!cache.has(scope)){
    cache.set(scope,trx.selectFrom('api.manage')
      .select(['id','manage_role','active','galaxy_table','anchor_table'])
      .where('id','=',scope).executeTakeFirst());
  }
  return cache.get(scope);
}
async function authorizeRelation(trx,table,operation,values,filters,rows){
  if(table==='manage'||table==='loc'||table==='loc_anchor'){
    if(table==='loc'&&(Object.hasOwn(values||{},'ArticleTag')||rows.some(row=>Object.hasOwn(row,'ArticleTag'))))
      reject('LOC ArticleTag is fixed and cannot be configured',403);
    if(!await canLocAccess(trx,'global'))reject('Global management permission required',403);
    return;
  }
  if(table==='lrunes_daily'){
    if(!await canLocAccess(trx,'scope','lrunes'))
      reject('Daily Rune management permission required',403);
    return;
  }
  // LOC text frames are no longer a managed physical Blocks table.
  if(table==='loc_blocks')reject('LOC Blocks have moved to loc_anchor; use save_blocks',400);
  const scope=scopeFromTable(table);
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||!await canLocAccess(trx,'scope',scope))
    reject('Scope management permission required',403);
  // Verify the dynamic registry mapping before escalating to the trusted
  // server connection. Caller input can never pick an arbitrary table.
  const record=await registeredScope(trx,scope);
  if(!record||!['scope','admin'].includes(record.manage_role))reject('Scope is not registered',403);
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
  // All approved Galaxy columns use the existing ZModel/Zod payload checks.
  // The SQL update is one JSONB recordset inside the caller's one transaction:
  // no special-field one-row requests and no additional ad-hoc ORM layer.
  const supported=new Set(['uid','title','content','place_id','url','media_link',
    'location','site_id','ref_id','source_id','target_id']);
  const seen=new Set();
  for(const row of validateRows(rows)){
    if(!UID.test(String(row.uid||''))||!Object.keys(row).some(k=>k!=='uid')||
      Object.keys(row).some(k=>!supported.has(k))||seen.has(row.uid))
      reject('Invalid article update batch');
    seen.add(row.uid);
  }
  const ref=sql.ref('silver.'+table);
  const typed=column=>sql`(jsonb_populate_record(NULL::${ref},j.item)).${sql.ref(column)}`;
  const setFields=['title','content','url','media_link','location',
    'site_id','ref_id','source_id','target_id'];
  const updates=setFields.map(column=>
    sql`${sql.ref(column)}=case when j.item ? ${column}
      then ${typed(column)} else ${sql.ref('g.'+column)} end`);
  updates.push(sql`place_id=case when coalesce(btrim(g.place_id),'')=''
    then coalesce(nullif(btrim(j.item->>'place_id'),''),g.place_id) else g.place_id end`);
  updates.push(sql`"UpdateTime"=now()`);
  const changed=sql.join([
    ...setFields.map(column=>sql`(j.item ? ${column}
      and ${sql.ref('g.'+column)} is distinct from ${typed(column)})`),
    sql`(j.item ? 'place_id' and coalesce(btrim(g.place_id),'')=''
      and nullif(btrim(j.item->>'place_id'),'') is not null)`
  ],sql` or `);
  const result=await sql`
    update ${ref} as g set ${sql.join(updates)}
    from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) as j(item)
    where g.uid=(j.item->>'uid')::char(8) and (${changed})
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
  if(!['insert','upsert','update','delete','update_batch',
    'append_media_link'].includes(operation))
    reject('Invalid managed write operation');
  const rows=['insert','upsert'].includes(operation)?validateRows(payload.p_rows):[];
  const values=payload.p_values;
  const filters=['update','delete'].includes(operation)?validateFilters(payload.p_filters):[];
  if(operation==='update'&&!managedUpdateValuesValid(values))
    reject('Invalid managed update values');
  if(operation==='update_batch'&&table.endsWith('_galaxy')===false)
    reject('Article batches must target a Galaxy table');
  if(table==='manage'){
    if(['insert','upsert'].includes(operation))for(let i=0;i<rows.length;i++)
      rows[i]=validateLocRegistryDomain(rows[i]);
    if(operation==='update'&&Object.hasOwn(values,'domain'))
      Object.assign(values,validateLocRegistryDomain(values));
  }
  await authorizeRelation(trx,table,operation,values,filters,rows);
  if(operation==='append_media_link'){
    // A purpose-only Galaxy/MediaAnchor link, not arbitrary SQL mutation.
    // The Anchor INSERT and this row-locked append belong to the same
    // existing Kysely transaction and cannot overwrite concurrent links.
    if(!/^[a-z][a-z0-9]{0,14}_galaxy$/.test(table)||
      !values||typeof values!=='object'||Array.isArray(values)||
      Object.keys(values).sort().join(',')!=='article_uid,media_uid'||
      !UID.test(values.article_uid)||!UID.test(values.media_uid)||
      payload.p_filters!==undefined&&payload.p_filters?.length)
      reject('Invalid LOC MediaAnchor link operation');
    const scope=table.slice(0,-7),galaxy='silver.'+table;
    const linked=await trx.selectFrom('silver.'+scope+'_anchor')
      .select('uid').where('uid','=',values.media_uid)
      .where('type','in',ANCHOR_TYPE_GROUPS.media).executeTakeFirst();
    if(!linked)reject('MediaAnchor was not inserted in this Scope',409);
    const article=await trx.selectFrom(galaxy).select('media_link')
      .where('uid','=',values.article_uid).forUpdate().executeTakeFirst();
    if(!article)reject('Linked Galaxy article does not exist',409);
    const prior=Array.isArray(article.media_link)?article.media_link:[];
    const next=[...new Set([...prior.map(String),values.media_uid])];
    // Same row lock and transaction: no stale browser-side replacement.
    const updated=await trx.updateTable(galaxy)
      .set({media_link:next}).where('uid','=',values.article_uid)
      .executeTakeFirst();
    if(Number(updated?.numUpdatedRows||0)!==1)
      reject('Media link update did not complete',409);
    return {data:{count:1}};
  }
  // Authorized writes now share the exact ZModel column guard already used
  // by query SELECT/UPDATE. Unmodeled, explicitly authorized custom Scope
  // relations retain their existing Kysely handling.
  const modelValues=['insert','upsert'].includes(operation)?rows:
    operation==='update'?values:
    operation==='update_batch'?payload.p_rows:null;
  const namespace=table==='manage'?'api':'silver';
  // Zod verifies the actual values for each modeled Galaxy operation,
  // including partial updates. ZModel already covers its column names:
  // do not traverse those same row keys again in the generic SQL guard.
  const galaxyValidated=assertZModelGalaxyManagedValues(
    namespace+'.'+table,operation,modelValues);
  const anchorBlockValidated=!galaxyValidated&&assertZModelAnchorBlockManagedValues(
    namespace+'.'+table,operation,modelValues);
  verifyModeledSqlFields({
    schema:namespace,table,
    values:galaxyValidated||anchorBlockValidated?null:modelValues,filters
  });
  // The signed identity and current access grants were verified before this
  // operation; fixed table names come from the JS Registry. Only then
  // does the existing trusted Kysely connection execute the mutation.
  // This does not introduce a database Auth API or a separate SQL Gateway.
  await sql`reset role`.execute(trx);
  const relation=table==='manage'?'api.manage':'silver.'+table;
  // modelName is only a verified ZModel policy identity; Kysely queries
  // must address the actual SQL relation, never the logical model name.
  const name=relation;
  if(operation==='update'){
    // Every authorized managed relation has a fixed single-column PK:
    // Registry and Scope config -> id; Galaxy/Anchor/Blocks -> uid.
    // These were checked against the live PostgreSQL catalog. There is no
    // need for one pg_index SELECT on every edit, including dynamic Scopes.
    const keys=managedPrimaryKeyColumns(table,modelName);
    if(keys.some(key=>Object.hasOwn(values,key)))
      reject('Primary keys cannot be updated');
  }
  const dependencyRepair=operation==='delete'
    ?await repairBeforeUidDelete(trx,{table,filters,
      serialize:(values,target)=>postgresManagedJsonbValues(values,target)})
    :null;
  let count=0;
  if(operation==='update_batch')count=await writeBatch(trx,table,payload.p_rows);
  else if(operation==='upsert'){
    const keys=managedPrimaryKeyColumns(table,modelName);
    if(keys.length!==1)reject('Composite primary key cannot be upserted');
    const primary=keys[0];
    for(const row of rows){
      if(row[primary]===undefined||row[primary]===null)
        reject('Upsert requires an explicit primary key');
      const document=postgresManagedJsonbValues(row,relation);
      const updates={...document};delete updates[primary];
      const builder=trx.insertInto(name).values(document);
      const result=await builder.onConflict(oc=>updates&&Object.keys(updates).length
        ?oc.column(primary).doUpdateSet(updates):oc.column(primary).doNothing()).executeTakeFirst();
      count+=Number(result?.numInsertedOrUpdatedRows??result?.numAffectedRows??1);
    }
  }else if(operation==='insert'){
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
    const base=operation==='update'?trx.updateTable(name).set(postgresManagedJsonbValues(values,relation)):trx.deleteFrom(name);
    const result=await withFilters(base,filters).execute();
    count=Number(result[0]?.numUpdatedRows??result[0]?.numDeletedRows??result[0]?.numAffectedRows??0);
  }
  // Never commit dependent changes if the final PK DELETE did not complete.
  if(operation==='delete'&&dependencyRepair?.affected&&count!==1)
    reject('UID was modified during reference cleanup; DELETE refused',409);
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


// Only existing Galaxy Boolean fields can be bulk-toggled. Read the actual
// ZModel contract shared by both fixed Scope exemplars; no second flag map.
const GALAXY_BULK_FLAGS=new Set(modeledBooleanColumns('silver','lo3rwang_galaxy'));
const runeGalaxyFlags=modeledBooleanColumns('silver','lrunes_galaxy');
if(!GALAXY_BULK_FLAGS.size||GALAXY_BULK_FLAGS.size!==runeGalaxyFlags.length||
   runeGalaxyFlags.some(name=>!GALAXY_BULK_FLAGS.has(name)))
  throw new Error('LOC Galaxy Boolean ZModel contracts differ');
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
  if(!await canLocAccess(trx,'scope',scope))reject('Scope management permission required',403);
  // Reuse the Scope Registry. Do not trust user-supplied SQL relation names.
  const registry=await registeredScope(trx,scope);
  if(!['scope','admin'].includes(registry?.manage_role)||registry.galaxy_table!=='galaxy')
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
const ACTIONS=new Set(['read_group_members','read_loc_source_hierarchy','update_group_member_name',
  'move_scope_block',
  'preview_or_fill_galaxy_place','batch_fill_galaxy_location',
  'rename_scope_site_batch','save_scope_trace_place_names','save_blocks','loc_admin_settings',
  'refresh_scope_search_summary','merge_scope_trace_place_names','import_shared_keyword_class','loc_access','find_galaxy_duplicates','read_scope_registry_admin','bulk_update_galaxy_able',
  'sync_search_patterns','suggest_search_patterns','keyword_pattern_statistics',
  'media_anchor_candidates','anchor_import_page','import_site_presence',
  'search_galaxy_private','provision_scope','manage_scope_registry','delete_scope',
  'save_scope_trace_edit']);
// Source existence is a bounded per-Scope Galaxy projection, not a SiteAnchor
// title lookup. It never resolves or mutates Source hierarchy UIDs.
// A Search-only, read-only action behind the verified LOC Web Session.
// No browser SELECT may bypass Galaxy.search/list on the public query route.
const PRIVATE_SEARCH_COLUMNS=Object.freeze(galaxyReadColumns('GalaxyList'));
const privateSearchSchema=z.strictObject({
  p_scope_id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  p_query:z.string().trim().min(1).max(180),
  p_offset:z.number().int().min(0).max(100000).default(0),
  p_limit:z.number().int().min(1).max(100).default(50),
  p_start_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  p_end_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  p_sort_direction:z.enum(['asc','desc']).default('asc'),
  p_content_type:z.enum(['','galaxy','lyrics_work','text_work']).default(''),
  p_source_mode:z.enum(['all','names','others','none']).default('all'),
  p_sources:z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  p_place_only:z.boolean().default(false)
});
function privateSearchLike(value){
  // A query term is literal text. Escape SQL LIKE wildcards and backslashes.
  return '%'+String(value).replace(/[\\%_]/g,char=>'\\'+char)+'%';
}
async function searchPrivateGalaxy(trx,args,claims){
  // A Search manager preference is not an ACL or editor grant. Only the
  // server-verified OAuth principal's own loc_user row may opt into this
  // read-only path, and the existing Scope eligibility remains mandatory.
  if(claims?.provider!=='loc'||claims?.role!=='authenticated'||
    !/^[A-Za-z0-9_-]{8,128}$/.test(String(claims.sub||'')))
    reject('Verified search session required',403);
  const preferences=await trx.selectFrom('silver.loc_user')
    .select('search').where('owner_id','=',claims.sub).executeTakeFirst();
  if(preferences?.search?.list!==true)
    reject('Manager search preference disabled',403);
  const parsed=privateSearchSchema.safeParse(args);
  if(!parsed.success)reject('Invalid private Search request');
  const {p_scope_id:scope,p_query:raw,p_offset:offset,p_limit:limit,
    p_start_date:start,p_end_date:end,p_sort_direction:direction,
    p_content_type:contentType,p_source_mode:sourceMode,p_sources:sources,
    p_place_only:placeOnly}=parsed.data;
  if(scope==='loc'||scope==='local'||!await canLocAccess(trx,'scope',scope))
    reject('Private Search Scope access denied',403);
  const registry=await registeredScope(trx,scope);
  if(registry?.manage_role!=='scope'||registry.active!==true||registry.galaxy_table!=='galaxy')
    reject('Private Search Scope unavailable',403);
  if(start&&end&&start>end)reject('Invalid private Search time range');
  const parsedTerms=parseSearchQuery(raw);
  if(!parsedTerms.groups.length||parsedTerms.groups.length>12||
    parsedTerms.terms.length>24||parsedTerms.excludes.length>24||
    [...parsedTerms.terms,...parsedTerms.excludes].some(word=>word.length>120))
    reject('Invalid private Search terms');
  if(sourceMode==='names'&&!sources.length)return {data:{rows:[],hasMore:false,nextCursor:null},count:0};
  await sql`reset role`.execute(trx);
  const field=placeOnly?'location':'content';
  let query=trx.selectFrom('silver.'+scope+'_galaxy')
    .select(PRIVATE_SEARCH_COLUMNS);
  query=query.where(eb=>eb.or(parsedTerms.groups.map(group=>
    eb.and(group.map(term=>eb(field,'ilike',privateSearchLike(term))))
  )));
  for(const term of parsedTerms.excludes)
    query=query.where(field,'not ilike',privateSearchLike(term));
  if(start)query=query.where('date','>=',start);
  if(end)query=query.where('date','<=',end);
  if(contentType==='lyrics_work')query=query.where('site','ilike','suno');
  if(contentType==='text_work')query=query.where('site','not ilike','suno');
  // Exact case-folded Source matches; never interpret user-selected %/_ as LIKE.
  if(sourceMode==='names')
    query=query.where(sql`lower(site)`,'in',sources.map(v=>v.toLowerCase()));
  else if(sourceMode==='others'&&sources.length)
    query=query.where(eb=>eb.or([
      eb('site','is',null),
      eb(sql`lower(site)`,'not in',sources.map(v=>v.toLowerCase()))
    ]));
  else if(sourceMode==='none')return {data:{rows:[],hasMore:false,nextCursor:null},count:0};
  const rows=await query.orderBy('date',direction).orderBy('uid','asc')
    .offset(offset).limit(limit+1).execute();
  const visible=rows.slice(0,limit);
  assertZModelSelectRows('silver.'+scope+'_galaxy',PRIVATE_SEARCH_COLUMNS,visible);
  return {data:{rows:visible,hasMore:rows.length>limit,
    nextCursor:rows.length>limit?offset+limit:null},count:visible.length};
}

const importSitePresenceArgsSchema=z.strictObject({
  p_scope_id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  p_sites:z.array(z.string().max(512)).min(1).max(200)
});
const importSitePresenceResultSchema=z.array(z.strictObject({
  site_key:z.string().max(512)
})).max(200);
// Use the same 19 ZModel Anchor discriminator values; no shadow model or table.
const ANCHOR_IMPORT_PAGE_COLUMNS=Object.freeze([
  'uid','type','title','description','attr','createtime'
]);
// Media lookup matches only caller-supplied UID or exact stored URL;
// a matching URL is not a physical unique key. Read every candidate page.
const mediaImportCandidateArgsSchema=z.strictObject({
  p_scope_id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  p_uids:z.array(z.string().regex(UID)).max(200),
  p_urls:z.array(z.string().max(2048).regex(/^https?:\/\//i)).max(200),
  p_after_uid:z.string().regex(UID).nullable().optional(),
  p_limit:z.number().int().min(1).max(200).default(200)
});
const MEDIA_IMPORT_CANDIDATE_COLUMNS=Object.freeze([
  'uid','type','title','description','attr','createtime','invisible'
]);
const anchorImportPageArgsSchema=z.strictObject({
  p_scope_id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  p_types:z.array(z.enum(PERSISTED_ANCHOR_TYPES)).min(1)
    .max(PERSISTED_ANCHOR_TYPES.length)
    .refine(values=>new Set(values).size===values.length),
  p_after_uid:z.string().regex(UID).nullable().optional(),
  p_limit:z.number().int().min(1).max(750)
});
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
  const owner=await canLocAccess(trx,'scope',scope);
  await sql`reset role`.execute(trx);
  const config=await trx.selectFrom('silver.'+scope)
    .select(['keyword_meta','keyword_min_chars'])
    .where('id','=',scope).executeTakeFirst();
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
  const start=String(args.p_start_date||''),end=String(args.p_end_date||'');
  const source=String(args.p_source||'').trim();
  if([start,end].some(value=>value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))||
     start&&end&&start>end||source.length>120)
    reject('Invalid Keyword statistics date or source');
  const groups=groupUids.map(uid=>({uid,title:byGroup.get(uid).title}));
  let totals;
  if(start||end||source){
    const result=await readItemKeywordProjection(trx,scope,{
      items,groups,start,end,source,owner:true,
      minChars:Math.max(0,Number(config?.keyword_min_chars)||0)
    });
    totals=result.totals;
  }else{
    const n=await trx.selectFrom(table).select(['uid','num'])
      .where('uid','in',[classUid,...groupUids,...itemUids]).execute();
    const byUid=new Map(n.map(row=>[row.uid,Number(row.num)||0]));
    const receipt=config?.keyword_meta?.by_class?.[classUid]||{};
    totals={...receipt,
      itemCounts:Object.fromEntries(items.map(item=>[item.uid,byUid.get(item.uid)||0])),
      groupCounts:Object.fromEntries(groups.map(group=>[group.uid,byUid.get(group.uid)||0]))};
  }
  return {class_uid:classUid,class_name:String(root.title||''),
    ...itemKeywordStatistics(items,groups,totals)};
}

// Suggestions come from authored Item vocabulary, not Pattern postings.
async function suggestSearchPatterns(trx,args){
  const requested=args.p_scope_ids;
  const query=String(args.p_query??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
  if(!Array.isArray(requested)||requested.length<1||requested.length>50||
     requested.some(scope=>typeof scope!=='string'||!/^[a-z][a-z0-9]{0,14}$/.test(scope))||
     query.length>120)reject('Invalid search-pattern request');
  const granted=[];
  for(const id of new Set(requested))
    if(await canLocAccess(trx,'scope',id))granted.push(id);
  if(!granted.length)reject('No authorized Keyword Scope',403);
  await sql`reset role`.execute(trx);
  const found=new Map();
  for(const scope of granted){
    const rows=await trx.selectFrom('silver.'+scope+'_anchor')
      .select(['title','attr']).where('type','=','item').execute();
    for(const row of itemKeywordSuggestions(rows.map(item=>({
      item_name:item.title,keywords:Array.isArray(item.attr?.keyword)?item.attr.keyword:[]
    })),query)){
      const key=String(row.pattern).normalize('NFKC').toLocaleLowerCase('zh-Hant');
      if(!found.has(key))found.set(key,row);
    }
  }
  return [...found.values()].sort((a,b)=>a.pattern.localeCompare(b.pattern)).slice(0,10);
}

async function syncSearchPatterns(){
  // Retired writer: no frontend or extension can recreate Galaxy UID postings.
  reject('Item keyword analysis no longer writes Pattern indexes',410);
}

export async function executeManagedKyselyAction(trx,body,claims={}){
  const name=String(body?.name||'');
  if(!ACTIONS.has(name)||!body.args||typeof body.args!=='object'||
    Array.isArray(body.args))reject('Unknown Kysely action');
  const args=body.args;
  const keys={
    read_group_members:['p_group_id'],
    read_loc_source_hierarchy:[],
    update_group_member_name:['p_group_id','p_member_id','p_display_name'],
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
    loc_access:['p_type','p_id'],
    find_galaxy_duplicates:['p_scope_id'],
    read_scope_registry_admin:[],
    provision_scope:['p_scope_id','p_display_name','p_email','p_birthday',
      'p_domain','p_directory','p_parent_scope_id','p_theme','p_locale','p_copy_keywords'],
    manage_scope_registry:['p_operation','p_scope_id','p_values'],
    delete_scope:['p_scope_id'],
    save_scope_trace_edit:['p_scope_id','p_renames','p_point','p_keep_uid','p_merge_uids','p_visibility'],
    sync_search_patterns:['p_scope_id','p_class_uid','p_patterns','p_final'],
    suggest_search_patterns:['p_scope_ids','p_query'],
    keyword_pattern_statistics:['p_scope_id','p_class_uid','p_start_date','p_end_date','p_source'],
    media_anchor_candidates:['p_scope_id','p_uids','p_urls','p_after_uid','p_limit'],
    anchor_import_page:['p_scope_id','p_types','p_after_uid','p_limit'],
    import_site_presence:['p_scope_id','p_sites'],
    search_galaxy_private:['p_scope_id','p_query','p_offset','p_limit',
      'p_start_date','p_end_date','p_sort_direction','p_content_type',
      'p_source_mode','p_sources','p_place_only']
  }[name];
  if(Object.keys(args).some(key=>!keys.includes(key)))reject('Unexpected Kysely action argument');
  if(name==='provision_scope')
    return {data:await provisionScopeNative(trx,args),count:null};
  if(name==='manage_scope_registry')
    return {data:await manageScopeRegistryNative(trx,args),count:null};
  if(name==='delete_scope')
    return {data:await deleteScopeNative(trx,args),count:null};
  if(name==='save_scope_trace_edit'){
    const scope=await scopedWrite(trx,args.p_scope_id);
    return {data:await saveTracePageInTransaction(trx,scope,args,
      mergeArgs=>mergeScopePoints(trx,mergeArgs,{authorizedScope:scope})),count:null};
  }
  if(name==='search_galaxy_private')return searchPrivateGalaxy(trx,args,claims);
  if(name==='import_site_presence'){
    // Verified Better Auth LOC Web Session + active api.manage Scope grants.
    // A single Kysely SELECT answers up to 200 exact case-insensitive site
    // existence checks, without reading article UIDs/content or SiteAnchor.
    const parsed=importSitePresenceArgsSchema.safeParse(args);
    if(!parsed.success)reject('Invalid Zod import site presence request');
    const {p_scope_id:scope,p_sites:sites}=parsed.data;
    if(scope==='loc'||scope==='local'||!await canLocAccess(trx,'scope',scope))
      reject('Import site Scope access denied',403);
    await sql`reset role`.execute(trx);
    const keys=[...new Set(sites.map(site=>site.toLowerCase()))];
    const rows=await trx.selectFrom('silver.'+scope+'_galaxy')
      .select(sql`lower(site)`.as('site_key'))
      .where(sql`lower(site)`,'in',keys)
      .distinct().execute();
    const checked=importSitePresenceResultSchema.safeParse(rows);
    if(!checked.success||rows.some(row=>!keys.includes(row.site_key)))
      reject('Import site presence SQL result invalid');
    return {data:rows.map(row=>row.site_key),count:rows.length};
  }
  if(name==='anchor_import_page'){
    // LOC Web import only. The native gateway verifies Better Auth Session
    // and api.manage before this Scope-specific read; this action grants no
    // insert/update rights and cannot be invoked on the MCP hostname.
    const parsed=anchorImportPageArgsSchema.safeParse(args);
    if(!parsed.success)reject('Invalid Zod Anchor import page request');
    const {p_scope_id:scope,p_types:types,p_after_uid:after,p_limit:limit}=parsed.data;
    if(scope==='loc'||scope==='local'||!await canLocAccess(trx,'scope',scope))
      reject('Anchor import Scope access denied',403);
    await sql`reset role`.execute(trx);
    let query=trx.selectFrom('silver.'+scope+'_anchor')
      .select(ANCHOR_IMPORT_PAGE_COLUMNS).where('type','in',types)
      .orderBy('uid','asc').limit(limit);
    if(after)query=query.where('uid','>',after);
    const rows=await query.execute();
    if(rows.some(row=>!types.includes(String(row.type))))
      reject('Anchor import query returned an unexpected ZModel type');
    // Model-generated Zod validates the physical Anchor envelope and UID.
    // Semantic uniqueness is deliberately NOT inferred from the UID PK.
    assertZModelSelectRows('silver.'+scope+'_anchor',ANCHOR_IMPORT_PAGE_COLUMNS,rows);
    return {data:rows,count:rows.length};
  }
  if(name==='media_anchor_candidates'){
    // Website-only, Better Auth verified import read. Authenticated Scope
    // grants are checked before the trusted PostgreSQL Kysely SELECT.
    const parsed=mediaImportCandidateArgsSchema.safeParse(args);
    if(!parsed.success)reject('Invalid Zod MediaAnchor candidate request');
    const {p_scope_id:scope,p_uids:uids,p_urls:urls,
      p_after_uid:after,p_limit:limit}=parsed.data;
    if(!await canLocAccess(trx,'scope',scope))
      reject('MediaAnchor import access denied',403);
    if(!uids.length&&!urls.length)return {data:[],count:0};
    await sql`reset role`.execute(trx);
    const conditions=[];
    if(uids.length)conditions.push(eb=>eb('uid','in',uids));
    if(urls.length)conditions.push(eb=>sql`(attr->>'url') in
      (${sql.join(urls.map(url=>sql`${url}`))})`);
    let query=trx.selectFrom('silver.'+scope+'_anchor')
      .select(MEDIA_IMPORT_CANDIDATE_COLUMNS)
      .where('type','in',ANCHOR_TYPE_GROUPS.media)
      .where(eb=>eb.or(conditions.map(condition=>condition(eb))))
      .orderBy('uid','asc').limit(limit);
    if(after)query=query.where('uid','>',after);
    const matches=await query.execute();
    // Physical ZModel+Zod verifies the selected rows; semantic duplicates
    // must reach the caller intact rather than fail at an arbitrary row cap.
    assertZModelSelectRows('silver.'+scope+'_anchor',MEDIA_IMPORT_CANDIDATE_COLUMNS,matches);
    if(matches.some(row=>!ANCHOR_TYPE_GROUPS.media.includes(row.type)))
      reject('MediaAnchor lookup returned a non-media type');
    return {data:matches.map(mediaAnchorProjection),count:matches.length};
  }
  if(name==='keyword_pattern_statistics')return {data:await keywordPatternStatistics(trx,args),count:null};
  if(name==='sync_search_patterns')return {data:await syncSearchPatterns(trx,args),count:null};
  if(name==='suggest_search_patterns')return {data:await suggestSearchPatterns(trx,args),count:null};
  if(name==='save_blocks'){
    const scope=validScope(args.p_scope_id);
    const page=String(args.p_type||'').trim();
    const authType=scope==='loc'&&page!=='index'?'global':'scope';
    if(!await canLocAccess(trx,authType,scope))reject('Block write permission denied',403);
    // One verification for the entire page, followed by a transactional batch.
    await sql`reset role`.execute(trx);
    return {data:await saveBlocksKysely(trx,args),count:null};
  }
  if(name==='read_loc_source_hierarchy'){
    // Same privileged, session-verified Kysely gateway used by Admin Registry:
    // RLS policy alone does not grant the browser's authenticated role SELECT.
    // Return only the fixed LOC Source hierarchy, never unrestricted anchors.
    if(!await canLocAccess(trx,'global'))reject('Global administrator required',403);
    await sql`reset role`.execute(trx);
    const columns=['uid','type','title','description','invisible','attr','createtime','num'];
    const rows=await trx.selectFrom('silver.loc_anchor')
      .select(columns)
      .where('type','in',ANCHOR_TYPE_GROUPS.source)
      .orderBy('uid','asc').execute();
    return {data:rows,count:rows.length};
  }
  if(name==='read_scope_registry_admin'){
    if(!await canLocAccess(trx,'global'))reject('Global administrator required',403);
    await sql`reset role`.execute(trx);
    const rows=await zmodelRegistryJoin(trx,{optionalLoc:true})
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
  if(name==='loc_access'){
    const type=String(args.p_type||'').toLowerCase();
    if(!['self','global','group','scope'].includes(type))reject('Invalid management type');
    const id=type==='self'?null:args.p_id??null;
    if(['group','scope'].includes(type)&&!/^[a-z][a-z0-9]{0,14}$/.test(String(id||'')))
      reject('Invalid management Scope');
    return {data:await locAccessRows(trx,type,id),count:null};
  }
  if(name==='merge_scope_trace_place_names')return {data:await mergeScopePoints(trx,args),count:null};
  if(name==='import_shared_keyword_class')return {data:await importSharedKeywordClass(trx,args),count:null};
  if(name==='refresh_scope_search_summary')return {data:await refreshScopeSearchSummary(trx,args),count:null};
  if(name==='loc_admin_settings')return {data:await managedLocSettings(trx,args,claims),count:null};
  if(name==='preview_or_fill_galaxy_place')return {data:await previewOrFillGalaxyPlace(trx,args),count:null};
  if(name==='batch_fill_galaxy_location')return {data:await batchFillGalaxyLocation(trx,args),count:null};
  if(name==='rename_scope_site_batch')return {data:await renameScopeSiteBatch(trx,args),count:null};
  if(name==='save_scope_trace_place_names')return {data:await saveScopePointAliases(trx,args),count:null};
  if(name==='read_group_members'){
    const group=validScope(args.p_group_id);
    if(!await canLocAccess(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const rows=await zmodelRegistryJoin(trx)
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
    if(!await canLocAccess(trx,'group',group))reject('Group management permission required',403);
    await sql`reset role`.execute(trx);
    const fixed=fixedManageScope(member);
    const parent=fixed ?
      fixed.parent_scope_id===group&&fixed.manage_role==='scope'?fixed:null:
      await trx.selectFrom('api.manage').select('id')
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
  const scope=validScope(args.p_scope_id);
  const rawPage=String(args.p_page_name||'').trim();
  const page=scope==='loc'?rawPage:rawPage.toLowerCase();
  const uid=validUid(args.p_uid);
  const direction=Number(args.p_direction);
  if(!page||page.length>80||![-1,1].includes(direction))
    reject('Invalid block move');
  const authorized=scope==='loc'
    ?(await canLocAccess(trx,'global')||(page==='index'&&await canLocAccess(trx,'group','loc')))
    :await canLocAccess(trx,'scope',scope);
  if(!authorized)reject('Block management permission required',403);
  await sql`reset role`.execute(trx);
  const loc=scope==='loc';
  const relation=loc?'silver.loc_anchor':'silver.'+scope+'_blocks';
  const pageField=loc?'type':'page_name',orderField=loc?'num':'block_order';
  await sql`select pg_advisory_xact_lock(hashtext(${scope}),hashtext(${page}))`.execute(trx);
  const original=await trx.selectFrom(relation).select(['uid',orderField])
    .where('uid','=',uid).where(pageField,'=',page).executeTakeFirst();
  if(!original)reject('Block not found on this page');
  let neighbor=trx.selectFrom(relation).select(['uid',orderField])
    .where(pageField,'=',page)
    .where(orderField,direction===-1?'<':'>',original[orderField]);
  neighbor=neighbor.orderBy(orderField,direction===-1?'desc':'asc');
  const next=await neighbor.limit(1).executeTakeFirst();
  if(!next)reject('Block is already at the page boundary');
  const ref=sql.ref(relation),orderRef=sql.ref(orderField),pageRef=sql.ref(pageField);
  const result=await sql`update ${ref}
    set ${orderRef}=case when uid=${uid} then ${next[orderField]} else ${original[orderField]} end
    where ${pageRef}=${page} and uid in (${uid},${next.uid})`.execute(trx);
  if(Number(result.numAffectedRows||0)!==2)reject('Block order update incomplete');
  return {data:{uid,block_order:next[orderField],
    neighbor_uid:next.uid,neighbor_order:original[orderField]},count:null};
}

async function scopedWrite(trx,input){
  const scope=validScope(input);
  if(!await canLocAccess(trx,'scope',scope))reject('Scope write permission required',403);
  const registry=await registeredScope(trx,scope);
  if(!registry||!['scope','admin'].includes(registry.manage_role)||registry.active!==true)
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
  if(!await canLocAccess(trx,'global'))reject('Global administrator required',403);
  const section=String(args.p_section||'');
  const operation=String(args.p_operation||'read');
  const key=String(args.p_key??'').trim();
  const value=args.p_value;
  if(!['theme','keywords','runtime'].includes(section))
    reject('Invalid LOC settings section');
  // Runtime I/O ceilings and a disabled ISR reservation belong to the
  // existing private api.manage admin JSON. This does not deploy an ISR route.
  // Reuse this existing global-admin action, not an anonymous SELECT path.
  if(section==='runtime'){
    if(key||!['read','update'].includes(operation))reject('Invalid runtime setting operation');
    const allowed=new Set(['io_limits','isr']);
    if(operation==='update'&&(!catalogObject(value)||!Object.keys(value).length||
        Object.keys(value).some(field=>!allowed.has(field))))
      reject('Invalid runtime setting fields');
    await sql`reset role`.execute(trx);
    let query=trx.selectFrom('api.manage').select('caches')
      .where('id','=','admin');
    if(operation==='update')query=query.forUpdate();
    const row=await query.executeTakeFirst();
    if(!row)reject('LOC Admin runtime settings unavailable');
    const previous=decodeRuntimeIo(row.caches);
    if(operation==='read')return previous;
    let next;
    try{next=encodeRuntimeIo({...previous,...value});}
    catch{reject('Invalid runtime setting values');}
    const result=await trx.updateTable('api.manage')
      .set({caches:sql`${JSON.stringify(next)}::jsonb`})
      .where('id','=','admin').executeTakeFirst();
    if(Number(result?.numUpdatedRows||0)!==1)
      reject('LOC Admin runtime settings were not saved');
    return next;
  }
  // Permission was established with the signed LOC business identity;
  // no arbitrary table is addressable through this route.
  await sql`reset role`.execute(trx);
  const row=await trx.selectFrom('silver.loc')
    .select(['theme','keywords'])
    .where('id','=','loc').forUpdate().executeTakeFirst();
  if(!row)reject('LOC Group settings unavailable');
  const saved=validCatalog(
    section==='theme'?row.theme:row.keywords,section);
  if(operation==='read')return saved;
  let updated=[],column='keywords',returnValue;
  if(section==='theme'){
    if(operation!=='upsert'||!/^[1-8]$/.test(key)||!catalogObject(value)||
       !Number.isInteger(value.theme_id)||value.theme_id!==Number(key)||
       !['dark','light'].includes(value.scheme)||
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
  }
  await trx.updateTable('silver.loc').set({
    [column]:sql`${JSON.stringify(updated)}::jsonb`
  }).where('id','=','loc').executeTakeFirst();
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

async function mergeScopePoints(trx,args,{authorizedScope=''}={}){
  const keep=validUid(args.p_keep_uid),removed=args.p_remove_uids;
  if(!Array.isArray(removed)||removed.length<1||removed.length>100||
     removed.some(id=>!UID.test(String(id))||id===keep)||
     new Set(removed).size!==removed.length)reject('Invalid Point merge UIDs');
  const scope=authorizedScope||await scopedWrite(trx,args.p_scope_id);
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
  // The target Scope grant is explicitly verified by scopedWrite / LOC access.
  await scopedWrite(trx,to);
  const fixedSource=publishedManagedScope(from);
  const sourceRegistry=fixedSource?.manage_role==='scope'?fixedSource:
    fixedSource?null:await trx.selectFrom('api.manage')
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
