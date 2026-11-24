import {canLocAccess} from './loc-authorization.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {sql} from 'kysely';
import {zmodelGalaxyPointJoin} from '../../../packages/zenstack/model-column-guard.mjs';
import {publishedManagedScope} from './published-managed-scope.mjs';
import {readItemKeywordProjection,itemKeywordStatistics,itemScope} from '../keywords/item-count-analysis.mjs';

// Fixed feature projections used by LOC-owned Server Actions.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
function reject(message,status=400){
  throw Object.assign(new Error(message),{httpStatus:status});
}
function relation(scope,suffix){return sql.ref('silver.'+scope+'_'+suffix);}
async function owns(trx,scope,role){
  return role==='authenticated'&&await canLocAccess(trx,'scope',scope);
}
export async function searchSummary(trx,options,{publishedScopeIds=null,
  engine='postgres',namespace='silver'}={}){
  const scopes=options.scopeIds;
  if(!Array.isArray(scopes)||scopes.length>100||
    scopes.some(x=>typeof x!=='string'||!SCOPE.test(x)))
    reject('Invalid Scope Search summary request');
  const requested=[...new Set(scopes)].sort();
  if(!requested.length)return {rows:[]};
  // Each Scope contributes only its published search summary. Read its own
  // fixed config relation in bounded parallel chunks; no cross-scope SQL route.
  const selected=new Set(publishedScopeIds===null?requested:publishedScopeIds);
  const scopeIds=requested.filter(scope=>{
    if(!selected.has(scope))return false;
    const published=publishedManagedScope(scope);
    return published?.manage_role==='scope'&&published.active===true;
  });
  const statusByScope=new Map();
  for(let i=0;i<scopeIds.length;i+=10){
    const batch=scopeIds.slice(i,i+10);
    const rows=await Promise.all(batch.map(async scope=>({scope,
      row:await trx.selectFrom(portableRelation(scope,engine,namespace))
        .select('status').where('id','=',scope).executeTakeFirst()
    })));
    for(const {scope,row} of rows){
      let status=row?.status;
      if(typeof status==='string'){
        try{status=JSON.parse(status)}catch{status=null}
      }
      statusByScope.set(scope,status);
    }
  }
  const result=[];
  for(const scope of scopeIds){
    const item=statusByScope.get(scope)?.search;
    if(item&&typeof item==='object'&&!Array.isArray(item)){
      result.push({scope_id:scope,article_count:item.article_count??null,
        word_count:item.word_count??null,first_date:item.first_date??null,
        last_date:item.last_date??null,refreshed_at:item.refreshed_at??null});
    }
  }
  return {rows:result};
}
export async function tracePlaces(trx,scope,start,end,{statisticsOnly=false}={}){
  const galaxy=relation(scope,'galaxy');
  // Trace owns its flag. A Statistics view requires both Galaxy.trace and
  // Galaxy.statics, without changing the Trace page's own counts.
  const statisticsFilter=statisticsOnly?sql`and statics is true`:sql``;
  const response=await sql`select date::text as day,btrim(location) as category,
    count(*)::bigint as item_count from ${galaxy}
    where trace is true ${statisticsFilter} and date is not null
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
export async function sharedClasses(trx,scope,anchor,role){
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
// READ PROJECTION for existing chart/tree consumers: uid_lists:[] is an
// output compatibility shape, not a stored Item/Group article index. Counts
// below are computed from Pattern postings. Do not persist the projection.
export async function keywordCatalog(trx,scope,anchor,requested,role,{withTotals=true}={}){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed)return {};
  const root=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
    .where('uid','=',info.uid).where('type','=','class').executeTakeFirst();
  if(!root)return {class_uid:info.uid,rows:[]};
  const attr=node=>typeof node?.attr==='string'?JSON.parse(node.attr):node?.attr||{};
  const children=(node,key)=>{
    const value=attr(node)[key]??attr(node).uid;
    return Array.isArray(value)?value.filter(uid=>UID.test(String(uid))):[];
  };
  const groupIds=children(root,'groups');
  const groups=groupIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','group').where('uid','in',groupIds).execute():[];
  const byGroup=new Map(groups.map(row=>[row.uid,row]));
  if(groupIds.some(uid=>!byGroup.has(uid)))reject('Broken Keyword Group relationship');
  const ordered=groupIds.map(uid=>byGroup.get(uid));
  const itemIds=[...new Set(ordered.flatMap(row=>children(row,'items')))];
  const items=itemIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','item').where('uid','in',itemIds).execute():[];
  const byItem=new Map(items.map(row=>[row.uid,row]));
  if(itemIds.some(uid=>!byItem.has(uid)))reject('Broken Keyword Item relationship');
  const descriptions=ordered.flatMap(group=>children(group,'items').map(uid=>{
    const item=byItem.get(uid);
    return {uid,item_name:String(item.title||''),
      group_uid:group.uid,keywords:Array.isArray(attr(item).keyword)?attr(item).keyword:[]};
  }));
  let totals=new Map(),groupTotals=new Map();
  if(withTotals){
    const stored=await trx.selectFrom(anchor)
      .select(['uid','attr']).where('uid','in',descriptions.map(i=>i.uid)
        .concat(ordered.map(g=>g.uid))).execute();
    const byUid=new Map(stored.map(row=>[row.uid,Number(attr(row).total)||0]));
    totals=new Map(descriptions.map(i=>[i.uid,byUid.get(i.uid)||0]));
    groupTotals=new Map(ordered.map(g=>[g.uid,byUid.get(g.uid)||0]));
  }
  const model=node=>({
    uid:node.uid,type:node.type,name:node.title,
    desc:node.type==='item'?'':node.description,
    lists:node.type==='class'?groupIds:node.type==='group'?children(node,'items'):
      node.type==='item'&&Array.isArray(attr(node).keyword)?attr(node).keyword:[],
    uid_lists:[],
    total:node.type==='group'?groupTotals.get(node.uid)||0:
      node.type==='item'?totals.get(node.uid)||0:0
  });
  return {class_uid:info.uid,rows:[model(root),...ordered.map(model),
    ...descriptions.map(item=>model(byItem.get(item.uid)))]};
}
// A single indexed calendar-year GROUP BY includes every article with a
// place_id, not just points belonging to the selected route or trace=true.
// No content, article rows, unlinked source tables or coordinates leave SQL.
export async function traceTerritory(trx,scope,start,end,{withPoints=false,statisticsOnly=false}={}){
  if(!start||!end)reject('Territory statistics require a bounded period');
  const galaxy=relation(scope,'galaxy');
  // Count all Galaxy articles linked to a visible Point, regardless of Galaxy
  // trace/list flags. Anchor.invisible owns the territory visibility boundary.
  // Group by date/site to support timeline and source shares without fetching
  // Galaxy articles or constructing a Point UID list in advance.
  // Standard Trace territory keeps its original visibility semantics.
  // The four-dimensional Statistics comparison requires BOTH independent
  // Galaxy feature switches. Trace territory without this option is unchanged.
  const statisticsFilter=statisticsOnly
    ?sql`and g.statics is true and g.trace is true`:sql``;
  const grouped=sql`(
    select g.place_id::text as place_id,
      (g.date)::text as day,btrim(coalesce(g.site,'')) as site,
      count(*)::bigint as item_count
    from ${galaxy} g
    where g.place_id is not null and btrim(g.place_id::text)<>''
      and g.date between ${start}::date and ${end}::date
      ${statisticsFilter}
    group by 1,2,3
  )`.as('g');
  // ZModel verifies the Galaxy/Point join, including a.type=point and
  // a.invisible=false. Reject unmatched/hidden Points from the statistics too.
  let query=zmodelGalaxyPointJoin(trx.selectFrom(grouped),{scopeId:scope})
    .where('a.uid','is not',null)
    .select(['g.place_id as place_id','g.day as day','g.site as site',
      'g.item_count as item_count']);
  if(withPoints){
    query=query.select(['a.uid as point_uid','a.title as point_title',
      sql`a.attr->>'longitude'`.as('point_longitude'),
      sql`a.attr->>'latitude'`.as('point_latitude')]);
  }
  const rows=await query.orderBy('g.day','asc').orderBy('g.place_id','asc')
    .orderBy('g.site','asc').execute();
  return rows.map(row=>({...row,item_count:Number(row.item_count||0)}));
}
export async function traceDaily(trx,scope,places,start,end,source){
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
// One GROUP BY returns the per-day count of a single Item Confluence lane.
// Filters are fixed server-side; callers only choose a media flag, a platform
// key from LANE_PLATFORMS, or an exact site/type. No row ever leaves the DB.
const LANE_PLATFORMS=Object.freeze({
  facebook:['%facebook%','fb'],threads:['%threads%'],
  instagram:['%instagram%','ig','%reels%']
});
export async function laneDaily(trx,scope,start,end,options){
  // The three-month Culture item comparison reads only the article's
  // canonical Galaxy.site, never a parallel MediaAnchor statistics table.
  const exact=options.exact==null||options.exact===''?null:String(options.exact);
  const platform=options.platform==null||options.platform===''?null:String(options.platform);
  if(!start||!end||(Date.parse(end)-Date.parse(start))/864e5>366)
    reject('Lane statistics need a bounded date range');
  if(platform&&(!Object.hasOwn(LANE_PLATFORMS,platform)||exact!==null))
    reject('Invalid lane platform');
  const table=sql.ref('silver.'+scope+'_galaxy');
  let where=sql`g.date is not null
      and (${start}::date is null or g.date>=${start}::date)
      and (${end}::date is null or g.date<=${end}::date)`;
  if(exact!==null)where=sql`${where} and g.site=${exact}`;
  if(platform)where=sql`${where} and (${sql.join(LANE_PLATFORMS[platform]
    .map(pattern=>sql`g.site ilike ${pattern}`),sql` or `)})`;
  const result=await sql`select to_char(g.date,'YYYY-MM-DD') as day,
      count(*)::integer as item_count
    from ${table} g where ${where} group by 1 order by 1`.execute(trx);
  return result.rows.map(row=>({day:row.day,item_count:Number(row.item_count||0)}));
}
export async function traceKeywordGroups(trx,scope,anchor,places,start,end,source,requested,role){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed||!info.ready)return [];
  const catalog=await keywordCatalog(trx,scope,anchor,requested,role,{withTotals:false});
  if(!catalog.class_uid||!Array.isArray(places)||!places.length)return [];
  const groups=(catalog.rows||[]).filter(row=>row.type==='group');
  const items=(catalog.rows||[]).filter(row=>row.type==='item')
    .flatMap(row=>groups.filter(g=>g.lists.includes(row.uid)).map(g=>({
      uid:row.uid,group_uid:g.uid,item_name:row.name,keywords:row.lists
    })));
  const res=await readItemKeywordProjection(trx,scope,{
    items,groups,places,start,end,source,owner:true,
    minChars:Math.max(0,Number(info.config?.keyword_min_chars)||0)
  });
  return groups.map(group=>({
    group_uid:group.uid,group_name:group.name,
    document_count:Number(res.totals.groupDocuments?.[group.uid])||0
  }));
}
export async function keywordSummary(trx,scope,anchor,start,end,source,requested,role){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role);
  if(!info?.allowed||!info.ready)return [];
  const catalog=await keywordCatalog(trx,scope,anchor,requested,role,{withTotals:false});
  if(!catalog.class_uid)return [];
  const groups=(catalog.rows||[]).filter(row=>row.type==='group');
  const items=(catalog.rows||[]).filter(row=>row.type==='item')
    .flatMap(row=>groups.filter(g=>g.lists.includes(row.uid)).map(g=>({
      uid:row.uid,group_uid:g.uid,item_name:row.name,keywords:row.lists
    })));
  const res=await readItemKeywordProjection(trx,scope,{
    items,groups,start,end,source,owner:true,
    minChars:Math.max(0,Number(info.config?.keyword_min_chars)||0)
  });
  return res.daily;
}
