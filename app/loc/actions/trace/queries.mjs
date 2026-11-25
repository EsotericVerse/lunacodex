'use server';
import {sql} from 'kysely';
import {withPublicLocRead} from '../read-context.mjs';
import {traceKeywordGroups} from '../../providers/kysely-analytics.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';
import {readDateRangeAggregates}
  from '../../query/date-range-aggregate.mjs';

const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&
  row.scope_id!=='loc'&&row.scope_id!=='admin').map(row=>row.scope_id));
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const VIEWS=new Set(['trace_places','trace_territory','trace_daily',
  'lane_daily','trace_keywords']);
const OPTIONS=new Set(['scopeIds','placeIds','classUid','source','site','offset',
  'platform','exact','withPoints','statisticsOnly']);
const scopeId=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!published.has(scope))throw Error('Invalid Trace Scope');
  return scope;
};
const date=value=>{
  if(value==null||value==='')return null;
  const result=String(value);
  if(!DAY.test(result))throw Error('Invalid Trace date');
  return result;
};
const day=value=>value instanceof Date?value.toISOString().slice(0,10):
  String(value??'').slice(0,10);
async function completeRange(build,start,end){
  if(start&&end)return {start,end};
  const bounds=await build(start,end).select(eb=>[
    eb.fn.min('date').as('range_start'),eb.fn.max('date').as('range_end')
  ]).executeTakeFirst();
  return {start:start||day(bounds?.range_start),end:end||day(bounds?.range_end)};
}
function galaxyTable(scope,port){
  return portableRelation(scope+'_galaxy',port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
}
async function portableTracePlaces(db,table,start,end,statisticsOnly){
  const build=(rangeStart=start,rangeEnd=end)=>{
    let query=db.selectFrom(table).where('trace','=',true)
      .where('date','is not',null).where('location','is not',null)
      .where('location','!=','');
    if(statisticsOnly)query=query.where('statics','=',true);
    if(rangeStart)query=query.where('date','>=',rangeStart);
    if(rangeEnd)query=query.where('date','<=',rangeEnd);
    return query;
  };
  const grouped=new Map();
  const {start:rangeStart,end:rangeEnd}=await completeRange(build,start,end);
  if(rangeStart&&rangeEnd)await readDateRangeAggregates({
    start:rangeStart,end:rangeEnd,
    query:({start:chunkStart,end:chunkEnd})=>build(chunkStart,chunkEnd)
      .select(['date','location'])
      .select(eb=>eb.fn.countAll().as('item_count'))
      .groupBy(['date','location']).execute(),
    consume:rows=>{
      for(const row of rows){
        const category=String(row.location||'').trim();
        if(!category)continue;
        const key=JSON.stringify([day(row.date),category]);
        grouped.set(key,(grouped.get(key)||0)+Number(row.item_count||0));
      }
    }
  });
  return [...grouped].map(([key,item_count])=>{
    const [dayValue,category]=JSON.parse(key);
    return {day:dayValue,category,item_count};
  }).sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}
async function portableTraceTerritory(db,scope,start,end,options,port){
  if(!start||!end)throw Error('Territory statistics require a bounded period');
  const galaxy=galaxyTable(scope,port);
  const anchor=portableRelation(scope+'_anchor',port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
  const build=(rangeStart,rangeEnd)=>{
    let query=db.selectFrom(galaxy+' as g').innerJoin(anchor+' as a',join=>join
    .onRef('a.uid','=','g.place_id').on('a.type','=','point')
    .on('a.invisible','=',false))
    .where('g.place_id','is not',null).where('g.place_id','!=','')
    .where('g.date','>=',rangeStart).where('g.date','<=',rangeEnd);
    if(options.statisticsOnly===true)
      query=query.where('g.statics','=',true).where('g.trace','=',true);
    return query;
  };
  const grouped=new Map();
  const range=await completeRange(build,start,end);
  if(range.start&&range.end)await readDateRangeAggregates({start:range.start,end:range.end,
    query:({start:chunkStart,end:chunkEnd})=>{
      const aggregate=build(chunkStart,chunkEnd)
        .select(['g.place_id as place_id','g.site as site','g.date as date'])
        .select(eb=>eb.fn.countAll().as('item_count'))
        .groupBy(['g.place_id','g.site','g.date']).as('aggregate');
      let query=db.selectFrom(aggregate);
      if(options.withPoints===true){
        query=query.innerJoin(anchor+' as a','a.uid','aggregate.place_id')
          .select(['aggregate.place_id as place_id','aggregate.site as site',
            'aggregate.date as date','aggregate.item_count as item_count',
            'a.uid as point_uid','a.title as point_title','a.attr as point_attr']);
      }else query=query.select(['aggregate.place_id as place_id',
        'aggregate.site as site','aggregate.date as date',
        'aggregate.item_count as item_count']);
      return query.execute();
    },
    consume:rows=>{
      for(const row of rows){
        let attr=row.point_attr;
        if(typeof attr==='string'){try{attr=JSON.parse(attr)}catch{attr={}}}
        attr=attr&&typeof attr==='object'?attr:{};
        const item={place_id:String(row.place_id||''),site:String(row.site||'').trim(),
          day:day(row.date),item_count:Number(row.item_count||0),
          ...(options.withPoints===true?{point_uid:row.point_uid,
            point_title:row.point_title,
            point_longitude:attr.longitude??attr.lng??null,
            point_latitude:attr.latitude??attr.lat??null}: {})};
        const key=JSON.stringify(options.withPoints===true
          ?[item.place_id,item.day,item.site,item.point_uid]
          :[item.place_id,item.day,item.site]);
        const current=grouped.get(key)||item;
        if(current!==item)current.item_count+=item.item_count;
        grouped.set(key,current);
      }
    }
  });
  return [...grouped.values()].sort((a,b)=>a.day.localeCompare(b.day)||
    a.place_id.localeCompare(b.place_id)||a.site.localeCompare(b.site));
}
async function portableTraceDaily(db,table,places,start,end,source){
  const build=(rangeStart=start,rangeEnd=end)=>{
    let query=db.selectFrom(table).where('trace','=',true)
      .where('place_id','in',places).where('date','is not',null);
    if(rangeStart)query=query.where('date','>=',rangeStart);
    if(rangeEnd)query=query.where('date','<=',rangeEnd);
    if(source)query=query.where('site','=',source);
    return query;
  };
  const grouped=new Map();
  const range=await completeRange(build,start,end);
  if(range.start&&range.end)await readDateRangeAggregates({
    start:range.start,end:range.end,
    query:({start:chunkStart,end:chunkEnd})=>build(chunkStart,chunkEnd)
      .select(['date','place_id'])
      .select(eb=>eb.fn.countAll().as('item_count'))
      .groupBy(['date','place_id']).execute(),
    consume:rows=>{
      for(const row of rows){
        const key=JSON.stringify([day(row.date),String(row.place_id||'')]);
        grouped.set(key,(grouped.get(key)||0)+Number(row.item_count||0));
      }
    }
  });
  return [...grouped].map(([key,item_count])=>{
    const [dayValue,category]=JSON.parse(key);
    return {day:dayValue,category,item_count};
  }).sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}
async function portableLaneDaily(db,table,start,end,options){
  if(!start||!end||(Date.parse(end)-Date.parse(start))/864e5>366)
    throw Error('Lane statistics need a bounded date range');
  const exact=options.exact==null||options.exact===''?null:String(options.exact);
  const platform=options.platform==null||options.platform===''?null:String(options.platform);
  const patterns={facebook:['%facebook%','fb'],threads:['%threads%'],
    instagram:['%instagram%','ig','%reels%']};
  if(platform&&(!Object.hasOwn(patterns,platform)||exact!==null))
    throw Error('Invalid lane platform');
  const build=(rangeStart,rangeEnd)=>{
    let query=db.selectFrom(table).where('date','>=',rangeStart)
      .where('date','<=',rangeEnd).where('date','is not',null);
    if(exact!==null)query=query.where('site','=',exact);
    if(platform){
      const choices=patterns[platform].map(pattern=>pattern==='fb'||pattern==='ig'
        ?eb=>eb(sql`lower(site)`,'=',pattern)
        :eb=>eb(sql`lower(site)`,'like',pattern));
      query=query.where(eb=>eb.or(choices.map(choice=>choice(eb))));
    }
    return query;
  };
  const totals=new Map();
  await readDateRangeAggregates({start,end,
    query:({start:chunkStart,end:chunkEnd})=>build(chunkStart,chunkEnd)
      .select('date').select(eb=>eb.fn.countAll().as('item_count'))
      .groupBy('date').execute(),
    consume:rows=>{
      for(const row of rows){
        const key=day(row.date);
        totals.set(key,(totals.get(key)||0)+Number(row.item_count||0));
      }
    }
  });
  return [...totals].map(([dayValue,item_count])=>({day:dayValue,item_count}))
    .sort((a,b)=>a.day.localeCompare(b.day));
}

export async function queryTrace(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['p_scope_id','p_view','p_start','p_end','p_options'].includes(key)))
    throw Error('Invalid Trace query');
  const scope=scopeId(args.p_scope_id),view=String(args.p_view||'');
  const start=date(args.p_start),end=date(args.p_end);
  const options=args.p_options??{};
  if(!VIEWS.has(view)||!options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(key=>!OPTIONS.has(key))||start&&end&&start>end)
    throw Error('Invalid Trace query');
  if(options.statisticsOnly!==undefined&&(
      typeof options.statisticsOnly!=='boolean'||
      !['trace_places','trace_territory'].includes(view))||
    options.withPoints!==undefined&&(
      typeof options.withPoints!=='boolean'||view!=='trace_territory'))
    throw Error('Invalid Trace options');
  if(options.classUid!=null&&(!/^[A-Za-z0-9]{8}$/.test(String(options.classUid))))
    throw Error('Invalid Keyword Class UID');
  const modelCache=view==='lane_daily'?null:{model:view,args:[start,end,options]};
  return withPublicLocRead({scope,modelCache},async(db,port)=>{
    const table=galaxyTable(scope,port);
    let data;
    if(view==='trace_places')
      data=await portableTracePlaces(db,table,start,end,options.statisticsOnly===true);
    else if(view==='trace_territory')
      data=await portableTraceTerritory(db,scope,start,end,options,port);
    else if(view==='lane_daily')
      data=await portableLaneDaily(db,table,start,end,options);
    else if(view==='trace_daily'){
      const ids=options.placeIds;
      if(!Array.isArray(ids)||ids.length<1||ids.length>80||
        ids.some(uid=>!UID.test(String(uid||''))))throw Error('Invalid Trace Point UID list');
      const source=options.source?String(options.source).trim():null;
      if(source&&source.length>120)throw Error('Invalid Trace Source');
      data=await portableTraceDaily(db,table,[...new Set(ids.map(String))],start,end,source);
    }else{
      const ids=options.placeIds;
      if(!Array.isArray(ids)||ids.length<1||ids.length>80||
        ids.some(uid=>!UID.test(String(uid||''))))throw Error('Invalid Trace Point UID list');
      const source=options.source?String(options.source).trim():null;
      if(source&&source.length>120)throw Error('Invalid Trace Source');
      const namespace=port.namespace||(port.engine==='postgres'?'silver':'dbo');
      const anchor=portableRelation(scope+'_anchor',port.engine,namespace);
      const configTable=portableRelation(scope,port.engine,namespace);
      data=await traceKeywordGroups(db,scope,anchor,
        [...new Set(ids.map(String))],start,end,source,options.classUid||null,
        'public',{configTable,galaxyTable:table});
    }
    return {data,count:null};
  });
}

export async function queryTracePlaceNames(args={}){
  if(!args||
    typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['p_scope_id','p_term','p_limit'].includes(key)))
    throw Error('Invalid Trace action');
  const scope=scopeId(args.p_scope_id);
  const term=String(args.p_term||'').trim().slice(0,100);
  const limit=Math.max(1,Math.min(8,Number(args.p_limit)||8));
  if(!term)return {data:[],count:null};
  return withPublicLocRead({scope},async(db)=>{
    const pattern='%'+term.replace(/[\\%_]/g,char=>'\\'+char)+'%';
    const anchor=sql.ref('silver.'+scope+'_anchor');
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
      order by a.title limit ${limit}`.execute(db);
    return {data:result.rows,count:null};
  });
}
