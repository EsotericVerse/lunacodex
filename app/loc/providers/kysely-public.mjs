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
  search_scope_trace_place_names:['p_scope_id','p_term','p_limit']
};
export async function executeKyselyPublicAction(trx,body,{engine='postgres',namespace='silver'}={}){
  const portable=engine!=='postgres';
  const table=name=>portable?portableRelation(name,engine,namespace):'silver.'+name;
  const name=String(body?.name||'');
  const keys=ACTION_ARGS[name];
  const args=body?.args||{};
  if(!keys||!args||typeof args!=='object'||Array.isArray(args)||
     Object.keys(args).some(k=>!keys.includes(k)))
    throw Object.assign(new Error('Invalid public action'),{httpStatus:400});
  const scope=id(args.p_scope_id);
  // The old public RPCs were SECURITY DEFINER. We return only their
  // pre-approved public result shape; callers cannot choose relations/SQL.
  if(!portable)await sql`reset role`.execute(trx);
  if(name==='read_scope_page_copy'){
    const record=await trx.selectFrom(table('manage'))
      .select(['title_tw','desc_tw']).where('id','=',scope)
      .where('manage_role','=','scope').where('active','=',true).executeTakeFirst();
    const trimmed=s=>String(s||'').trim()||null;
    return {data:record?[{Title_TW:trimmed(record.title_tw),
      Desc_TW:trimmed(record.desc_tw)}]:[],count:null};
  }
  if(name==='search_scope_trace_place_names'){
    const term=String(args.p_term||'').trim().slice(0,100);
    const limit=args.p_limit===undefined?8:Math.max(1,Math.min(8,Number(args.p_limit)||8));
    const registered=await trx.selectFrom(table('manage')).select('id')
      .where('id','=',scope).where('manage_role','=','scope')
      .where('active','=',true).executeTakeFirst();
    if(!term||!registered)return {data:[],count:null};
    if(portable){
      // Bounded Kysely pages preserve alias search without vendor-specific JSON RPC.
      const found=[],needle=term.toLocaleLowerCase(),batch=500;
      let after='';
      while(found.length<limit){
        let q=trx.selectFrom(table(scope+'_anchor'))
          .select(['uid','title','attr']).where('type','=','point')
          .where('invisible','=',false).orderBy('uid','asc').limit(batch);
        if(after)q=q.where('uid','>',after);
        const rows=await q.execute();
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
        if(rows.length<batch)break;
        after=String(rows[rows.length-1].uid);
      }
      return {data:found.sort((a,b)=>String(a.title).localeCompare(String(b.title)))
        .slice(0,limit),count:null};
    }
    const anchor=sql.ref('silver.'+scope+'_anchor');
    const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
    const result=await sql`select a.uid::varchar as uid,a.title,
        case when a.attr ? 'longitude' and a.attr ? 'latitude'
          then array[(a.attr->>'longitude')::double precision,
            (a.attr->>'latitude')::double precision]::double precision[]
          else null::double precision[] end as address
      from ${anchor} as a where a.type='point' and a.invisible is false
        and (a.title ilike ${pattern} or exists(
          select 1 from jsonb_array_elements_text(case jsonb_typeof(a.attr->'location')
            when 'array' then a.attr->'location'
            when 'string' then jsonb_build_array(a.attr->>'location')
            else '[]'::jsonb end) alias(name)
          where alias.name ilike ${pattern}))
      order by a.title,a.uid limit ${limit}`.execute(trx);
    return {data:result.rows,count:null};
  }
  let page=String(args.p_page_name||'index').trim().toLowerCase();
  if(!/^[a-z0-9_-]+$/.test(page))page='index';
  const members=await trx.selectFrom(table('manage'))
    .select(['id','manage_role','active','sort_order','display_name',
      'title_tw','desc_tw','domain','directory','parent_scope_id'])
    .orderBy('sort_order','asc').orderBy('id','asc').execute();
  const enabled=members.filter(m=>m.active===true&&scopePattern.test(m.id));
  const metadata=await trx.introspection.getTables();
  const available=new Set(metadata.map(row=>String(row.schema||'')+'.'+row.name));
  const relationAvailable=async name=>{
    const [schema,tableName]=name.split('.');
    return available.has(schema+'.'+tableName)||
      portable&&available.has('.'+tableName);
  };
  const registry=[];
  for(const m of enabled){
    const config=await relationAvailable('silver.'+m.id)
      ?await trx.selectFrom(table(m.id))
        .select(['id','display_name']).where('id','=',m.id).executeTakeFirst():null;
    registry.push({scope_id:m.id,display_name:config?.display_name||m.id,
      scope_kind:m.manage_role==='group'?'group':'scope',
      domain:m.domain,directory:m.directory,
      parent_scope_id:m.parent_scope_id,active:m.active,sort_order:m.sort_order});
  }
  const copy=enabled.filter(m=>['admin','scope'].includes(m.manage_role))
    .map(m=>({scope_id:m.id,Title_TW:m.title_tw,Desc_TW:m.desc_tw}));
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
  return {data:{scope_id:scope,page_name:page,config,blocks,registry,page_copy:copy,
    theme_list:themeList,themes},count:null};
}
