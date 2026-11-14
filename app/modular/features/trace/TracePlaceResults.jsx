'use client';

import {useEffect,useMemo,useState} from 'react';
import useDefaultTimeUnit from '../../../loc/use-default-time-unit';
import {timeUnitBucket} from '../../../loc/default-time-unit.mjs';
import dynamic from 'next/dynamic';
import {useAsyncInfiniteResource,useAsyncResource} from '../../../../zenstack/client-queries';
import {selectRows} from '../../../loc/db-query.mjs';
import {traceArticleIdFilters,groupedTraceDays} from './trace-panel-filters.mjs';
import {nearestTracePlaceIds} from '../../../loc/loc-feature-preferences.mjs';
import {defaultScopeData} from '../../../loc/scope-data';
import {dbPublicClient} from '../../../loc/db-client.mjs';
import {traceArticleIds,traceArticleLabels} from './trace-article-ids.mjs';
import Article from '../../Article';
import {galaxyIdentityHref,galaxyRelationLinks,featureNavigationHref} from '../../feature-navigation';
import {selectGalaxyIdentity} from '../../../loc/galaxy-query';
import {ArticleSortSelect,IncrementalList,WorkFullText} from '../../ui';
import {galaxyReadColumnsFor} from '../../../../zenstack/galaxy-read-models.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../../zenstack/anchor-hierarchy.mjs';

const CultureTimeline=dynamic(()=>import('../../modules/culture-timeline/CultureTimeline'),{loading:()=> <p className="scope-status">正在開啟時間長河…</p>});
const StatisticsMultiChart=dynamic(()=>import('../../modules/statistics/StatisticsMultiChart'),{loading:()=> <p className="scope-status">正在開啟統計圖…</p>});
const PAGE_SIZE=100;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));

function TraceWork({row,scope,timeLabel=''}){
  const [opened,setOpened]=useState(false);
  const detail=useAsyncResource({
    queryKey:['trace-work-uid',scope?.id,row.uid],
    enabled:opened&&Boolean(scope?.galaxy&&row.uid),
    queryFn:()=>selectGalaxyIdentity(scope,row.uid),
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const article=opened?detail.data:null;
  return <Article uid={row.uid} title={row.title||'未命名文章'}
    articleHref={galaxyIdentityHref(scope?.id,row.uid)}
    detailReading={Boolean(article)}
    relationLinks={article?galaxyRelationLinks(scope?.id,article):[]}
    relatedMedia={article?.related_media||[]}
    relatedTime={article?.related_time||null}
    relatedSpace={article?.related_space||null}
    relatedStatistics={article?.related_statistics||null}
    articleScopeId={scope?.id||''}
    articleDate={article?.article_day||article?.date||''}
    articleCreateTime={article?.createtime||row.createtime||''}
    date={row.date||row.createtime||''}
    tracePlace={article?.trace_place||null}
    traceHref={article?.trace_place?featureNavigationHref(scope?.id,'trace',{place:article.trace_place.uid}):''}
    locationName={article?.location||''}
    links={article?.links||[]}
    editOnCardClick={false}>
    {timeLabel?<p className="scope-status">{timeLabel}</p>:null}
    <WorkFullText open={opened} loading={opened&&detail.isPending}
      error={detail.error?String(detail.error.message||detail.error):''}
      content={String(article?.content||'')} showToggle={false}/>
    <button type="button" className="loc-button" aria-expanded={opened}
      onClick={()=>setOpened(value=>!value)}>{opened?'收合文章':'閱讀文章'}</button>
  </Article>;
}

export default function TracePlaceResults({place=null,anchors=[],maps=[],scopeId='',period=null,
  tab='articles',sourceName='',mediaType='',dateRange=null,timeMode='none',defaultSort='desc',allPlacedArticles=false}){
  const [sort,setSort]=useState(defaultSort);
  useEffect(()=>setSort(defaultSort),[defaultSort]);
  const [chartType,setChartType]=useState('bar');
  const defaultTimeUnit=useDefaultTimeUnit();
  const viewUnit=defaultTimeUnit==='auto'?'month':defaultTimeUnit;
  const [showAllVisits,setShowAllVisits]=useState(false);
  const name=String(place?.title||'').trim();
  const isMap=place?.trace_type==='path'||place?.trace_type==='trace';
  const targetScope=String(place?.source_scope||scopeId||'').trim();
  const scope=useMemo(()=>defaultScopeData(targetScope),[targetScope]);
  const placeIds=useMemo(()=>traceArticleIds(place,[...anchors,...maps]),[place,anchors,maps]);
  const nearestPlaceIds=useMemo(()=>nearestTracePlaceIds(placeIds,anchors,place),[placeIds,anchors,place]);
  const placeLabels=useMemo(()=>traceArticleLabels(place,[...anchors,...maps]),[place,anchors,maps]);
  const placesKey=placeIds.join('|');
  const startDate=validDate(dateRange?.startDate)?dateRange.startDate
    :validDate(period?.start_date)?String(period.start_date).slice(0,10):'';
  const endDate=validDate(dateRange?.endDate)?dateRange.endDate
    :validDate(period?.end_date)?String(period.end_date).slice(0,10):'';
  const timeRecords=useAsyncResource({
    queryKey:['trace-saved-time-labels',targetScope,timeMode],
    enabled:timeMode!=='none'&&tab==='articles'&&Boolean(targetScope),
    queryFn:async()=>{
      const {selectScopeCultureData}=await import('../../../loc/culture-query');
      const data=await selectScopeCultureData(targetScope);
      return (data?.timelineItems||[]).filter(row=>row.entry_type===timeMode);
    },
    revalidateIfStale:false,revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const timeLabelForRow=row=>{
    if(timeMode==='none')return '';
    const day=String(row.date||row.createtime||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
    const matches=(timeRecords.data||[]).filter(record=>
      (Array.isArray(record.ranges)&&record.ranges.length?record.ranges:[record])
        .some(range=>{
          const first=String(range.start_date||record.start_date||'').slice(0,10);
          const last=String(range.end_date||record.end_date||first).slice(0,10);
          return first&&first<=day&&last>=day;
        }));
    return matches.length?(timeMode==='era'?'時代：':'期間：')+
      matches.map(row=>String(row.title||row.uid)).join('、'):'';
  };
  const sourceFilter=String(sourceName||'').trim();
  const selectedMediaType=String(mediaType||'').trim();
  const enabled=Boolean(name&&placeIds.length&&scope?.galaxy&&targetScope===scopeId);

  // One selected resource and one small page at a time. No eager Galaxy scan.
  const list=useAsyncInfiniteResource({
    queryKey:['trace-articles-v5',allPlacedArticles,targetScope,place?.uid||'',placesKey,startDate,endDate,sourceFilter,sort,
      nearestPlaceIds.join('|')],
    enabled:enabled&&tab==='articles'&&!selectedMediaType,
    initialPageParam:sort==='nearest'?{placeIndex:0,offset:0}:0,
    getNextPageParam:page=>page.hasMore?page.nextOffset:undefined,
    queryFn:async({pageParam})=>{
      // Nearest spans the complete selected place spool: exhaust one closest
      // place before paging the next, never sort only a loaded date page.
      const nearest=sort==='nearest'&&nearestPlaceIds.length>0;
      let placeIndex=nearest?Number(pageParam?.placeIndex)||0:0;
      let offset=nearest?Number(pageParam?.offset)||0:Number(pageParam)||0;
      while(true){
        const selectedIds=nearest?[nearestPlaceIds[placeIndex]]:placeIds;
        const filters=traceArticleIdFilters(selectedIds,{startDate,endDate,sourceName:sourceFilter,allPlacedArticles});
        const result=await selectRows(scope.galaxy,{
          columns:galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor').join(','),
          filters,orders:[{column:'date',ascending:sort==='asc'},{column:'createtime',ascending:sort==='asc'},
            {column:'uid',ascending:true}],
          limit:PAGE_SIZE,offset,count:offset===0?'exact':null
        });
        const rows=result.rows||[];
        const total=offset===0?Number(result.count??rows.length):null;
        const moreInPlace=rows.length===PAGE_SIZE&&(total==null||offset+rows.length<total);
        const nextOffset=nearest
          ?moreInPlace?{placeIndex,offset:offset+rows.length}
            :placeIndex+1<nearestPlaceIds.length?{placeIndex:placeIndex+1,offset:0}:null
          :offset+rows.length;
        // Skip empty nearby places within the same request: a zero-result page
        // is not evidence that the next distance-ranked place has no works.
        if(rows.length||!nearest||nextOffset===null)
          return {rows,total,hasMore:nearest?nextOffset!==null:moreInPlace,nextOffset};
        placeIndex=nextOffset.placeIndex;
        offset=0;
      }
    }
  });

  // Media filtering is an explicitly requested, bounded two-stage lookup:
  // one page of media UIDs by type, then one page of Galaxy article headers.
  // Crucially, NO article list SELECT projects media_link or article content.
  const mediaFiltered=useAsyncInfiniteResource({
    queryKey:['trace-media-filter-v3',targetScope,placesKey,startDate,endDate,
      sourceFilter,selectedMediaType,sort],
    enabled:enabled&&Boolean(selectedMediaType)&&Boolean(scope?.anchor),
    initialPageParam:{mediaOffset:0,articleOffset:0},
    getNextPageParam:page=>page.nextCursor||undefined,
    queryFn:async({pageParam})=>{
      const mediaOffset=Number(pageParam?.mediaOffset)||0;
      const articleOffset=Number(pageParam?.articleOffset)||0;
      const mediaLimit=80;
      const {rows:mediaPage}=await selectRows(scope.anchor,{
        columns:'uid',
        filters:[{column:'type',operator:'eq',value:selectedMediaType},
          {column:'type',operator:'in',value:ANCHOR_TYPE_GROUPS.media},
          {column:'invisible',operator:'eq',value:false}],
        orders:[{column:'type',ascending:true},{column:'uid',ascending:true}],
        limit:mediaLimit,maxLimit:mediaLimit,offset:mediaOffset
      });
      const mediaIds=mediaPage.map(row=>String(row.uid||'').trim()).filter(Boolean);
      if(!mediaIds.length)return {rows:[],nextCursor:null};
      const {rows}=await selectRows(scope.galaxy,{
        columns:galaxyReadColumnsFor('GalaxyList').join(','),
        filters:[
          ...traceArticleIdFilters(placeIds,{startDate,endDate,sourceName:sourceFilter,allPlacedArticles}),
          {column:'media_link',operator:'overlaps',value:mediaIds}
        ],
        orders:[{column:'date',ascending:sort==='asc'},{column:'createtime',ascending:sort==='asc'},
            {column:'uid',ascending:true}],
        limit:PAGE_SIZE,maxLimit:PAGE_SIZE,offset:articleOffset
      });
      const moreInMediaPage=rows.length===PAGE_SIZE;
      const nextCursor=moreInMediaPage
        ?{mediaOffset,articleOffset:articleOffset+rows.length}
        :(mediaPage.length===mediaLimit?{mediaOffset:mediaOffset+mediaLimit,articleOffset:0}:null);
      return {rows,nextCursor};
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const mediaRows=useMemo(()=>{
    const byUid=new Map();
    for(const page of mediaFiltered.data?.pages||[]){
      for(const row of page.rows||[])byUid.set(String(row.uid),row);
    }
    return [...byUid.values()];
  },[mediaFiltered.data]);

  // Place density is computed on indexed place_id inside Postgres.
  // Never fetch a Scope-wide Galaxy metadata list just to draw a chart.
  const needsSummary=enabled&&tab!=='articles';
  const numeric=useAsyncResource({
    queryKey:['trace-place-id-summary-v1',targetScope,placesKey,startDate,endDate,sourceFilter],
    enabled:needsSummary&&!selectedMediaType,
    queryFn:async()=>{
      const rows=[];
      // The stored procedure accepts at most 80 place IDs per query.
      // A large disconnected trace may have hundreds of unique spool points.
      for(let i=0;i<placeIds.length;i+=80){
        const {data,error}=await dbPublicClient.schema('silver').analytics({
          p_scope_id:targetScope,p_view:'trace_daily',
          p_start:startDate||null,p_end:endDate||null,
          p_options:{placeIds:placeIds.slice(i,i+80),source:sourceFilter||null}
        });
        if(error)throw error;
        if(!Array.isArray(data))throw new Error('Invalid Trace place_id density response');
        rows.push(...data);
      }
      return {rows};
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  // Keyword parsing shares Group.uid_lists with Culture and Statistics.
  // Only an opened place report queries the selected place_ids; it never
  // downloads every article's UID list or runs a fresh word classification.
  const keywordGroups=useAsyncResource({
    queryKey:['trace-keyword-groups',targetScope,placesKey,startDate,endDate,sourceFilter],
    enabled:needsSummary&&tab==='statistics'&&!selectedMediaType&&Boolean(scope?.keywords),
    queryFn:async()=>{
      const results=[];
      for(let i=0;i<placeIds.length;i+=80){
        const {data,error}=await dbPublicClient.schema('silver').analytics({
          p_scope_id:targetScope,p_view:'trace_keywords',
          p_start:startDate||null,p_end:endDate||null,
          p_options:{placeIds:placeIds.slice(i,i+80),source:sourceFilter||null}
        });
        if(error)throw error;
        if(!Array.isArray(data))throw new Error('Invalid Keywords Group summary');
        results.push(...data);
      }
      const combined=new Map();
      for(const group of results){
        const uid=String(group.group_uid||'');
        const current=combined.get(uid)||{uid,name:String(group.group_name||''),count:0};
        current.count+=Number(group.document_count)||0;
        combined.set(uid,current);
      }
      return [...combined.values()].filter(group=>group.count>0)
        .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const mediaSummary=useAsyncResource({
    queryKey:['trace-filtered-media-summary-v3',targetScope,mediaRows.map(row=>row.uid).join('|')],
    enabled:needsSummary&&Boolean(selectedMediaType)&&mediaRows.length>0,
    queryFn:async()=>{
      const entries=[];
      for(let offset=0;offset<mediaRows.length;offset+=80){
        const batch=mediaRows.slice(offset,offset+80).map(row=>String(row.uid));
        const {rows}=await selectRows(scope.galaxy,{
          columns:galaxyReadColumnsFor('GalaxyUidAnchor','GalaxyAttr').join(','),
          filters:[{column:'uid',operator:'in',value:batch}],
          limit:batch.length,maxLimit:batch.length
        });
        entries.push(...rows);
      }
      return {rows:groupedTraceDays(entries.filter(row=>row.trace===true),{key:'place_id'})};
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const summary=selectedMediaType
    ?mediaRows.length?mediaSummary:{data:{rows:[]},isPending:false,error:mediaFiltered.error}
    :numeric;
  const rows=useMemo(()=>{
    if(selectedMediaType)return mediaRows;
    return (list.data?.pages||[]).flatMap(p=>p.rows||[]);
  },[list.data,selectedMediaType,mediaRows]);
  const verified=useMemo(()=>{
    const wanted=new Set(placeIds),periods=new Map(),places=new Map();
    for(const row of summary.data?.rows||[]){
      if(!wanted.has(row.category)||!validDate(String(row.day||'')))continue;
      const count=Number(row.item_count)||0;
      const bucket=timeUnitBucket(row.day,viewUnit);
      if(!bucket)continue;
      const previous=periods.get(bucket.key);
      periods.set(bucket.key,{...bucket,count:(previous?.count||0)+count});
      const display=placeLabels.get(row.category)||row.category;
      places.set(display,(places.get(display)||0)+count);
    }
    return {periods:[...periods.values()].sort((a,b)=>a.key.localeCompare(b.key)),
      places:[...places].sort((a,b)=>b[1]-a[1]),
      total:[...places.values()].reduce((total,n)=>total+n,0)};
  },[summary.data,placesKey,placeLabels,viewUnit]);
  // Each spatial anchor has its own times[]; a multi-day route does not mean
  // each stop was visited continuously throughout that route.
  // Use saved times, never inferred timestamps from the route or article period.
  const visits=useMemo(()=>{
    const stops=isMap
      ?(place?.anchor_list||[]).flat(Infinity).map(uid=>anchors.find(a=>a.uid===uid&&a.source_scope===targetScope)).filter(Boolean)
      :(place?[place]:[]);
    return stops.flatMap((stop,stopIndex)=>(Array.isArray(stop.times)?stop.times:[])
      .flatMap((when,visitIndex)=>{
        const timestamp=Date.parse(String(when||''));
        if(!Number.isFinite(timestamp))return [];
        const exact=new Date(timestamp);
        return [{
          id:stop.uid+':'+stopIndex+':'+visitIndex,uid:stop.uid,
          title:String(stop.title||''),when:exact.toISOString(),
          label:exact.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',
            month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+'（臺灣時間）'
        }];
      }))
      .sort((a,b)=>a.when.localeCompare(b.when));
  },[isMap,place,anchors,targetScope]);
  const visibleVisits=useMemo(()=>visits.filter(visit=>{
    // The contents of the favorite frame share one date filter, including
    // independently recorded visit timestamps (which are not article dates).
    const day=new Date(Date.parse(visit.when)+8*3600000).toISOString().slice(0,10);
    return (!startDate||day>=startDate)&&(!endDate||day<=endDate);
  }),[visits,startDate,endDate]);
  const visitRiver=useMemo(()=>visibleVisits.map(visit=>({
    id:'trace-visit:'+visit.id,entry_id:'trace-visit:'+visit.id,
    entry_type:'spatial_visit',group_key:'trace-visits',group_label:'實際造訪時間',
    group_order:0,start_date:visit.when,
    title:visit.title+' · '+visit.label
  })),[visibleVisits]);
  const listTotal=selectedMediaType?(mediaFiltered.data?mediaRows.length:null):list.data?.pages?.[0]?.total;
  // Only client-side aggregation changes. Original article and visit dates stay exact.
  const riverRows=useMemo(()=>{
    const peak=Math.max(1,...verified.periods.map(row=>row.count));
    return verified.periods.map(({key,count,startDate,endExclusive})=>({
      id:'trace-density:'+viewUnit+':'+key,entry_id:'trace-density:'+viewUnit+':'+key,
      entry_type:'place_density',group_key:'trace-density',group_label:name,
      group_order:0,start_date:startDate,end_date:endExclusive,
      item_count:count,density_ratio:count/peak,
      title:key+' · '+count+' 篇有打卡地點的文章'
    }));
  },[verified.periods,name,viewUnit]);
  const riverItems=useMemo(()=>[...(sourceFilter||selectedMediaType?[]:visitRiver),...riverRows],
    [sourceFilter,selectedMediaType,visitRiver,riverRows]);
  const chartRows=useMemo(()=>verified.periods.map(row=>({
    period:row.key.replace('-', '/'),start_date:row.startDate,value:row.count
  })),[verified.periods]);
  const chartDistribution=useMemo(()=>verified.places.map(([placeName,count])=>({
    name:placeName,value:count
  })),[verified.places]);

  if(!name)return <section className="loc-card loc-trace-works" aria-label="地圖下方文章報表">
    <h2>文章列表／時間長河／統計圖</h2>
    <p className="scope-status">選擇一個空間定錨點、路線圖或痕跡圖，再選時期；報表在這裡展開，不會跳到搜尋。</p>
  </section>;
  const loading=tab==='articles'?(selectedMediaType?mediaFiltered.isPending:list.isPending):summary.isPending;
  const error=tab==='articles'?(selectedMediaType?mediaFiltered.error:list.error):summary.error;
  return <section className="loc-card loc-trace-works" aria-label="文章報表">
    <header className="loc-trace-works-title">
      <div><p className="loc-eyebrow">文章報表</p><h2>文章列表／時間長河／統計圖</h2></div>
      <span className="scope-status">{isMap?(place.trace_type==='trace'?'痕跡線段 '+place.anchor_list.length+' 段 · ':'路線 '+place.anchor_list.length+' 站 · '):''}
        {!enabled?'沒有可對應的打卡地點'
          :tab==='articles'?(listTotal==null?'按需載入中…':selectedMediaType?'已載入 '+listTotal+' 篇符合條件的文章':listTotal+' 篇文章')
          :(summary.data?verified.total+' 篇符合條件的打卡文章':'數值圖表')}
      </span>
    </header>
    {tab!=='articles'&&!sourceFilter&&!selectedMediaType?<div className="loc-trace-visit-times" aria-label="空間定錨點造訪時間">
      <p className="scope-status">
        {visibleVisits.length?'已保存 '+visibleVisits.length+' 次具體造訪時間；各站獨立記錄。'
          :'目前沒有可確認的造訪時刻；不會以整趟旅程起訖日期代替各站時間。'}
      </p>
      {visibleVisits.length?<p className="scope-status">時間統一換算為臺灣時區顯示；境外地點的當地時間，須另依原始時區或航班文件確認。</p>:null}
      {visibleVisits.length?<ol className="loc-trace-selection-order">
        {(showAllVisits?visibleVisits:visibleVisits.slice(0,12)).map(visit=><li key={visit.id}>
          <span>{visit.label} · {visit.title}</span>
        </li>)}
      </ol>:null}
      {visibleVisits.length>12?<button className="loc-button" type="button"
        onClick={()=>setShowAllVisits(value=>!value)}>
        {showAllVisits?'收合造訪時間':'顯示全部 '+visibleVisits.length+' 次造訪時間'}
      </button>:null}
    </div>:null}
    {tab==='articles'?<label className="scope-stat-controls">文章排列
      <select className="scope-select" value={sort} onChange={event=>setSort(event.target.value)}>
        <option value="desc">最新的優先</option>
        <option value="asc">最舊的優先</option>
        <option value="nearest">最近的優先（依選定地點距離）</option>
      </select>
    </label>:null}
    {sourceFilter||selectedMediaType?<p className="scope-status">篩選條件：{sourceFilter?'作品來源 '+sourceFilter:'全部來源'} · {selectedMediaType?'媒體 '+selectedMediaType:'全部媒體'}（三種模式一致）</p>:null}
    {!enabled?<p className="scope-status" role="status">此地點目前沒有可對應的文章紀錄，仍可繼續查看地圖。</p>:null}
    {loading?<p role="status" className="scope-status">正在按需讀取目前時間與地點的內容…</p>:null}
    {error?<p role="alert" className="scope-status scope-error">{String(error.message||error)}</p>:null}
    {tab==='articles'&&!loading&&!error&&!rows.length?<p className="scope-status">
      {selectedMediaType?'已查閱的文章頁面尚無此媒體類型；可繼續搜尋下一頁。':'目前沒有 place_id 屬於此 Spool 的文章；既有文章可在「整理空間定錨點」建立 place_id 對應。'}
    </p>:null}
    {tab==='articles'&&selectedMediaType&&!rows.length&&mediaFiltered.hasNextPage?
      <button type="button" className="loc-button" onClick={()=>mediaFiltered.fetchNextPage()}
        disabled={mediaFiltered.isFetchingNextPage}>繼續篩選下一頁</button>:null}
    {tab==='articles'&&rows.length?<IncrementalList
      items={rows}
      batchSize={PAGE_SIZE}
      resetKey={[targetScope,place?.uid,placesKey,startDate,endDate,sourceFilter,selectedMediaType,sort].join('|')}
      className="loc-trace-works-list loc-public-article-list"
      externalHasMore={selectedMediaType?Boolean(mediaFiltered.hasNextPage):Boolean(list.hasNextPage)}
      loading={selectedMediaType?Boolean(mediaFiltered.isFetchingNextPage):Boolean(list.isPending||list.isFetchingNextPage)}
      error={error}
      onLoadMore={selectedMediaType?()=>mediaFiltered.fetchNextPage():list.fetchNextPage}
      renderItem={row=><TraceWork key={targetScope+':'+row.uid} row={row} scope={scope}
        timeLabel={timeLabelForRow(row)}/>}
    />:null}
    {selectedMediaType&&mediaFiltered.hasNextPage&&tab!=='articles'?<p className="scope-status">
      媒體篩選的圖表只呈現已按需載入的頁面，並非整個區間的總量。
      <button type="button" className="loc-button" onClick={()=>mediaFiltered.fetchNextPage()}
        disabled={mediaFiltered.isFetchingNextPage}>繼續讀取下一頁</button>
    </p>:null}
    {tab==='timeline'&&(summary.data||(!sourceFilter&&!selectedMediaType&&visibleVisits.length>0))?<div className="loc-trace-works-timeline" aria-label="按真實造訪時間排列的時間長河">
      {riverItems.length?<CultureTimeline items={riverItems}
        extraGroups={[
          ...(!sourceFilter&&!selectedMediaType&&visitRiver.length?[{id:'trace-visits',label:'實際造訪時間',order:0,selectable:false}]:[]),
          ...(riverRows.length?[{id:'trace-density',label:'文章月份密度',order:1,selectable:false}]:[])
        ]}
        labelOf={()=>''} mode="source" heightVariant="double"
        windowStart={!sourceFilter&&!selectedMediaType&&visitRiver.length?'':startDate} windowEnd={!sourceFilter&&!selectedMediaType&&visitRiver.length?'':endDate}
      />:<p className="scope-status">目前沒有可顯示的時間資料。</p>}
      <p className="scope-status">造訪點只採用每個空間錨點 times[] 中的原始時間；文章密度是獨立河道，不推定造訪或停留。</p>
    </div>:null}
    {tab==='statistics'&&!selectedMediaType&&keywordGroups.isPending?
      <p className="scope-status">正在讀取這些地點的關鍵詞分組統計…</p>:null}
    {tab==='statistics'&&!selectedMediaType&&keywordGroups.error?
      <p role="alert" className="scope-status scope-error">關鍵詞分組載入失敗：{String(keywordGroups.error?.message||keywordGroups.error)}</p>:null}
    {tab==='statistics'&&!selectedMediaType&&keywordGroups.data?.length?
      <section className="scope-card" aria-label="關鍵詞群組分佈">
        <h3>關鍵詞群組 · 文章歸屬</h3>
        <p className="scope-status">依目前 Class 的 Group UID 歸屬計算；同篇文章僅歸屬一個 Group。</p>
        <ul>{keywordGroups.data.map(group=><li key={group.uid}>
          {group.name}：{group.count.toLocaleString()} 篇
        </li>)}</ul>
      </section>:null}
    {tab==='statistics'&&summary.data?<div className="loc-trace-works-stat" aria-label="地點與文章統計圖">
      {verified.total?<><label>圖表
        <select className="scope-select" value={chartType}
          onChange={event=>setChartType(event.target.value)}>
          <option value="bar">長條圖</option>
          <option value="line">折線圖</option>
          <option value="pie">圓餅圖</option>
        </select>
      </label>
      <StatisticsMultiChart type={chartType} rows={chartRows}
        series={[{key:'value',label:'文章篇數'}]}
        distribution={chartDistribution.length>1?chartDistribution:verified.periods.map(row=>({name:row.key,value:row.count}))}
        height={400}/></>:<p className="scope-status">這個時期沒有已確認的打卡紀錄。</p>}
    </div>:null}
  </section>;
}
