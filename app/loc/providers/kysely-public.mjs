import {sql} from 'kysely';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {publicScopeBlockPage} from '../blocks/public-scope-pages.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {LOC_BLOCK_ANCHOR_FIELDS,locAnchorToBlock,isLocBlockPage} from '../blocks/loc-block-anchor.mjs';
const scopePattern=/^[a-z][a-z0-9]{0,14}$/;
function id(value){
  const s=String(value||'').trim().toLowerCase();
  if(!scopePattern.test(s))throw Object.assign(new Error('Invalid Scope'),{httpStatus:400});
  return s;
}
const ACTION_ARGS={
  read_app_bootstrap:['p_scope_id','p_page_name'],
  read_scope_page_copy:['p_scope_id'],
  block_list:['p_scope_id','p_page_name'],
  hero_block:['p_type'],
  search_scope_trace_place_names:['p_scope_id','p_term','p_limit']
};
// CURRENT public Blocks access: LOC Block Model maps onto loc_anchor; ordinary
// Scope Blocks retain their own _blocks. RPC-shaped action names describe the
// existing Kysely contract, not a requirement to restore old SQL functions.
// block_list reads the scoped public index in one batch; hero_block reads only its requested type.
// LOC Blocks use loc_anchor; other Scope home Blocks use their existing _blocks table.
// Two LOC presentation read contracts. Public endpoints never accept relation
// names, SQL, or a caller-selected database. Other Scope tables stay intact.
const BLOCK_COLUMNS=Object.freeze([
  'uid','page_name','block_eyebrow','block_title','block_subtitle',
  'block_text','block_order','block_entity','block_image'
]);
const LOC_LIST_TYPES=Object.freeze(['index','governance']);
const blockRelation=(table,engine,namespace)=>
  engine==='postgres'?'silver.'+table:portableRelation(table,engine,namespace);
async function readLocBlockAnchors(trx,types,{
  engine='postgres',namespace='silver',readLocAnchors=null
}={}){
  if(typeof readLocAnchors==='function')return readLocAnchors(types);
  return trx.selectFrom(blockRelation('loc_anchor',engine,namespace))
    .select(LOC_BLOCK_ANCHOR_FIELDS)
    .where('type','in',types).where('invisible','=',false)
    .orderBy('uid','asc').execute();
}
export async function block_list(trx,scopeId,options={}){
  const scope=id(scopeId);
  const page=publicScopeBlockPage(options.pageName);
  if(!page)throw Object.assign(new Error('Invalid public Scope Block page'),{httpStatus:400});
  if(scope==='loc'){
    if(page!=='index')throw Object.assign(new Error('Invalid LOC public Block page'),{httpStatus:400});
    const rows=await readLocBlockAnchors(trx,LOC_LIST_TYPES,options);
    return rows.map(locAnchorToBlock)
      .sort((a,b)=>a.page_name.localeCompare(b.page_name)||
        a.block_order-b.block_order);
  }
  if(typeof options.readScopeBlocks==='function'&&page==='index')
    return options.readScopeBlocks(scope);
  return trx.selectFrom(blockRelation(scope+'_blocks',options.engine||'postgres',
    options.namespace||'silver'))
    .select(BLOCK_COLUMNS).where('page_name','=',page)
    .orderBy('block_order','asc').execute();
}
export async function hero_block(trx,specificValue,options={}){
  const types=Array.isArray(specificValue)?specificValue:[specificValue];
  if(!types.length||types.length>2||new Set(types).size!==types.length||
    types.some(type=>!isLocBlockPage(type)||LOC_LIST_TYPES.includes(type)))
    throw Object.assign(new Error('Invalid specific Hero type'),{httpStatus:400});
  const rows=await readLocBlockAnchors(trx,types,options);
  return rows.map(locAnchorToBlock).sort((a,b)=>
    types.indexOf(a.page_name)-types.indexOf(b.page_name)||
    a.block_order-b.block_order);
}
// One exact type is the ordinary case; a known group+scope pair can be
// batched as two exact types in one query, not two redundant database trips.

export async function executeKyselyPublicAction(trx,body,{engine='postgres',namespace='silver',publishedScopeIds=null}={}){
  const portable=engine!=='postgres';
  const table=name=>portable?portableRelation(name,engine,namespace):'silver.'+name;
  const activeScopeIds=publishedScopeIds??SCOPE_ROUTE_INDEX.filter(row=>row.active!==false).map(row=>row.scope_id);
  const action=String(body?.name||'');
  if(action==='block_list'||action==='hero_block'){
    const args=body?.args||{};
    const allowed=ACTION_ARGS[action];
    if(Object.keys(args).some(key=>!allowed.includes(key)))
      throw Object.assign(new Error('Invalid Block arguments'),{httpStatus:400});
    if(!portable)await sql`reset role`.execute(trx);
    if(action==='block_list'){
      const scope=id(args.p_scope_id);
      if(!activeScopeIds.includes(scope))
        throw Object.assign(new Error('Unpublished Scope'),{httpStatus:403});
      const page=publicScopeBlockPage(args.p_page_name);
      if(!page||scope==='loc'&&page!=='index')
        throw Object.assign(new Error('Invalid public Block page'),{httpStatus:400});
      return {data:await block_list(trx,scope,{engine,namespace,pageName:page}),count:null};
    }
    return {data:await hero_block(trx,args.p_type,{engine,namespace}),count:null};
  }
  // Reject unsupported actions, arguments and Scope IDs before Kysely
  // introspects the external database. Malformed public requests cost no SQL.
  const name=String(body?.name||'');
  const keys=ACTION_ARGS[name];
  const args=body?.args||{};
  if(!keys||!args||typeof args!=='object'||Array.isArray(args)||
     Object.keys(args).some(k=>!keys.includes(k)))
    throw Object.assign(new Error('Invalid public action'),{httpStatus:400});
  const scope=id(args.p_scope_id);
  const metadata=await trx.introspection.getTables();
  const available=new Set(metadata.map(row=>String(row.schema||'')+'.'+row.name));
  const mysqlNames=new Set(metadata.map(row=>row.name));
  const has=name=>engine==='mysql'?mysqlNames.has(name):
    available.has((portable?namespace:'silver')+'.'+name)||
    portable&&available.has('.'+name);
  // The old public RPCs were SECURITY DEFINER. We return only their
  // pre-approved public result shape; callers cannot choose relations/SQL.
  if(!portable)await sql`reset role`.execute(trx);
  if(name==='read_scope_page_copy'){
    const allowed=activeScopeIds.includes(scope);
    const record=allowed&&has('loc')
      ?await trx.selectFrom(table('loc')).select(['title_tw','desc_tw'])
        .where('id','=',scope).executeTakeFirst():null;
    const trimmed=s=>String(s||'').trim()||null;
    return {data:record?[{Title_TW:trimmed(record.title_tw),
      Desc_TW:trimmed(record.desc_tw)}]:[],count:null};
  }
  if(name==='search_scope_trace_place_names'){
    const term=String(args.p_term||'').trim().slice(0,100);
    const limit=args.p_limit===undefined?8:Math.max(1,Math.min(8,Number(args.p_limit)||8));
    const registered=activeScopeIds.includes(scope);
    if(!term||scope==='loc'||!registered||!has(scope+'_anchor'))return {data:[],count:null};
    if(portable){
      // Bounded Kysely pages preserve alias search without vendor-specific JSON RPC.
      const found=[],needle=term.toLocaleLowerCase();
      // A bounded Scope Point scan removes the old UID keyset cursor. UID
      // remains an identifier but never controls visit or display order.
      const rows=await trx.selectFrom(table(scope+'_anchor'))
        .select(['uid','title','attr']).where('type','=','point')
        .where('invisible','=',false).limit(10001).execute();
      if(rows.length>10000)throw new Error('Point lookup exceeds bounded Scope scan');
      for(const row of rows){
          const attr=typeof row.attr==='string'?JSON.parse(row.attr||'{}'):row.attr||{};
          const aliases=Array.isArray(attr.location)?attr.location:
            typeof attr.location==='string'?[attr.location]:[];
          if([row.title,...aliases].some(v=>String(v||'').toLocaleLowerCase().includes(needle))){
            const lng=Number(attr.lng??attr.longitude),lat=Number(attr.lat??attr.latitude);
            found.push({uid:row.uid,title:row.title,
              address:Number.isFinite(lng)&&Number.isFinite(lat)?[lng,lat]:null});
          }
        }
      return {data:found.sort((a,b)=>String(a.title).localeCompare(String(b.title)))
        .slice(0,limit),count:null};
    }
    const anchor=sql.ref('silver.'+scope+'_anchor');
    const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
    const result=await sql`select a.uid::varchar as uid,a.title,
        case when coalesce(a.attr->>'lng',a.attr->>'longitude') is not null
            and coalesce(a.attr->>'lat',a.attr->>'latitude') is not null
          then array[coalesce(a.attr->>'lng',a.attr->>'longitude')::double precision,
            coalesce(a.attr->>'lat',a.attr->>'latitude')::double precision]::double precision[]
          else null::double precision[] end as address
      from ${anchor} as a where a.type='point' and a.invisible is false
        and (a.title ilike ${pattern} or exists(
          select 1 from jsonb_array_elements_text(case jsonb_typeof(a.attr->'location')
            when 'array' then a.attr->'location'
            when 'string' then jsonb_build_array(a.attr->>'location')
            else '[]'::jsonb end) alias(name)
          where alias.name ilike ${pattern}))
      order by a.title limit ${limit}`.execute(trx);
    return {data:result.rows,count:null};
  }
  let page=String(args.p_page_name||'index').trim().toLowerCase();
  if(!/^[a-z0-9_-]+$/.test(page))page='index';
  const members=SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&
    activeScopeIds.includes(row.scope_id))
    .map((row,sort_order)=>({id:row.scope_id,
      manage_role:row.scope_id==='loc'?'group':'scope',active:true,sort_order,
      domain:row.domain||null,directory:row.directory||null,
      parent_scope_id:row.scope_id==='loc'?null:'loc'}));
  const groupRows=has('loc')?await trx.selectFrom(table('loc'))
    .select(['id','display_name','title_tw','desc_tw','birthday']).execute():[];
  const groupMap=new Map(groupRows.map(row=>[row.id,row]));
  const enabled=members.filter(m=>m.active===true&&scopePattern.test(m.id));
  const relationAvailable=async name=>has(name.split('.')[1]);
  const registry=[];
  for(const m of enabled){
    // LOC Group rows are the authoritative name index. Only older portable
    // installs without an entry need a legacy per-Scope name lookup.
    const groupName=groupMap.get(m.id)?.display_name;
    const config=!groupName&&await relationAvailable('silver.'+m.id)
      ?await trx.selectFrom(table(m.id))
        .select(['id','display_name']).where('id','=',m.id).executeTakeFirst():null;
    registry.push({scope_id:m.id,display_name:groupName||config?.display_name||m.id,
      scope_kind:m.manage_role==='group'?'group':'scope',
      domain:m.domain,directory:m.directory,
      parent_scope_id:m.parent_scope_id,active:m.active,sort_order:m.sort_order});
  }
  const copy=enabled.filter(m=>['group','scope'].includes(m.manage_role))
    .map(m=>({scope_id:m.id,Title_TW:groupMap.get(m.id)?.title_tw||null,
      Desc_TW:groupMap.get(m.id)?.desc_tw||null}));
  let config=null,blocks=[];
  const active=enabled.some(m=>m.id===scope);
  if(active&&await relationAvailable('silver.'+scope)){
    const full=await trx.selectFrom(table(scope))
      .selectAll().where('id','=',scope).executeTakeFirst();
    if(full){const {id:ignore,...rest}=full;config=rest;}
    // LOC has exactly two presentation readers. The legacy bootstrap
    // assembles its blocks through these functions instead of custom SQL.
    if(scope==='loc'){
      blocks=['index','governance'].includes(page)
        ?(await block_list(trx,scope,{engine,namespace})).filter(row=>row.page_name===page)
        :await hero_block(trx,page,{engine,namespace});
    }else if(page==='index'){
      blocks=await block_list(trx,scope,{engine,namespace});
    }else if(await relationAvailable('silver.'+scope+'_blocks')){
      // Other Scope page storage is unchanged.
      blocks=await trx.selectFrom(table(scope+'_blocks'))
        .select(BLOCK_COLUMNS).where('page_name','=',page)
        .orderBy('block_order','asc').execute();
    }
  }
  const root=has('loc')?await trx.selectFrom(table('loc')).select('theme')
    .where('id','=','loc').executeTakeFirst():null;
  const rawTheme=typeof root?.theme==='string'?JSON.parse(root.theme):root?.theme;
  const themes=Array.isArray(rawTheme)?rawTheme:[];
  const themeList=themes.map(x=>({theme_id:x.theme_id,theme_name:x.theme_name,
    theme_order:x.theme_order})).sort((a,b)=>Number(a.theme_order)-Number(b.theme_order));
  const scopeBirthdays=Object.fromEntries(groupRows.filter(row=>row.birthday)
    .map(row=>[row.id,String(row.birthday).slice(0,10)]));
  return {data:{scope_id:scope,page_name:page,config,blocks,registry,page_copy:copy,
    scope_birthdays:scopeBirthdays,theme_list:themeList,themes},count:null};
}
