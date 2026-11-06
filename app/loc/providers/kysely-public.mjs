import {sql} from 'npm:kysely@0.29.8';
import {portableRelation} from './sql-engine-ports.mjs';
const scopePattern=/^[a-z][a-z0-9]{0,14}$/;
function id(value){
  const s=String(value||'').trim().toLowerCase();
  if(!scopePattern.test(s))throw Object.assign(new Error('Invalid Scope'),{httpStatus:400});
  return s;
}
const ACTION_ARGS={
  read_app_bootstrap:['p_scope_id','p_page_name'],
  read_scope_page_copy:['p_scope_id'],
  page_blocks:['p_scope_id','p_type'],
  hero_blocks:['p_scope_id','p_type'],
  search_scope_trace_place_names:['p_scope_id','p_term','p_limit']
};
export async function executeKyselyPublicAction(trx,body,{engine='postgres',namespace='silver'}={}){
  const portable=engine!=='postgres';
  const table=name=>portable?portableRelation(name,engine,namespace):
    name==='manage'?'api.manage':'silver.'+name;
  const action=String(body?.name||'');
  if(action==='page_blocks'||action==='hero_blocks'){
    const args=body?.args||{};
    if(Object.keys(args).some(key=>!['p_scope_id','p_type'].includes(key)))
      throw Object.assign(new Error('Invalid Block arguments'),{httpStatus:400});
    const scope=id(args.p_scope_id),kind=String(args.p_type||'').trim();
    if(!/^[a-z][a-z0-9_-]{0,40}$/.test(kind)||
       action==='page_blocks'&&kind!=='index'||
       action==='hero_blocks'&&!['culture','statics','trace','search'].includes(kind))
      throw Object.assign(new Error('Invalid public Block type'),{httpStatus:400});
    const tableName=action==='hero_blocks'?'loc_blocks':
      scope==='loc'?'loc_blocks':scope+'_blocks';
    const names=action==='hero_blocks'?['group_'+kind,'scope_'+kind]:[kind];
    // No registry query, table-introspection query, RLS prerequisite, or
    // SQL ORDER BY: one bounded presentation query, then client-side sorting.
    if(!portable)await sql`reset role`.execute(trx);
    const rows=await trx.selectFrom(table(tableName))
      .select(['uid','page_name','block_eyebrow','block_title','block_subtitle',
        'block_text','block_order','block_entity','block_image'])
      .where('page_name','in',names).execute();
    return {data:rows,count:null};
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
  const scopedGalaxies=[...new Set(metadata
    .filter(row=>row.name.endsWith('_galaxy')&&
      (engine==='mysql'||!portable||!row.schema||row.schema===namespace))
    .map(row=>row.name.slice(0,-'_galaxy'.length)))]
    .filter(value=>scopePattern.test(value)&&has(value+'_anchor'));
  // The old public RPCs were SECURITY DEFINER. We return only their
  // pre-approved public result shape; callers cannot choose relations/SQL.
  if(!portable)await sql`reset role`.execute(trx);
  if(name==='read_scope_page_copy'){
    if(!has('manage'))return {data:[],count:null};
    const allowed=await trx.selectFrom(table('manage'))
      .select('id').where('id','=',scope)
      .where('manage_role','=','scope').where('active','=',true).executeTakeFirst();
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
    const registered=has('manage')
      ?await trx.selectFrom(table('manage')).select('id')
        .where('id','=',scope).where('manage_role','=','scope')
        .where('active','=',true).executeTakeFirst()
      :{id:scope};
    if(!term||!registered||!has(scope+'_anchor'))return {data:[],count:null};
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
  // An external LOC installation needs only a Galaxy and Anchor per Scope.
  // Do not require a provider-specific registry or stored procedures.
  if(portable&&!has('manage')){
    const registry=scopedGalaxies.map(id=>({
      scope_id:id,display_name:id,scope_kind:'scope',domain:null,directory:null,
      parent_scope_id:'loc',active:true,sort_order:0
    }));
    return {data:{scope_id:scope,page_name:page,config:null,blocks:[],
      registry,page_copy:[],theme_list:[],themes:[]},count:null};
  }
  const members=await trx.selectFrom(table('manage'))
    .select(['id','manage_role','active','sort_order',
      'domain','directory','parent_scope_id'])
    .orderBy('sort_order','asc').orderBy('id','asc').execute();
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
    if(await relationAvailable('silver.'+scope+'_blocks')){
      const result=await trx.selectFrom(table(scope+'_blocks'))
        .select(['uid','page_name','block_eyebrow','block_title','block_subtitle',
          'block_text','block_order','block_entity','block_image'])
        .where('page_name','=',page).orderBy('block_order','asc').execute();
      blocks=result;
    }
  }
  const root=await trx.selectFrom(table('loc')).select('theme')
    .where('id','=','loc').executeTakeFirst();
  const rawTheme=typeof root?.theme==='string'?JSON.parse(root.theme):root?.theme;
  const themes=Array.isArray(rawTheme)?rawTheme:[];
  const themeList=themes.map(x=>({theme_id:x.theme_id,theme_name:x.theme_name,
    theme_order:x.theme_order})).sort((a,b)=>Number(a.theme_order)-Number(b.theme_order));
  const scopeBirthdays=Object.fromEntries(groupRows.filter(row=>row.birthday)
    .map(row=>[row.id,String(row.birthday).slice(0,10)]));
  return {data:{scope_id:scope,page_name:page,config,blocks,registry,page_copy:copy,
    scope_birthdays:scopeBirthdays,theme_list:themeList,themes},count:null};
}
