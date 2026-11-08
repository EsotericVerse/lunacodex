'use client';



import {CultureTimelineModel} from '../modular/modules/culture-timeline/culture-timeline-model';
import {workDisplayText} from '../modular/work-display-model';
import {selectScopeDailyCounts} from './galaxy-query';
import {DB_QUERY_BATCH_SIZE,selectAllRows,selectCount,selectRows} from './db-query.mjs';
import {mapBounded} from './bounded-parallel.mjs';
import {publicContentFilters} from './content-policy';
import {selectScopeGroupMemberIds,defaultScopeData} from './scope-data';
import {PUBLISHED_SITE_BOOTSTRAP} from '../modular/published-site-bootstrap.js';
import {resolveTimeSegments,resolveTimeTrace,timePeriodSortDate,timeDateWindows,timePeriodContainsDate,intersectTimeDateWindows,storedTimeRange} from './time-anchor-ranges.mjs';



const TIME_COLUMNS='uid,type,title,description,address,anchor_ids,range';
function scopeIdOf(value){return String(value||'').trim();}
function timeDate(row){return row?.address?String(row.address).slice(0,10):null;}
function previousDay(value){
  if(!value)return null;
  const date=new Date(String(value).slice(0,10)+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}
export async function selectCultureTimeRows(scope,birthday=''){
  const scopeId=scopeIdOf(scope?.id);
  // Read the legacy Time projection, not native *_anchor columns. The adapter
  // maps address/anchor_ids to attr.date/attr.uid/attr.period.
  const table=String(scope?.time||'').replace(/_anchor$/,'_time');
  if(!scopeId||!table)throw new Error('Scope data 未解析');
  const {rows}=await selectRows(table,{
    columns:TIME_COLUMNS,
    filters:[{column:'type',operator:'in',value:['anchor','period','era']}],
    limit:DB_QUERY_BATCH_SIZE,offset:0
  });
  const anchors=rows.filter(row=>row.type==='anchor');
  const byUid=new Map(anchors.map(row=>[String(row.uid),row]));
  const normalize=(row,type,eventMap)=>{
    const id=String(row.uid||'');
    const projected=storedTimeRange(row.range);
    const ranges=projected?projected.ranges:type==='anchor'?[{
      index:0,start_date:timeDate(row),end_date:timeDate(row),
      start_anchor_id:id,end_anchor_id:null,anchor_ids:[id],point:true,invalid:false
    }]:type==='era'
      ?resolveTimeTrace(row.anchor_ids,eventMap).ranges
      :resolveTimeSegments(row.anchor_ids,byUid,{period:false});
    const invalidTraceLinks=projected?projected.invalidPeriodUids:type==='era'
      ?resolveTimeTrace(row.anchor_ids,eventMap).invalidLinks:[];
    const dated=ranges.filter(range=>range.start_date).sort((a,b)=>
      a.start_date.localeCompare(b.start_date)||a.index-b.index);
    const first=dated[0],last=dated.at(-1);
    // Overlapping events can end out of start-date order. The envelope is
    // only for camera/labels; precise article filters use each range.
    const finalDate=ranges.map(range=>range.end_date||range.start_date)
      .filter(Boolean).sort().at(-1)||null;
    const openEnd=false;
    return {...row,scope_id:scopeId,
      entry_key:type+':'+id,entry_type:type,
      title:row.title||id,summary:row.description||'',
      era_id:type==='era'?id:null,period:type==='era'?id:null,
      entry_name:type==='era'?String(row.title||'').replace(/^P\d+\s*[｜|]\s*/,''):null,
      anchor_id:type==='anchor'?id:null,
      anchor_ids:type==='anchor'?[]:(Array.isArray(row.anchor_ids)?row.anchor_ids:[]),
      ranges,
      start_anchor_id:first?.start_anchor_id||null,
      end_anchor_id:last?.end_anchor_id||null,
      event_id:type==='period'?id:null,
      open_start:false,open_end:openEnd,
      start_date:first?.start_date||null,
      end_date:finalDate,
      invalid_anchor_links:[
        ...invalidTraceLinks,
        ...ranges.filter(range=>range.invalid).flatMap(range=>range.missing_anchor_ids||[])
      ]};
  };
  const events=rows.filter(row=>row.type==='period')
    .map(row=>normalize(row,'period',new Map()));
  const byEventUid=new Map(events.map(row=>[String(row.uid),row]));
  const periods=rows.filter(row=>row.type==='era')
    .map(row=>normalize(row,'era',byEventUid));
  return [...anchors.map(row=>normalize(row,'anchor',new Map())),
    ...periods,...events];
}

function openPeriodRangeFromRows(scopeId,rows=[]){
  // Legacy helper name retained for callers. This is a real, closed
  // era chosen by its nearest actual endpoint, NEVER open-ended now.
  const traces=rows.filter(row=>row.entry_type==='era'&&
    row.ranges?.some(range=>range.start_date));
  const day=new Date().toISOString().slice(0,10),target=Date.parse(day+'T00:00:00Z');
  const ranked=traces.map(row=>{
    const windows=timeDateWindows(row.ranges);
    const distances=windows.map(range=>{
      const start=Date.parse(range.startDate+'T00:00:00Z');
      const end=Date.parse(range.endDate+'T00:00:00Z');
      return {distance:target<start?start-target:target>end?target-end:0,end};
    }).sort((a,b)=>a.distance-b.distance||b.end-a.end);
    return {...row,distance:distances[0]?.distance??Infinity,latestEnd:distances[0]?.end??0};
  }).sort((a,b)=>a.distance-b.distance||b.latestEnd-a.latestEnd);
  const closest=ranked[0];
  if(!closest||!Number.isFinite(closest.distance))return null;
  return {...closest,scope_id:scopeId,
    display_label:closest.title||'時代',
    derived_from:'era period UID collection of actual anchor dates'};
}

const LOC_SOURCE_ORDER=Object.freeze(['Facebook','Threads','IG','Others']);
function locSourceCategory(value=''){
  const source=String(value||'').trim().toLowerCase();
  if(!source)return 'Others';
  if(source.includes('facebook')||source==='fb')return 'Facebook';
  if(source.includes('threads'))return 'Threads';
  if(source.includes('instagram')||source.includes('reels')||source==='ig')return 'IG';
  return 'Others';
}
function buildLocScopeDistribution(rows=[]){
  const combined=new Map();
  for(const row of rows){
    const scope=scopeIdOf(row?.scope_id||'');
    const day=String(row?.day||'').slice(0,10);
    if(!scope||!day)continue;
    const key=scope+'|'+day;
    const current=combined.get(key)||{scope_id:scope,start_date:day,item_count:0};
    current.item_count+=Number(row?.item_count)||0;
    combined.set(key,current);
  }
  return [...combined.values()]
    .sort((a,b)=>String(a.scope_id).localeCompare(String(b.scope_id))||String(a.start_date).localeCompare(String(b.start_date)));
}

function buildLocSourceRiver(rows=[]){
  const combined=new Map();
  const totals=new Map(LOC_SOURCE_ORDER.map(category=>[category,0]));
  for(const row of rows){
    const category=locSourceCategory(row.category);
    const count=Number(row.item_count)||0;
    totals.set(category,(totals.get(category)||0)+count);
    const day=String(row.day||'').slice(0,10);
    if(!day)continue;
    const key=category+'|'+day;
    const current=combined.get(key)||{category,day,item_count:0};
    current.item_count+=count;
    combined.set(key,current);
  }
  const perCategoryMax=new Map();
  let globalMax=0;
  for(const row of combined.values()){
    perCategoryMax.set(row.category,Math.max(perCategoryMax.get(row.category)||0,row.item_count));
    globalMax=Math.max(globalMax,row.item_count);
  }
  const sourceRiverItems=[...combined.values()].map(row=>({
    id:'loc-source:'+row.category+':'+row.day,
    entry_id:'loc-source:'+row.category+':'+row.day,
    entry_type:'source_density',
    scope_id:'loc',
    group_label:row.category,
    category:row.category,
    start_date:row.day,
    item_count:row.item_count,
    density_ratio:row.item_count/Math.max(1,perCategoryMax.get(row.category)||1),
    global_density_ratio:row.item_count/Math.max(1,globalMax),
    display_label:row.category+' '+row.item_count+' 項',
    title:row.day+' · '+row.category+' · '+row.item_count+' 項'
  })).sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))||LOC_SOURCE_ORDER.indexOf(a.category)-LOC_SOURCE_ORDER.indexOf(b.category));
  const sourceGroups=LOC_SOURCE_ORDER.map(category=>({
    category_key:'source:'+category,
    category_type:'source',
    site:category,
    display_label:category,
    item_count:Number(totals.get(category))||0
  })).filter(row=>row.item_count>0);
  return {sourceRiverItems,sourceGroups};
}

function sourceLabel(value){return String(value||'').trim();}
function mondayOf(value){
  const key=String(value||'').slice(0,10);
  if(!key)return '';
  const date=new Date(key+'T00:00:00Z');
  const day=date.getUTCDay();
  date.setUTCDate(date.getUTCDate()+(day===0?-6:1-day));
  return date.toISOString().slice(0,10);
}
function periodRows(rows){
  return (rows||[]).map(row=>({
    era_id:row.era_id||row.entry_key,period:row.period||row.entry_key||'',
    uid:row.uid||null,name:row.entry_name||row.title||row.entry_key,
    title:row.title||row.entry_key,description:row.summary||'',
    start_date:row.start_date||null,end_date:row.end_date||null,
    ranges:row.ranges||[],
    anchor_id:row.anchor_id||null,start_anchor_id:row.start_anchor_id||null,
    end_anchor_id:row.end_anchor_id||null,
    anchor_ids:Array.isArray(row.anchor_ids)?row.anchor_ids:[],
    open_start:Boolean(row.open_start),open_end:Boolean(row.open_end),
    invalid_anchor_links:row.invalid_anchor_links||[]
  })).sort((a,b)=>
    timePeriodSortDate(a).localeCompare(timePeriodSortDate(b)));
}
function timelineItems(rows,{includeScope=false}={}){
  const all=Array.isArray(rows)?rows:[];
  const anchors=new Map(all.filter(row=>row.entry_type==='anchor').map(row=>[row.scope_id+':'+row.anchor_id,row]));
  return all.filter(row=>['anchor','period','era'].includes(row.entry_type))
    .flatMap(row=>{
      const slices=row.entry_type==='anchor'?[row]:row.ranges?.length?row.ranges:[row];
      return slices.map((range,index)=>{
        const scopeId=scopeIdOf(row.scope_id);
        const start=range.start_date||null,end=range.end_date||null;
        const kindLabel={anchor:'定錨點',period:'期間',era:'時代'}[row.entry_type];
        return {...row,scope_id:scopeId,
          id:scopeId+':'+row.entry_key+':'+index,
          entry_id:scopeId+':'+row.entry_key+':'+index,
          segment_index:index,start_date:start,end_date:end,date:start||end,
          open_end:range.open_end??row.open_end,
          invalid_anchor_links:range.missing_anchor_ids||[],
          display_label:row.title,description:row.summary,
          group_key:includeScope?scopeId+':'+row.entry_type:'kind:'+row.entry_type,
          group_label:includeScope?scopeId+' · '+kindLabel:kindLabel,
          group_order:{anchor:0,period:1,era:2}[row.entry_type]??99
        };
      });
    }).filter(row=>row.start_date||row.entry_type==='era')
    .sort((a,b)=>String(a.start_date||'9999-12-31').localeCompare(String(b.start_date||'9999-12-31'))||
      a.segment_index-b.segment_index);
}
function dateFilters(startDate,endDate,column='createtime'){
  const filters=[],isDate=column==='date';
  if(startDate)filters.push({column,operator:'gte',value:String(startDate).slice(0,10)+(isDate?'':'T00:00:00+08:00')});
  if(endDate)filters.push({column,operator:'lte',value:String(endDate).slice(0,10)+(isDate?'':'T23:59:59.999+08:00')});
  return filters;
}
function cultureParts(scopeContext,runtimeId){
  const normalizedContext=(scopeContext||[]).map(row=>({...row,scope_id:runtimeId}));
  const periods=normalizedContext.filter(row=>row.entry_type==='era');
  const eras=periods.map(row=>({
    ...periodRows([row])[0],
    scope_id:runtimeId,
    group_label:runtimeId+' 時代'
  }));
  const events=normalizedContext.filter(row=>row.entry_type==='period').map(row=>({
    entry_id:row.event_id||row.entry_key,
    event_id:row.event_id||row.entry_key,
    scope_id:runtimeId,
    title:row.title,
    description:row.summary||'',
    date:row.start_date||null,
    start_date:row.start_date||null,
    end_date:row.end_date||null,
    anchor_ids:Array.isArray(row.anchor_ids)?row.anchor_ids:[],
    visibility:'public'
  }));
  const trajectories=normalizedContext.filter(row=>row.entry_type==='anchor').map(row=>({
    entry_id:row.entry_key,
    trajectory_id:row.entry_key,
    scope_id:runtimeId,
    title:row.title,
    description:row.summary||'',
    start_date:row.start_date||null,
    date:row.start_date||null,
    end_date:row.end_date||null,
    anchor_id:row.anchor_id||null,
  }));
  const styleComments=[];
  return {normalizedContext,periods,eras,events,trajectories,styleComments};
}

// Only the explicitly opened LOC second river reads per-day article/media counts.
export async function selectLocCultureDensity({scopes=[],intersectionWindows=[],intersectionStart='',intersectionEnd=''}={}){
  if(!scopes.length||!intersectionWindows.length||!intersectionStart||!intersectionEnd)
    return {scopeRanges:[],sourceRiverItems:[],sourceGroups:[]};
  const validDate=row=>{
    const day=String(row.day||'').slice(0,10);
    return intersectionWindows.some(shared=>day>=shared.startDate&&day<=shared.endDate);
  };
  const aggregateRows=(await mapBounded(scopes,2,async scope=>{
    const {text:textDaily,media:mediaDaily}=await selectScopeDailyCounts(scope,{
      startDate:intersectionStart,endDate:intersectionEnd,
      includeEmptyMedia:true,requireAggregate:true
    });
    return [
      ...textDaily.filter(validDate).map(row=>({...row,scope_id:scope.id})),
      ...mediaDaily.filter(validDate).map(row=>({...row,scope_id:scope.id}))
    ];
  })).flat();
  const built=buildLocSourceRiver(aggregateRows);
  return {
    scopeRanges:buildLocScopeDistribution(aggregateRows),
    sourceRiverItems:built.sourceRiverItems,
    sourceGroups:built.sourceGroups
  };
}

export async function selectScopeCultureData(scopeId){
  const id=scopeIdOf(scopeId);
  if(!id)throw new Error('資料設定無效');

  if(id==='loc'){
    // Public Group membership and routing were already released as a static
    // site snapshot. No api.manage read: the public Data API exposes silver,
    // not the internal api schema. Runtime time/era data remain live reads.
    const members=await selectScopeGroupMemberIds('loc','culture');
    const managedScopes=(PUBLISHED_SITE_BOOTSTRAP.registry||[])
      .filter(entry=>entry.scope_kind==='scope'&&entry.active!==false&&members.has(entry.scope_id))
      .map(entry=>defaultScopeData(entry.scope_id)).filter(Boolean);
    if(!managedScopes.length){
      return {
        scopeId:id,scope:null,eras:{eras:[]},periods:[],openRanges:[],scopeRanges:[],
        timelineItems:[],sourceRiverItems:[],sourceGroups:[],events:[],trajectories:[],
        works:[],scopeTimeRanges:[],intersectionStart:''
      };
    }

    // A Scope Group may contain many sites; don't open all Time readers together.
    const bundles=await mapBounded(managedScopes,2,async scope=>{
      const context=await selectCultureTimeRows(scope,scope.birthday);
      return {scope,runtimeId:scope.id,context};
    });

    // Every saved era contributes its actual period intervals.
    // Merge within each Scope, then intersect the resulting sets across all
    // Scopes that have defined periods. Never use the nearest trace.
    const withWindows=bundles.map(bundle=>({
      bundle,
      windows:timeDateWindows(bundle.context
        .filter(row=>row.entry_type==='era')
        .flatMap(row=>row.ranges||[]))
    })).filter(item=>item.windows.length>0);
    const intersectionWindows=intersectTimeDateWindows(withWindows.map(item=>item.windows));
    const intersectionStart=intersectionWindows[0]?.startDate||'';
    const intersectionEnd=intersectionWindows.at(-1)?.endDate||'';
    const intersectionScopeIds=intersectionWindows.length
      ?withWindows.map(item=>item.bundle.runtimeId):[];
    const openRanges=withWindows.map(({bundle,windows})=>({
      scope_id:bundle.runtimeId,
      start_date:windows[0].startDate,
      end_date:windows.at(-1).endDate,
      ranges:windows.map(window=>({
        start_date:window.startDate,end_date:window.endDate
      }))
    }));

    // The LOC timeline itself shows only shared dates. Clipping the visible
    // per-Scope ranges avoids displaying a union disguised as an intersection.
    const scopeTimeRanges=bundles.flatMap((bundle,scopeIndex)=>
      bundle.context.filter(row=>row.entry_type==='era').flatMap(row=>
        (row.ranges||[])
          .filter(range=>range.start_date&&(!range.invalid||range.point))
          .flatMap((range,index)=>intersectionWindows.flatMap((shared,sharedIndex)=>{
            const startDate=range.start_date>shared.startDate?range.start_date:shared.startDate;
            const rangeEnd=range.end_date||range.start_date;
            const endDate=rangeEnd<shared.endDate?rangeEnd:shared.endDate;
            if(startDate>endDate)return [];
            return [{
              id:'loc-time:'+bundle.runtimeId+':'+row.uid+':'+index+':'+sharedIndex,
              entry_id:'loc-time:'+bundle.runtimeId+':'+row.uid+':'+index+':'+sharedIndex,
              entry_type:'scope_time_range',
              scope_id:bundle.runtimeId,
              group_label:bundle.runtimeId,
              group_order:scopeIndex,
              start_date:startDate,end_date:endDate,
              title:[row.title||'時代',startDate,endDate!==startDate?'～ '+endDate:''].filter(Boolean).join(' · '),
              display_label:''
            }];
          }))
      )
    );

    if(!intersectionWindows.length){
      return {
        scopeId:id,scope:null,eras:{eras:[]},periods:[],openRanges,scopeRanges:[],
        timelineItems:[],sourceRiverItems:[],sourceGroups:[],events:[],trajectories:[],
        works:[],scopeTimeRanges:[],scopes:bundles.map(bundle=>bundle.scope),
        intersectionStart:'',intersectionEnd:'',intersectionScopeIds:[],
        intersectionWindows:[]
      };
    }

    // Shared time intervals are the first river. Their daily densities are
    // read only if the visitor expands the second river.
    return {
      scopeId:id,
      scope:null,
      scopes:withWindows.map(({bundle})=>bundle.scope),
      eras:{eras:[]},
      periods:[],
      openRanges,
      scopeTimeRanges,
      scopeRanges:[],
      timelineItems:[],
      sourceRiverItems:[],
      sourceGroups:[],
      events:[],
      trajectories:[],
      works:[],
      intersectionStart,
      intersectionEnd,
      intersectionScopeIds,
      intersectionWindows
    };
  }

  // Public Scope time history uses the same published routing as Group Culture.
  // No guest query may depend on the unpublished api.manage schema.
  const publishedScope=(PUBLISHED_SITE_BOOTSTRAP.registry||[]).some(row=>
    row.scope_id===id&&row.scope_kind==='scope'&&row.active!==false);
  const scope=publishedScope?defaultScopeData(id):null;
  if(!scope)throw new Error('找不到 Scope 資料設定');
  const scopeContext=await selectCultureTimeRows(scope,scope.birthday);
  const parts=cultureParts(scopeContext,scope.id);
  const openRange=openPeriodRangeFromRows(scope.id,scopeContext);
  return {
    scopeId:id,
    scope,
    eras:{eras:parts.eras},
    periods:parts.periods,
    openRanges:openRange?[openRange]:[],
    scopeRanges:[],
    timelineItems:timelineItems(parts.normalizedContext),
    events:parts.events,
    trajectories:parts.trajectories,
    styleComments:parts.styleComments,
    works:[]
  };
}

export async function selectScopePeriodSourceSnapshot(scope,{startDate='',endDate=null,numericRows=null,periodRanges=null}={}){
  const scopeId=scopeIdOf(scope?.id);
  if(!scopeId)throw new Error('scopeId is required');
  // The database counts per day and category (undated rows included, day ''); category
  // totals and daily density are two projections of the same exact counts.
  const counted=Array.isArray(numericRows)
    ?{
      text:numericRows.filter(row=>row.kind==='source').map(row=>({day:row.day,category:row.category,item_count:row.item_count})),
      media:numericRows.filter(row=>row.kind==='media').map(row=>({day:row.day,category:row.category,item_count:row.item_count}))
    }
    :await selectScopeDailyCounts(scope,{startDate,endDate,includeUndated:true,requireAggregate:true});
  const windows=Array.isArray(periodRanges)&&periodRanges.length
    ?timeDateWindows(periodRanges,endDate||new Date().toISOString().slice(0,10)):null;
  const inside=row=>!windows||windows.some(window=>
    String(row.day||'')>=window.startDate&&String(row.day||'')<=window.endDate);
  const summarize=(rows,includeEmpty)=>{
    const catalog=new Map(),daily=[];
    for(const row of rows){
      if(!inside(row))continue;
      const category=String(row.category||'').trim();
      if(!includeEmpty&&!category)continue;
      catalog.set(category,(catalog.get(category)||0)+row.item_count);
      if(row.day)daily.push({day:row.day,category,item_count:row.item_count});
    }
    return {
      catalog:[...catalog].map(([term,item_count])=>({term,item_count}))
        .sort((a,b)=>b.item_count-a.item_count||a.term.localeCompare(b.term)),
      daily:daily.sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category))
    };
  };
  const text=summarize(counted.text,true);
  const media=summarize(counted.media,false);

  // A Scope owns its real site distribution. LOC's four summary
  // categories belong exclusively to buildLocSourceRiver, never this view.
  const groupMap=new Map();
  const groupFor=(label,kind)=>{
    const category=kind==='media'?'媒體 · '+(label||'未分類'):label||'未分類';
    if(!groupMap.has(category)){
      groupMap.set(category,{
        category_key:'source:'+category,
        category_type:kind,
        site:category,
        display_label:category,
        item_count:0,
        sites:[],
        media_types:[]
      });
    }
    return groupMap.get(category);
  };
  for(const row of text.catalog){
    const group=groupFor(row.term,'source');
    group.item_count+=Number(row.item_count)||0;
    group.sites.push(String(row.term||'').trim());
  }
  for(const row of media.catalog){
    const group=groupFor(row.term,'media');
    group.item_count+=Number(row.item_count)||0;
    group.media_types.push(String(row.term||'').trim());
  }

  const combined=new Map();
  for(const [kind,entries] of [['source',text.daily],['media',media.daily]]){
    for(const row of entries){
      const category=kind==='media'?'媒體 · '+(row.category||'未分類'):row.category||'未分類';
      const day=String(row.day||'').slice(0,10);
      if(!day)continue;
      const key=category+'\u0000'+day;
      combined.set(key,(combined.get(key)||0)+(Number(row.item_count)||0));
    }
  }

  const maxima=new Map(),firstDates=new Map(),lastDates=new Map();
  let globalMaximum=0;
  for(const [key,count] of combined){
    const split=key.lastIndexOf('\u0000');
    const category=key.slice(0,split);
    const day=key.slice(split+1);
    maxima.set(category,Math.max(maxima.get(category)||0,count));
    globalMaximum=Math.max(globalMaximum,count);
    const first=firstDates.get(category);
    const last=lastDates.get(category);
    if(!first||day<first)firstDates.set(category,day);
    if(!last||day>last)lastDates.set(category,day);
  }

  const groups=[...groupMap.values()].map(group=>({
    ...group,
    first_date:firstDates.get(group.site)||null,
    last_date:lastDates.get(group.site)||null,
    sites:[...new Set(group.sites)],
    media_types:[...new Set(group.media_types)]
  })).filter(group=>group.item_count>0&&group.first_date&&group.last_date)
    .sort((a,b)=>b.item_count-a.item_count||a.site.localeCompare(b.site));

  const buckets=[...combined.entries()].map(([key,count])=>{
    const split=key.lastIndexOf('\u0000');
    const source=key.slice(0,split);
    const day=key.slice(split+1);
    const group=groupMap.get(source);
    // Date bounds belong to the aggregated daily buckets, not the original
    // catalog group. Reading group.first_date here discarded every bucket.
    const firstDate=firstDates.get(source);
    const lastDate=lastDates.get(source);
    if(!group||!firstDate||!lastDate)return null;
    return {
      id:'site:'+source+':'+day,
      category:source,
      group_label:source+' · '+group.item_count.toLocaleString()+' 項 · '+firstDate+' → '+lastDate,
      start_date:day,
      item_count:count,
      works:[],
      first_date:firstDate,
      last_date:lastDate,
      density_ratio:count/Math.max(1,maxima.get(source)||1),
      global_density_ratio:count/Math.max(1,globalMaximum),
      display_label:source+' '+count+' 項',
      title:day+' · '+source+' · '+count+' 項',
      scope_id:scopeId,
      entry_type:'source',
      classification_dimension:'source',
      classification_level:'source'
    };
  }).filter(Boolean).sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))
    ||a.category.localeCompare(b.category));

  // A dated source catalog must produce dated river buckets. Surface
  // projection regressions instead of misreporting existing works as zero.
  if(groups.length>0&&buckets.length===0){
    throw new Error('作品來源統計已載入，但時間河道資料轉換失敗。');
  }
  return {groups,buckets,totalCount:groups.reduce((sum,row)=>sum+Number(row.item_count||0),0)};
}

function mediaMetadataDescription(row){
  const fields=[['標題',row.title],['類型',row.type],['內容',row.description]];
  return fields.map(([label,value])=>{const text=CultureTimelineModel.decodeCultureText(value||'').trim();return text?`${label}：${text}`:'';}).filter(Boolean).join(' · ')||'沒有可讀的 metadata 文字';
}

// Culture article lists are requested only after the visitor explicitly opens
// "顯示文章列表". The time/density rivers never ask for Galaxy UIDs.
export async function selectCultureArticleListPage(scope,{
  startDate='',endDate='',site='',sites=[],offset=0,sortDirection='desc'
}={}){
  const scopeId=scopeIdOf(scope?.id);
  if(!scopeId)throw new Error('scopeId is required');
  const pageSize=100;
  const start=String(startDate||'').slice(0,10);
  const end=String(endDate||'').slice(0,10);
  if(!start||!end||start>end)return {rows:[],hasMore:false,nextCursor:null};
  const sourceNames=[...new Set((sites||[]).map(value=>String(value??'').trim()))];
  const selectedSources=sourceNames.length?sourceNames:site?[String(site).trim()]:[];
  const filters=[
    {column:'culture',operator:'eq',value:'true'},
    ...dateFilters(start,end,scopeId==='local'?'createtime':'date'),
    ...(selectedSources.length?[{column:'site',operator:'in',value:selectedSources}]:[])
  ];
  const pageOffset=Math.max(0,Math.floor(Number(offset)||0));
  const {rows=[]}=await selectRows(scope.galaxy,{
    columns:scopeId==='local'?'uid,title,createtime,site,able':'uid,date,title,list',
    filters,orders:[{column:'createtime',ascending:sortDirection==='asc'}],
    limit:pageSize,offset:pageOffset,maxLimit:pageSize
  });
  const normalized=rows.map(row=>{
    const hidden=scopeId==='local'?row.able?.list===false:row.list===false;
    return {
      key:'galaxy:'+row.uid,entry_id:String(row.uid||''),uid:String(row.uid||''),
      entry_type:'work',scope_id:scopeId,
      title:hidden?'本文已隱藏':String(row.title||''),
      date:hidden?'':String(row.date||row.createtime||'').slice(0,10),
      createtime:hidden?'':row.createtime,
      hidden,list:!hidden
    };
  });
  return {
    rows:normalized,hasMore:rows.length===pageSize,
    nextCursor:rows.length===pageSize?{offset:pageOffset+rows.length}:null
  };
}

export async function selectScopePeriodWorkIndex(scope,{startDate='',endDate=null,sourceName='',sourceNames=[],mediaTypes=[],limit=10,offset=0,cursor=null,sortDirection='asc',periodRanges=null,articlePermission='culture'}={}){
  // A named period may contain several DISJOINT ranges. Fetch each bounded
  // range independently and merge pages by date; the gaps are never queried
  // or counted as part of the period.
  if(Array.isArray(periodRanges)&&periodRanges.length){
    const windows=timeDateWindows(periodRanges,endDate||new Date().toISOString().slice(0,10));
    const common={sourceName,sourceNames,mediaTypes,limit,offset,sortDirection,articlePermission};
    if(!windows.length)return {rows:[],totalCount:0,hasMore:false,nextCursor:null};
    if(windows.length===1)return selectScopePeriodWorkIndex(scope,{
      ...common,...windows[0],cursor,periodRanges:null
    });
    const oldCursors=cursor?.intervalCursors||[];
    // Preserve one cursor per disjoint window, but bound simultaneous COUNT
    // and page queries when a saved era contains many independent periods.
    const pages=await mapBounded(windows,2,(window,i)=>
      selectScopePeriodWorkIndex(scope,{
        ...common,...window,cursor:oldCursors[i]||null,periodRanges:null
      }));
    const positions=pages.map(()=>0),out=[];
    const ascending=sortDirection!=='desc';
    const consumed=pages.map(()=>({galaxy:0,media:0}));
    const keys=new Set();
    const pageSize=Math.max(1,Math.floor(Number(limit)||10));
    while(out.length<pageSize){
      let chosen=-1;
      for(let i=0;i<pages.length;i++){
        const row=pages[i].rows[positions[i]];
        if(!row)continue;
        if(chosen<0){chosen=i;continue;}
        const left=String(row.createtime||'')+'|'+String(row.entry_id||'');
        const other=pages[chosen].rows[positions[chosen]];
        const right=String(other.createtime||'')+'|'+String(other.entry_id||'');
        if(ascending?left<right:left>right)chosen=i;
      }
      if(chosen<0)break;
      const row=pages[chosen].rows[positions[chosen]++];
      if(row.entry_type==='work')consumed[chosen].galaxy++;
      else consumed[chosen].media++;
      if(keys.has(row.key))continue;
      keys.add(row.key);out.push(row);
    }
    const next=pages.map((page,i)=>({
      galaxyOffset:Number(oldCursors[i]?.galaxyOffset||0)+consumed[i].galaxy,
      mediaOffset:Number(oldCursors[i]?.mediaOffset||0)+consumed[i].media,
      galaxyCount:Number(page.nextCursor?.galaxyCount||0),
      mediaCount:Number(page.nextCursor?.mediaCount||0)
    }));
    return {rows:out,
      totalCount:pages.reduce((sum,page)=>sum+Number(page.totalCount||0),0),
      hasMore:next.some(c=>c.galaxyOffset<c.galaxyCount||c.mediaOffset<c.mediaCount),
      nextCursor:{intervalCursors:next}};
  }
  const scopeId=scopeIdOf(scope?.id);
  if(!scopeId)throw new Error('scopeId is required');
  // Explicitly requested empty source names are valid (e.g. Statistics · Others).
  const rawSources=[...new Set((sourceNames||[]).map(value=>String(value??'').trim()))];
  const rawMedia=[...new Set((mediaTypes||[]).map(value=>String(value||'').trim()).filter(Boolean))];
  const pageSize=Math.max(1,Math.floor(Number(limit)||10));
  const ascending=sortDirection!=='desc';
  const baseOffset=Math.max(0,Math.floor(Number(offset)||0));
  const cursorGalaxyOffset=Number(cursor?.galaxyOffset);
  const cursorMediaOffset=Number(cursor?.mediaOffset);
  const galaxyOffset=Number.isFinite(cursorGalaxyOffset)
    ?Math.max(0,Math.floor(cursorGalaxyOffset))
    :baseOffset;
  const mediaOffset=Number.isFinite(cursorMediaOffset)
    ?Math.max(0,Math.floor(cursorMediaOffset))
    :baseOffset;

  // Statistics and Culture each use their own independent Galaxy permission.
  // Never substitute Culture eligibility for a Statistics article list.
  if(!['culture','statics'].includes(articlePermission))throw new Error('Invalid article list permission');
  const galaxyFilters=publicContentFilters([
    {column:articlePermission,operator:'eq',value:'true'},
    ...dateFilters(startDate,endDate,scope.id==='local'?'createtime':'date'),
    ...(rawSources.length?[{column:'site',operator:'in',value:rawSources}]:[])
  ]);
  const mediaFilters=[
    ...dateFilters(startDate,endDate),
    ...(rawMedia.length?[{column:'type',operator:'in',value:rawMedia}]:[])
  ];

  // A normal work list is a Galaxy article list, never a merged media feed.
  // Only an explicitly selected media type opens the separate media lane.
  const includeGalaxy=rawSources.length>0||rawMedia.length===0&&(!sourceName||rawSources.length>0);
  const includeMedia=rawMedia.length>0;
  // The first bounded page can return exact counts with its own SELECT.
  // Keep both totals in the cursor so subsequent pages never repeat COUNTs.
  const hasCursorCounts=Number.isSafeInteger(cursor?.galaxyCount)&&Number.isSafeInteger(cursor?.mediaCount);
  const [galaxyResult,mediaResult]=await Promise.all([
    includeGalaxy?selectRows(scope.galaxy,{
      columns:'uid,title,createtime',
      filters:galaxyFilters,
      orders:[...(scope.id==='local'?[]:[{column:'date',ascending}]),{column:'createtime',ascending}],
      limit:pageSize,
      offset:galaxyOffset,
      maxLimit:pageSize,
      count:hasCursorCounts?null:'exact'
    }):Promise.resolve({rows:[],count:0}),
    includeMedia?selectRows(scope.galaxyMedia,{
      columns:'uid,createtime',
      filters:mediaFilters,
      orders:[{column:'createtime',ascending}],
      limit:pageSize,
      offset:mediaOffset,
      maxLimit:pageSize,
      count:hasCursorCounts?null:'exact'
    }):Promise.resolve({rows:[],count:0})
  ]);
  // Fall back only if a provider does not return the requested exact count.
  const [galaxyCount,mediaCount]=await Promise.all([
    !includeGalaxy?0:hasCursorCounts?cursor.galaxyCount:
      (galaxyResult.count??selectCount(scope.galaxy,{idColumn:'uid',filters:galaxyFilters})),
    !includeMedia?0:hasCursorCounts?cursor.mediaCount:
      (mediaResult.count??selectCount(scope.galaxyMedia,{idColumn:'uid',filters:mediaFilters}))
  ]);

  const galaxyRows=(galaxyResult.rows||[]).map(row=>({
    key:'galaxy:'+row.uid,
    entry_type:'work',
    entry_id:String(row.uid||''),
    uid:String(row.uid||''),
    title:String(row.title||''),
    createtime:row.createtime
  })).filter(row=>row.entry_id);
  const mediaRows=(mediaResult.rows||[]).map(row=>({
    key:'media:'+row.uid,
    entry_type:'media_metadata',
    entry_id:String(row.uid||''),
    uid:String(row.uid||''),
    createtime:row.createtime
  })).filter(row=>row.entry_id);

  const rows=[];
  let galaxyIndex=0;
  let mediaIndex=0;
  while(rows.length<pageSize&&(galaxyIndex<galaxyRows.length||mediaIndex<mediaRows.length)){
    const galaxyRow=galaxyRows[galaxyIndex];
    const mediaRow=mediaRows[mediaIndex];
    const dateOrder=galaxyRow&&mediaRow
      ?String(galaxyRow.createtime||'').localeCompare(String(mediaRow.createtime||'')):0;
    const idOrder=galaxyRow&&mediaRow
      ?String(galaxyRow.entry_id).localeCompare(String(mediaRow.entry_id)):0;
    if(!mediaRow||(galaxyRow&&(ascending?dateOrder<0||dateOrder===0&&idOrder<=0
      :dateOrder>0||dateOrder===0&&idOrder>=0))){
      rows.push(galaxyRow);
      galaxyIndex+=1;
    }else{
      rows.push(mediaRow);
      mediaIndex+=1;
    }
  }

  return {
    rows,
    totalCount:Number(galaxyCount||0)+Number(mediaCount||0),
    nextCursor:{
      galaxyOffset:galaxyOffset+galaxyIndex,
      mediaOffset:mediaOffset+mediaIndex,
      galaxyCount:Number(galaxyCount)||0,
      mediaCount:Number(mediaCount)||0
    }
  };
}

export async function selectScopePeriodWorkDetails(scope,{items=[]}={}){
  const scopeId=scopeIdOf(scope?.id);
  if(!scopeId)throw new Error('scopeId is required');
  const source=Array.isArray(items)?items:[];
  if(!source.length)return {rows:[],hasMore:false};
  // The article rows already came from the time-filtered, bounded index page.
  // Do not SELECT those article UIDs again just to obtain the title.
  const mediaIds=[...new Set(source.filter(row=>row?.entry_type==='media_metadata')
    .map(row=>String(row?.uid||row?.entry_id||'').trim()).filter(Boolean))];
  const mediaResult=mediaIds.length?await selectRows(scope.galaxyMedia,{
    columns:'uid,type,title,url,createtime',
    filters:[{column:'uid',operator:'in',value:mediaIds}],
    limit:mediaIds.length
  }):{rows:[]};
  const galaxyById=new Map(source.filter(row=>row.entry_type==='work').map(row=>[String(row.uid),{
    key:'galaxy:'+row.uid,
    uid:row.uid,
    title:workDisplayText(row.title||'').trim(),
    description:'',
    createtime:row.createtime,
    start_date:row.createtime,
    date:row.createtime,
    display_date:CultureTimelineModel.formatCultureDateTime(row.createtime),
    entry_id:row.uid,
    entry_type:'work',
    scope_id:scopeId,
    links:[]
  }]));
  const mediaById=new Map((mediaResult.rows||[]).map(row=>{
    return [String(row.uid),{
    ...row,
    key:'media:'+row.uid,
    record_type:'galaxy_media',
    site:String(row.type||''),
    entry_id:row.uid,
    entry_type:'media_metadata',
    start_date:row.createtime,
    date:row.createtime,
    display_date:CultureTimelineModel.formatCultureDateTime(row.createtime),
    title:CultureTimelineModel.decodeCultureText(row.title||'').trim()||row.type||'多媒體',
    description:'',
    media_metadata_text:'',
    group_label:String(row.type||''),
    scope_id:scopeId,
    links:row.url&&/^https?:\/\//i.test(String(row.url))
      ?[{id:'media:'+String(row.uid),href:row.url,label:'媒體連結'}]
      :[]
  }];
  }));

  return {
    rows:source.map(row=>row.entry_type==='work'
      ?galaxyById.get(String(row.uid||row.entry_id))
      :mediaById.get(String(row.uid||row.entry_id))
    ).filter(Boolean)
  };
}
