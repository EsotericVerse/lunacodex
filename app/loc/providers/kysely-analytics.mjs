import {canManageLoc} from './loc-authorization.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {sql} from 'npm:kysely@0.29.8';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const MODES=new Set(['loc','daily','overview','earliest','totals','search_summary',
  'trace_places','keyword_summary','keyword_catalog','shared_classes','trace_daily','trace_keywords',
  'culture_density','culture_anchors','culture_list']);
function reject(message,status=400){
  const error=new Error(message);error.httpStatus=status;throw error;
}
function dateOnly(value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))reject('Invalid statistics date');
  return value;
}
function scopeId(value){const id=String(value||'').trim().toLowerCase();
  if(!SCOPE.test(id))reject('Invalid statistics Scope');return id;
}
async function registry(trx,scope){
  const row=await trx.selectFrom('api.manage as m')
    .innerJoin('silver.loc as l','l.id','m.id')
    .select(['m.id as id','m.manage_role as manage_role','m.active as active',
      'l.display_name as display_name','m.anchor_table as anchor_table',
      'm.galaxy_table as galaxy_table','m.sort_order as sort_order'])
    .where('m.id','=',scope).executeTakeFirst();
  if(!row||row.manage_role!=='scope'||row.active!==true)reject('Unknown statistics Scope');
  return row;
}
function safeName(value,fallback){const name=String(value||fallback);
  if(!/^[a-z][a-z0-9_]*$/.test(name))reject('Invalid registered SQL relation');return name;
}
function relation(scope,suffix){return sql.ref('silver.'+scope+'_'+suffix);}
async function owns(trx,scope,role){
  return role==='authenticated'&&await canManageLoc(trx,'scope',scope);
}
async function dailyStats(trx,scope,start,end,includeUndated=false){
  const galaxy=relation(scope,'galaxy');
  const rows=await sql`with s as (
    select coalesce(date::text,'') as d,btrim(coalesce(site,'')) as c
    from ${galaxy}
    where statics is true and content<>''
      and (${includeUndated} or date is not null)
      and (${start}::date is null or date>=${start}::date)
      and (${end}::date is null or date<=${end}::date)
  )
  -- One aggregation pass returns both source lanes and per-day totals.
  -- GROUPING(s.c) distinguishes the total row from an empty source name.
  select s.d as day,
    case when grouping(s.c)=1 then 'total'::text else 'source'::text end as kind,
    case when grouping(s.c)=1 then '文字作品'::text else s.c end as category,
    count(*)::integer as item_count
  from s
  group by grouping sets ((s.d,s.c),(s.d))
  order by 1,2,3`.execute(trx);
  return rows.rows;
}
async function earliest(trx,scope){
  const galaxy=relation(scope,'galaxy');
  const result=await sql`select min(date) as day from ${galaxy}
    where statics is true and content<>''`.execute(trx);
  return result.rows[0]?.day??null;
}
async function sourceTotals(trx,scope,start,end){
  const galaxy=relation(scope,'galaxy');
  const response=await sql`select 'source'::text as kind,
      btrim(coalesce(site,'')) as category,count(*)::integer as item_count
    from ${galaxy} where statics is true and content<>''
      and (${start}::date is null or date>=${start}::date)
      and (${end}::date is null or date<=${end}::date)
    group by 1,2 order by 1,2`.execute(trx);
  return response.rows;
}
async function scopeOverview(trx,scope,start,end){
  const [rows,first,loc]=await Promise.all([
    dailyStats(trx,scope,start,end),
    earliest(trx,scope),
    trx.selectFrom('silver.loc').select('DefaultArticleClass')
      .where('id','=','loc').executeTakeFirst()
  ]);
  const list=Array.isArray(loc?.DefaultArticleClass)?loc.DefaultArticleClass:[];
  const categories=list.map(name=>({category_code:String(name).trim().toLowerCase(),
    display_name:String(name).trim(),enabled:true}));
  const aliases=list.map(name=>({source_key:String(name).trim().toLowerCase(),
    category_code:String(name).trim().toLowerCase()}));
  return {earliest:first,rows,categories,aliases};
}
async function searchSummary(trx,options){
  const scopes=options.scopeIds;
  if(!Array.isArray(scopes)||scopes.length>100||
    scopes.some(x=>typeof x!=='string'||!SCOPE.test(x)))
    reject('Invalid Scope Search summary request');
  const requested=[...new Set(scopes)].sort();
  if(!requested.length)return {rows:[]};
  // One Kysely membership read, rather than one SQL round trip per Scope.
  // Keep per-Scope configuration queries bounded and sequential.
  const members=await trx.selectFrom('api.manage')
    .select('id').where('id','in',requested)
    .where('manage_role','=','scope').where('active','=',true).execute();
  const allowed=new Set(members.map(row=>row.id));
  const result=[];
  for(const scope of requested){
    if(!allowed.has(scope))continue;
    const config=await trx.selectFrom('silver.'+scope)
      .select('status').where('id','=',scope).executeTakeFirst();
    const item=config?.status?.search;
    if(item&&typeof item==='object'&&!Array.isArray(item)){
      result.push({scope_id:scope,article_count:item.article_count??null,
        word_count:item.word_count??null,first_date:item.first_date??null,
        last_date:item.last_date??null,refreshed_at:item.refreshed_at??null});
    }
  }
  return {rows:result};
}
async function tracePlaces(trx,scope,start,end){
  const galaxy=relation(scope,'galaxy');
  const response=await sql`select date::text as day,btrim(location) as category,
    count(*)::bigint as item_count from ${galaxy}
    where trace is true and content<>'' and date is not null
      and location is not null and btrim(location)<>''
      and (${start}::date is null or date>=${start}::date)
      and (${end}::date is null or date<=${end}::date)
    group by 1,2 order by 1,2`.execute(trx);
  return response.rows.map(row=>({...row,item_count:Number(row.item_count||0)}));
}
function uidList(node){
  return Array.isArray(node?.attr?.uid)?node.attr.uid.filter(id=>UID.test(id)):[];
}
function published(cfg,uid){
  return Boolean(cfg?.keyword_meta?.class_shares?.[uid]===true);
}
async function keywordClassInfo(trx,scope,anchor,requested,role){
  const config=await trx.selectFrom('silver.'+scope)
    .select(['current_keyword_class_uid','keyword_meta'])
    .where('id','=',scope).executeTakeFirst();
  const uid=String(requested||config?.current_keyword_class_uid||'');
  if(!UID.test(uid))return null;
  const allowed=await owns(trx,scope,role)||published(config,uid);
  const meta=config?.keyword_meta??{};
  const done=meta.by_class?.[uid]?.completedAt;
  return {uid,allowed,ready:Boolean(done),config};
}
async function sharedClasses(trx,scope,anchor,role){
  const owner=await owns(trx,scope,role);
  const cfg=await trx.selectFrom('silver.'+scope).select('keyword_meta')
    .where('id','=',scope).executeTakeFirst();
  // Kysely projects every public alias in the Class SELECT itself.
  // Previously each shared Class caused another PostgreSQL round trip.
  let query=trx.selectFrom(anchor).select(['uid','title'])
    .where('type','=','class').orderBy('title','asc');
  if(!owner){
    const sharedIds=Object.entries(cfg?.keyword_meta?.class_shares||{})
      .filter(([,flag])=>flag===true).map(([uid])=>uid);
    if(!sharedIds.length)return [];
    query=query.where('uid','in',sharedIds)
      .select(sql`encode(sha256(convert_to(
        ${scope}::text||':'||${sql.ref('uid')}::text,'UTF8')),'hex')`.as('share_hash'));
  }
  const classes=await query.execute();
  const result=[];
  for(const item of classes){
    if(!owner&&!published(cfg,item.uid))continue;
    result.push({scopeId:scope,classUid:item.uid,name:item.title,
      category:owner?item.uid:String(item.share_hash||'')});
  }
  return result;
}
async function keywordCatalog(trx,scope,anchor,requested,role){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed)return {};
  const root=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
    .where('uid','=',info.uid).where('type','=','class').executeTakeFirst();
  if(!root)return {class_uid:info.uid,rows:[]};
  // Current Anchor uses class.attr.groups / group.attr.items / item.attr.total.
  // Keep legacy attr.uid as read-only compatibility, never materialize article UID lists.
  const children=(node,key)=>{
    const values=node?.attr?.[key]??node?.attr?.uid;
    return Array.isArray(values)?values.filter(value=>UID.test(String(value))):[];
  };
  const groupIds=children(root,'groups');
  const groups=groupIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','group').where('uid','in',groupIds).execute():[];
  const byGroup=new Map(groups.map(g=>[g.uid,g]));
  const ordered=groupIds.map(uid=>byGroup.get(uid)).filter(Boolean);
  const itemIds=[...new Set(ordered.flatMap(g=>children(g,'items')))];
  const items=itemIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','item').where('uid','in',itemIds).execute():[];
  const byItem=new Map(items.map(i=>[i.uid,i]));
  const total=node=>Math.max(0,Number(node?.attr?.total)||0);
  const groupWeight=group=>{
    const own=total(group);
    if(own>0)return own;
    return children(group,'items').reduce((sum,id)=>sum+total(byItem.get(id)),0);
  };
  const model=node=>({uid:node.uid,type:node.type,name:node.title,
    desc:node.type==='item'?'':node.description,
    lists:node.type==='class'?groupIds:node.type==='group'?children(node,'items'):[],
    total:node.type==='group'?groupWeight(node):node.type==='item'?total(node):0,
    uid_lists:[]});
  return {class_uid:info.uid,rows:[model(root),...ordered.map(model),
    ...ordered.flatMap(group=>children(group,'items').map(id=>byItem.get(id))
      .filter(Boolean).map(model))]};
}
async function traceDaily(trx,scope,places,start,end,source){
  const galaxy=relation(scope,'galaxy');
  const result=await sql`select (g.createtime at time zone 'Asia/Taipei')::date as day,
      g.place_id::text as category,count(*)::bigint as item_count
    from ${galaxy} g where g.place_id=any(${places}::text[])
      and g.trace is true and g.createtime is not null
      and (${start}::date is null or g.createtime>=
        (${start}::date::timestamp at time zone 'Asia/Taipei'))
      and (${end}::date is null or g.createtime<
        ((${end}::date+1)::timestamp at time zone 'Asia/Taipei'))
      and (${source}::text is null or g.site ilike ${source})
    group by 1,2 order by 1,2`.execute(trx);
  return result.rows.map(row=>({...row,item_count:Number(row.item_count||0)}));
}
async function traceKeywordGroups(trx,scope,anchor,places,start,end,source,requested,role){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed||!info.ready)return [];
  const galaxy=relation(scope,'galaxy');
  const a=sql.ref(anchor);
  const result=await sql`with cl as(
      select uid,attr from ${a} where type='class' and uid=${info.uid}
    ),groups as(
      select g.uid,g.title,g.attr from cl c
      cross join lateral jsonb_array_elements_text(coalesce(c.attr->'uid','[]'::jsonb)) child(uid)
      join ${a} g on g.uid=child.uid and g.type='group'
    ),articles as materialized(
      select g.uid::text as uid from ${galaxy} g
      where g.place_id=any(${places}::text[]) and g.keyword is true
        and (${start}::date is null or g.date>=${start}::date)
        and (${end}::date is null or g.date<=${end}::date)
        and (${source}::text is null or g.site=${source})
    )
    select k.uid::text as group_uid,k.title as group_name,
      count(distinct article.uid)::bigint as document_count from groups k
      left join articles article on (coalesce(k.attr->'uidlists',
        k.attr->'articles','[]'::jsonb)) ? article.uid
      group by k.uid,k.title order by k.title`.execute(trx);
  return result.rows.map(row=>({...row,document_count:Number(row.document_count||0)}));
}
async function keywordSummary(trx,scope,anchor,start,end,source,requested,role){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed||!info.ready)return [];
  const galaxy=relation(scope,'galaxy'),a=sql.ref(anchor);
  const result=await sql`with clazz as(
      select uid,attr from ${a} where type='class' and uid=${info.uid}
    ),groups as materialized (
      select g.uid::text uid,g.title,g.attr
      from clazz c
      cross join lateral jsonb_array_elements_text(coalesce(c.attr->'uid','[]'::jsonb)) child(uid)
      join ${a} g on g.uid=child.uid and g.type='group'
    ), items as materialized(
      select i.uid::text as uid,g.uid as group_uid,i.attr
      from groups g cross join lateral jsonb_array_elements_text(
        coalesce(g.attr->'uid','[]'::jsonb)) child(uid)
      join ${a} i on i.uid=child.uid and i.type='item'
    ),group_hits as materialized(
      select g.uid as group_uid,article.uid::text as article_uid,article.date::text as d
      from groups g cross join lateral jsonb_array_elements_text(
        coalesce(g.attr->'uidlists',g.attr->'articles','[]'::jsonb)) x(uid)
      join ${galaxy} article on article.uid::text=x.uid
      where article.keyword is true
        and (${start}::date is null or article.date>=${start}::date)
        and (${end}::date is null or article.date<=${end}::date)
        and (${source}::text is null or article.site=${source})
    ),item_hits as materialized(
      select i.uid as item_uid,i.group_uid,article.uid::text as article_uid,
        article.date::text as d,
        case when jsonb_typeof(x.entry)='string' then 1
          else (x.entry->>'times')::bigint end as times,
        (i.attr->>'total')::bigint as total
      from items i cross join lateral jsonb_array_elements(
        coalesce(i.attr->'uidlists',i.attr->'hits','[]'::jsonb)) x(entry)
      join ${galaxy} article on article.uid::text=case
        when jsonb_typeof(x.entry)='string' then x.entry#>>'{}'
        else x.entry->>'uid' end
      where article.keyword is true
        and (${start}::date is null or article.date>=${start}::date)
        and (${end}::date is null or article.date<=${end}::date)
        and (${source}::text is null or article.site=${source})
    )
    select 'eligible'::text kind,null::text item_key,null::text group_uid,
      ''::text day,count(distinct article_uid)::bigint hit_count,
      count(distinct article_uid)::bigint document_count from group_hits
    union all
    select 'class_day',null,group_uid,d,count(distinct article_uid),
      count(distinct article_uid) from group_hits group by group_uid,d
    union all
    select 'item',item_uid,group_uid,'',
      (case when ${start}::date is null and ${end}::date is null and ${source}::text is null
        then coalesce(max(total),sum(times)) else sum(times) end)::bigint,
      count(distinct article_uid) from item_hits where times>0 group by item_uid,group_uid
    union all
    select 'item_day',item_uid,group_uid,d,sum(times)::bigint,
      count(distinct article_uid) from item_hits where times>0 group by item_uid,group_uid,d
    union all
    select 'keyword_all_day',null,null,d,count(distinct article_uid),
      count(distinct article_uid) from item_hits where times>0 group by d
    union all
    select 'group_items_day',null,group_uid,d,count(distinct article_uid),
      count(distinct article_uid) from item_hits where times>0 group by group_uid,d`.execute(trx);
  return result.rows.map(row=>({...row,hit_count:Number(row.hit_count||0),
    document_count:Number(row.document_count||0)}));
}

// Culture reads are ordinary portable Kysely operations: no stored RPC,
// no management-permission lookup, and no Galaxy UID in density results.
async function simpleCultureData(db,scope,mode,start,end,{engine='postgres',namespace='silver'}={}){
  const table=name=>engine==='postgres'?'silver.'+name:portableRelation(name,engine,namespace);
  if(mode==='culture_anchors'){
    const rows=await db.selectFrom(table(scope+'_anchor'))
      .select(['uid','type','title','attr'])
      .where('type','in',['date','period','era'])
      .where('invisible','=',false).execute();
    return rows.map(row=>({...row,attr:typeof row.attr==='string'
      ?JSON.parse(row.attr||'{}'):row.attr||{}}));
  }
  if(!start||!end)reject('Culture density requires a bounded date range');
  // Time River groups by the published Galaxy.date, not by upload time.
  // Apply the same date window to WHERE so an existing Galaxy.date index can
  // prune irrelevant articles before grouping; no full text or Anchor JOIN.
  const rows=await db.selectFrom(table(scope+'_galaxy'))
    .select(['date','site'])
    .select(eb=>eb.fn.countAll().as('item_count'))
    .where('culture','=',true)
    .where('date','>=',start)
    .where('date','<=',end)
    .where('date','is not',null)
    .groupBy(['date','site']).orderBy('date','asc').execute();
  return rows.map(row=>({day:portableDay(row.date),site:String(row.site||''),
    item_count:Number(row.item_count||0)}));
}


// One exact bounded Culture article page. This is never called by the rivers
// or category expansion, and does not depend on the Search visibility flag.
async function cultureListPage(db,scope,start,end,options,{engine='postgres',namespace='silver'}={}){
  if(!start||!end||start>end)reject('Invalid Culture list dates');
  const site=String(options?.site||'').trim();
  const offset=Number(options?.offset||0);
  if(!site||site.length>120||!Number.isSafeInteger(offset)||offset<0||offset>100000)
    reject('Invalid Culture list selection');
  const table=engine==='postgres'?'silver.'+scope+'_galaxy':
    portableRelation(scope+'_galaxy',engine,namespace);
  const raw=await db.selectFrom(table).select(['uid','date','title','list'])
    .where('date','>=',start).where('date','<=',end)
    .where('site','=',site).where('culture','=',true)
    .orderBy('createtime','desc').limit(100).offset(offset).execute();
  const rows=raw.map(row=>row.list===false
    ?{hidden:true,title:'本文已隱藏',list:false}
    :{uid:String(row.uid),date:portableDay(row.date),
      title:String(row.title||''),list:true,hidden:false});
  return {rows,hasMore:raw.length===100,
    nextCursor:raw.length===100?{offset:offset+raw.length}:null};
}

export async function executeKyselyAnalytics(trx,body,{role='anon'}={}){
  const args=body?.args??body;
  const mode=String(args.p_view||'').trim().toLowerCase();
  const scope=scopeId(args.p_scope_id);
  const start=dateOnly(args.p_start),end=dateOnly(args.p_end);
  const options=args.p_options??{};
  if(!MODES.has(mode)||!options||typeof options!=='object'||Array.isArray(options)||
     start&&end&&start>end)reject('Invalid statistics parameters');
  if(mode==='culture_density'||mode==='culture_anchors'||mode==='culture_list'){
    // Culture list is only a bounded UID/date/title/list projection; hidden
    // rows are redacted before the browser receives the numeric/list payload.
    await sql`reset role`.execute(trx);
    return {data:mode==='culture_list'
      ?await cultureListPage(trx,scope,start,end,options)
      :await simpleCultureData(trx,scope,mode,start,end),count:null};
  }
  // Legacy summaries were SECURITY DEFINER aggregates. Keep the same public
  // totals without exposing private article text or private keyword metadata.
  await sql`reset role`.execute(trx);
  if(mode==='search_summary'){
    if(scope!=='loc'||start||end)reject('Invalid Search summary request');
    return {data:await searchSummary(trx,options),count:null};
  }
  if(mode==='loc'){
    if(scope!=='loc')reject('Invalid LOC statistics Scope');
    const groups=await trx.selectFrom('api.manage as m')
      .innerJoin('silver.loc as l','l.id','m.id')
      .select(['m.id as id','l.display_name as display_name',
        'm.galaxy_table as galaxy_table','m.anchor_table as anchor_table'])
      .where('m.manage_role','=','scope').where('m.active','=',true)
      .orderBy('m.sort_order','asc').orderBy('m.id','asc').execute();
    const scopes=[],rows=[];let first=null;
    for(const group of groups){
      if(!SCOPE.test(group.id))continue;
      const suffix=safeName(group.anchor_table,'anchor');
      const galaxy=safeName(group.galaxy_table,'galaxy');
      if(galaxy!=='galaxy')continue;
      const relations=await sql`select to_regclass(${'silver.'+group.id+'_'+galaxy}) is not null as galaxy_exists,
        to_regclass(${'silver.'+group.id+'_'+suffix}) is not null as anchor_exists`.execute(trx);
      if(!relations.rows[0]?.galaxy_exists||!relations.rows[0]?.anchor_exists)continue;
      scopes.push({scope_id:group.id,display_name:group.display_name});
      const day=await dailyStats(trx,group.id,start,end);
      rows.push(...day.filter(r=>r.kind==='total').map(r=>({scope_id:group.id,
        day:r.day,item_count:r.item_count})));
      const early=await earliest(trx,group.id);
      if(early&&(!first||String(early)<String(first)))first=early;
    }
    return {data:{earliest:first,scopes,rows},count:null};
  }
  const reg=await registry(trx,scope);
  const galaxy=safeName(reg.galaxy_table,'galaxy'),anchorSuffix=safeName(reg.anchor_table,'anchor');
  if(galaxy!=='galaxy')reject('Unsupported configured Galaxy relation');
  let data;
  if(mode==='daily')data=await dailyStats(trx,scope,start,end,options.includeUndated===true);
  else if(mode==='earliest')data=await earliest(trx,scope);
  else if(mode==='totals')data=await sourceTotals(trx,scope,start,end);
  else if(mode==='overview')data=await scopeOverview(trx,scope,start,end);
  else if(mode==='trace_places')data=await tracePlaces(trx,scope,start,end);
  else if(mode==='shared_classes')data=await sharedClasses(trx,scope,
    'silver.'+scope+'_'+anchorSuffix,role);
  else if(mode==='keyword_catalog')data=await keywordCatalog(trx,scope,
    'silver.'+scope+'_'+anchorSuffix,options.classUid,role);
  else if(mode==='keyword_summary')data=await keywordSummary(trx,scope,
    'silver.'+scope+'_'+anchorSuffix,start,end,options.source||null,options.classUid,role);
  else{
    const ids=options.placeIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>80||
       ids.some(uid=>!UID.test(String(uid||''))))reject('Invalid Trace Point UID list');
    data=mode==='trace_daily'
      ?await traceDaily(trx,scope,ids,start,end,options.source||null)
      :await traceKeywordGroups(trx,scope,'silver.'+scope+'_'+anchorSuffix,
        ids,start,end,options.source||null,options.classUid,role);
  }
  return {data,count:null};
}

function portableDay(value){
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value).slice(0,10);
}
function portableStatBase(db,table,start,end,flag='statics',includeUndated=false){
  let query=db.selectFrom(table).where(flag,'=',true).where('content','!=','');
  if(!includeUndated)query=query.where('date','is not',null);
  if(start)query=query.where('date','>=',start);
  if(end)query=query.where('date','<=',end);
  return query;
}
// Common LOC statistics, implemented with dialect-native Kysely builders.
export async function executePortableKyselyAnalytics(db,body,{engine,namespace='',role='anon'}={}){
  const args=body?.args??body;
  const scope=scopeId(args.p_scope_id),mode=String(args.p_view||'').trim().toLowerCase();
  const start=dateOnly(args.p_start),end=dateOnly(args.p_end);
  const options=args.p_options??{};
  if(start&&end&&start>end||!options||typeof options!=='object'||Array.isArray(options))
    reject('Invalid statistics range');
  if(!MODES.has(mode))reject('Unknown LOC statistics view');
  if(mode==='culture_density'||mode==='culture_anchors'||mode==='culture_list')
    return {data:mode==='culture_list'
      ?await cultureListPage(db,scope,start,end,options,{engine,namespace})
      :await simpleCultureData(db,scope,mode,start,end,{engine,namespace}),count:null};
  if(mode==='search_summary'){
    if(scope!=='loc'||start||end)reject('Invalid Search summary request');
    const ids=options.scopeIds;
    if(!Array.isArray(ids)||ids.length>100||
      ids.some(id=>typeof id!=='string'||!SCOPE.test(id)))
      reject('Invalid Search summary Scope list');
    const tables=await db.introspection.getTables();
    const present=new Set(tables
      .filter(t=>engine==='mysql'||!t.schema||t.schema===namespace)
      .map(t=>t.name));
    const rows=[];
    for(const id of [...new Set(ids)].sort()){
      if(!present.has(id+'_galaxy'))continue;
      const relation=portableRelation(id+'_galaxy',engine,namespace);
      const count=await db.selectFrom(relation).select(eb=>[
        eb.fn.countAll().as('article_count'),
        eb.fn.sum(eb.fn(engine==='mssql'?'len':'char_length',['content']))
          .as('word_count'),
        eb.fn.min('date').as('first_date'),
        eb.fn.max('date').as('last_date')
      ]).executeTakeFirst();
      rows.push({scope_id:id,article_count:Number(count?.article_count||0),
        word_count:Number(count?.word_count||0),
        first_date:portableDay(count?.first_date)||null,
        last_date:portableDay(count?.last_date)||null,
        refreshed_at:null});
    }
    return {data:{rows},count:null};
  }
  if(mode==='loc'&&scope==='loc'){
    // A self-hosted LOC database only needs Galaxy + Anchor per Scope.
    // Kysely introspection replaces the old LOC registry RPC.
    const tables=await db.introspection.getTables();
    const present=new Set(tables
      .filter(t=>engine==='mysql'||!t.schema||t.schema===namespace)
      .map(t=>t.name));
    const ids=[...present].filter(name=>name.endsWith('_galaxy'))
      .map(name=>name.slice(0,-'_galaxy'.length))
      .filter(id=>SCOPE.test(id)&&present.has(id+'_anchor')).sort();
    const scopes=[],rows=[];let earliest=null;
    for(const id of ids){
      const relation=portableRelation(id+'_galaxy',engine,namespace);
      let q=portableStatBase(db,relation,start,end,'statics');
      q=q.select('date').select(eb=>eb.fn.countAll().as('n'))
        .groupBy('date').orderBy('date','asc');
      const counts=await q.execute();
      // The requested window limits displayed counts, not the Scope's
      // absolute earliest qualifying date (same contract as PostgreSQL).
      const oldest=await db.selectFrom(relation)
        .select(eb=>eb.fn.min('date').as('day'))
        .where('statics','=',true).where('content','!=','')
        .executeTakeFirst();
      const firstDay=portableDay(oldest?.day);
      if(firstDay&&(!earliest||firstDay<earliest))earliest=firstDay;
      scopes.push({scope_id:id,display_name:id});
      for(const row of counts){
        const day=portableDay(row.date);
        rows.push({scope_id:id,day,item_count:Number(row.n||0)});

      }
    }
    return {data:{earliest,scopes,rows},count:null};
  }
  if(mode==='shared_classes'||mode==='keyword_catalog'){
    // The external SQL installation has Galaxy and Anchor, not the
    // historical scope configuration/RPC tables. Private classifications
    // must remain private until the verified owner authorizes them.
    const owner=role==='authenticated'&&await canManageLoc(db,'scope',scope);
    if(!owner)return {data:mode==='shared_classes'?[]:{},count:null};
    const table=portableRelation(scope+'_anchor',engine,namespace);
    const parse=row=>({...row,attr:typeof row.attr==='string'
      ?JSON.parse(row.attr):row.attr||{}});
    const classes=(await db.selectFrom(table)
      .select(['uid','type','title','description','attr'])
      .where('type','=','class').orderBy('title','asc').execute()).map(parse);
    if(mode==='shared_classes')return {data:classes.map(row=>({
      scopeId:scope,classUid:row.uid,name:row.title,category:row.uid
    })),count:null};
    const uid=String(options.classUid||classes[0]?.uid||'');
    if(!UID.test(uid))return {data:{},count:null};
    const root=classes.find(row=>row.uid===uid);
    if(!root)return {data:{class_uid:uid,rows:[]},count:null};
    const references=row=>{
      const values=row?.attr?.uid??row?.attr?.groups??row?.attr?.items;
      return Array.isArray(values)?values.filter(value=>UID.test(String(value))):[];
    };
    const groupsIds=references(root);
    const groups=groupsIds.length?(await db.selectFrom(table)
      .select(['uid','type','title','description','attr'])
      .where('type','=','group').where('uid','in',groupsIds).execute()).map(parse):[];
    const byGroup=new Map(groups.map(row=>[row.uid,row]));
    const ordered=groupsIds.map(uid=>byGroup.get(uid)).filter(Boolean);
    const itemIds=[...new Set(ordered.flatMap(references))];
    const items=itemIds.length?(await db.selectFrom(table)
      .select(['uid','type','title','description','attr'])
      .where('type','=','item').where('uid','in',itemIds).execute()).map(parse):[];
    const byItem=new Map(items.map(row=>[row.uid,row]));
    const view=row=>({uid:row.uid,type:row.type,name:row.title,
      desc:row.type==='item'?'':row.description,
      lists:row.type==='item'?[]:references(row),uid_lists:[]});
    return {data:{class_uid:uid,rows:[view(root),...ordered.map(view),
      ...ordered.flatMap(group=>references(group).map(uid=>byItem.get(uid))
        .filter(Boolean).map(view))]},count:null};
  }
  const galaxy=portableRelation(scope+'_galaxy',engine,namespace);
  const anchor=portableRelation(scope+'_anchor',engine,namespace);
  const grouped=async(flag,fields,opts={})=>{
    let query=portableStatBase(db,galaxy,start,end,flag,opts.includeUndated);
    for(const field of fields){
      // Daily's includeUndated option must retain NULL dates. Other
      // dimensions remain non-null to preserve existing grouping contract.
      if(field==='date'&&opts.includeUndated===true)continue;
      query=query.where(field,'is not',null);
    }
    return query.select(fields)
      .select(eb=>eb.fn.countAll().as('n'))
      .groupBy(fields).orderBy(fields[0],'asc').execute();
  };
  const first=async()=>{
    const row=await db.selectFrom(galaxy)
      .select(eb=>eb.fn.min('date').as('day'))
      .where('statics','=',true).where('content','!=','').executeTakeFirst();
    return row?.day??null;
  };
  let data;
  if(mode==='earliest')data=await first();
  else if(mode==='daily'||mode==='overview'||mode==='loc'){
    const rows=await grouped('statics',['date','site'],
      {includeUndated:options.includeUndated===true});
    const source=rows.map(row=>({day:portableDay(row.date),kind:'source',
      category:String(row.site||'').trim(),item_count:Number(row.n)}));
    const totals=new Map();
    for(const row of source)totals.set(row.day,(totals.get(row.day)||0)+row.item_count);
    const summary=[...source,...[...totals].map(([day,n])=>({
      day,kind:'total',category:'文字作品',item_count:n
    }))].sort((a,b)=>a.day.localeCompare(b.day)||a.kind.localeCompare(b.kind));
    if(mode==='daily')data=summary;
    else if(mode==='overview'){
      // Overview only summarizes visible Galaxy source/date rows.
      // Retired multimedia counts must not touch Anchor or media_link.
      data={earliest:await first(),rows:summary,categories:[],aliases:[]};
    }else data={earliest:await first(),scopes:[{
      scope_id:scope,display_name:scope
    }],rows:summary.filter(x=>x.kind==='total').map(x=>({
      scope_id:scope,day:x.day,item_count:x.item_count
    }))};
  }else if(mode==='totals'){
    const rows=await grouped('statics',['site'],{includeUndated:true});
    data=rows.map(row=>({kind:'source',category:String(row.site||'').trim(),
      item_count:Number(row.n)}));
  }else if(mode==='trace_places'){
    const rows=await grouped('trace',['date','location']);
    data=rows.filter(row=>String(row.location||'').trim()).map(row=>({
      day:portableDay(row.date),category:String(row.location).trim(),
      item_count:Number(row.n)
    }));
  }else if(mode==='trace_daily'){
    const ids=options.placeIds;
    if(!Array.isArray(ids)||ids.length<1||ids.length>80||
       ids.some(id=>!UID.test(String(id||''))))reject('Invalid Point IDs');
    let query=portableStatBase(db,galaxy,start,end,'trace')
      .where('place_id','in',ids);
    if(options.source)query=query.where('site','=',String(options.source));
    const rows=await query.select(['date','place_id'])
      .select(eb=>eb.fn.countAll().as('n'))
      .groupBy(['date','place_id']).orderBy('date','asc').execute();
    data=rows.map(row=>({day:portableDay(row.date),category:row.place_id,
      item_count:Number(row.n)}));
  }else{
    // Advanced private keyword/trace joins require a matching portable
    // summary contract. Never silently substitute legacy provider-specific totals.
    reject('Unsupported portable LOC analytics mode');
  }
  return {data,count:null};
}
