'use client';
import FieldText from '../../../i18n/FieldText';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import {registerDefaultSection} from '../../../i18n/ui-copy';
import selfIntersectionZh from '../../../i18n/sections/uiExtra.selfIntersection.zh_tw.js';
registerDefaultSection('uiExtra.selfIntersection',selfIntersectionZh);

import {useMemo,useState} from 'react';
import {useAsyncResource} from '../../../loc/use-async-resource';
import {selectScopeSourceBreakdownRows} from '../../../loc/galaxy-query';
import {assignedSource} from '../../../loc/member-intersection-model.mjs';
import {semanticStatisticChartTypes,chartTypeGroups} from './statistics-time-zoom.mjs';
import StatisticsMultiChart from './StatisticsMultiChart';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';
import {ownScopeCategoryCatalog} from '../../../loc/statistics-source-intersection.mjs';
import {comparisonMetricGroups,selectedComparisonMetricGroup,firstAvailableGroupMetric} from './statistics-compare-options.mjs';

const DAY_MS=86400000;
// One dimension tab per comparison lane. Keyword tab appears only if stored
// statistics contain actual keyword hits in the selected date range.
export const DIMENSION_FILTERS=Object.freeze([
  {value:'all',label:'全部'},
  {value:'source',label:'作品來源'},
  {value:'media',label:'多媒體'},
  {value:'keyword',label:'關鍵詞'}
]);
export const DIMENSIONS=Object.freeze([
  {kind:'source',label:'原始作品來源'},
  {kind:'source_rollup',label:'作品／個人分類'},
  {kind:'group',label:'作品分類'},
  {kind:'others_subgroup',label:'個人分類'},
  {kind:'media_category',label:'音樂／圖片／影片'},
  {kind:'media',label:'多媒體來源'},
  {kind:'keyword_all',label:'全部關鍵詞'},
  {kind:'keyword_group',label:'關鍵詞群組'},
  {kind:'keyword_group_items',label:'群組內關鍵詞'},
  {kind:'keyword_item',label:'關鍵詞項目'}
]);
export const LANE_FAMILIES=Object.freeze([
  {id:'source',label:'作品來源',kinds:['source_rollup','source','group','others_subgroup']},
  {id:'media',label:'多媒體',kinds:['media_category','media']},
  {id:'keyword',label:'關鍵詞',kinds:['keyword_all','keyword_group','keyword_group_items','keyword_item']}
]);
const dimensionForKind=kind=>LANE_FAMILIES.find(item=>item.kinds.includes(kind))?.id||'source';
const metricId=(kind,value)=>kind+String.fromCharCode(0)+value;
export function mediaTypeFamily(raw){
  const value=String(raw||'').trim().toLowerCase();
  if(/(?:music|audio|sound|song|suno|mp3|wav|m4a|flac|音樂|歌曲|聲音)/.test(value))return 'music';
  if(/(?:image|photo|picture|pic|jpg|jpeg|png|webp|gif|圖片|相片|照片|影像)/.test(value))return 'image';
  if(/(?:video|movie|film|reel|youtube|mp4|影片|視頻|影視)/.test(value))return 'video';
  return '';
}
const MEDIA_GROUP_NAMES={music:'音樂',image:'圖片',video:'影片'};
const dateOnly=v=>String(v||'').slice(0,10);
function canonicalBucket(day,unit){
  const date=new Date(day+'T00:00:00Z');
  if(Number.isNaN(date.getTime()))return null;
  if(unit==='year'){
    const year=date.getUTCFullYear();
    return {key:String(year),from:year+'-01-01',to:year+'-12-31'};
  }
  if(unit==='month'){
    const a=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
    const b=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0));
    return {key:a.toISOString().slice(0,7),from:a.toISOString().slice(0,10),to:b.toISOString().slice(0,10)};
  }
  if(unit==='week'){
    const start=new Date(date);
    start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    return {key:start.toISOString().slice(0,10),from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
  }
  return {key:day,from:day,to:day};
}
export default function ScopeSelfIntersection({scope,range,classUid='',zoomLevel=0,onZoomLevelChange,sharedCatalog=null}){
  useUiSection('uiExtra.selfIntersection');
  useUiSection('uiExtra.statisticsView');
  const {locale,copy}=useUiLocale();
  const t=useUiText();
  const l=copy.uiExtra.selfIntersection;
  const [numberOfLanes,setNumberOfLanes]=useState(2);
  const [selected,setSelected]=useState([]);
  const [laneKinds,setLaneKinds]=useState([]);
  const [chartType,setChartType]=useState('line');
  const [foldBlank,setFoldBlank]=useState(true);
  const start=dateOnly(range?.startDate),end=dateOnly(range?.endDate);
  const valid=Boolean(scope?.id&&scope.galaxy&&scope.anchor&&start&&end&&start<=end);
  const query=useAsyncResource(valid?['own-scope-source-intersection',scope?.id,start,end]:null,
    ()=>selectScopeSourceBreakdownRows(scope,{startDate:start,endDate:end}));
  const rows=query.data||[];
  const localCatalog=useAsyncResource(valid&&!sharedCatalog?['own-scope-source-catalog',scope?.id]:null,async()=>{
    const {readPublicSourceTaxonomy}=await import('../../../loc/source-catalog-public.mjs');
    return readPublicSourceTaxonomy();
  });
  const catalog=sharedCatalog||localCatalog;
  const othersConfig=useAsyncResource({
    queryKey:['scope-others-source-summary',scope?.id],
    enabled:valid,
    queryFn:async()=>{
      const {publishedSourceTaxonomy}=await import('../../published-source-taxonomy.js');
      const published=publishedSourceTaxonomy(scope.id);
      if(published)return {groups:published.groups||[],aliases:published.groupAliases||[]};
      const {readPublicSourceTaxonomy}=await import('../../../loc/source-catalog-public.mjs');
      const list=await readPublicSourceTaxonomy(scope.id);
      return {groups:list.groups||[],aliases:list.groupAliases||[]};
    }
  });
  const othersActive=useMemo(()=>new Map((othersConfig.data?.groups||[])
    .filter(row=>row.enabled!==false).map(row=>[row.group_code,row.display_name])),[othersConfig.data]);
  const othersAliases=useMemo(()=>new Map((othersConfig.data?.aliases||[])
    .map(row=>[String(row.source_key||'').trim().toLowerCase(),row.group_code])),[othersConfig.data]);
  const resolveOthers=(source)=>{
    const group=othersAliases.get(String(source||'').trim().toLowerCase())||'';
    if(group&&othersActive.has(group))return group;
    return assignedSource(source,catalog.data?.aliases||[],catalog.data?.categories||[])==='unclassified'
      ?'unclassified':'';
  };
  // Read the already-stored keyword summary only when this panel is expanded.
  const keywords=useAsyncResource({
    queryKey:['own-scope-keyword-summary',scope?.id,classUid,start,end],
    enabled:valid,
    queryFn:async()=>{
      const {selectKeywordAnalysisSummary}=await import('../../../loc/keyword-analysis');
      return selectKeywordAnalysisSummary({scopeId:scope.id,classUid,startDate:start,endDate:end});
    }
  });
  const keywordTabAvailable=Boolean(keywords.data?.statisticsEnabled&&
    (keywords.data?.runeTotals||[]).some(item=>Number(item.document_count)>0));
  const availableKinds=useMemo(()=>{
    const kinds=[
      ...(rows.some(row=>row.kind==='source'&&Number(row.item_count)>0)?['source']:[]),
      ...(rows.some(row=>row.kind==='media'&&Number(row.item_count)>0)?['media']:[]),
      ...(keywordTabAvailable?['keyword']:[])
    ];
    return kinds.length?[...kinds,'all']:[];
  },[rows,keywordTabAvailable]);
  const maximumLanes=Math.min(8,Math.max(0,
    rows.filter(row=>Number(row.item_count)>0).length+
    (keywords.data?.runeTotals||[]).filter(row=>Number(row.document_count)>0).length));
  const lanes=Math.min(numberOfLanes,Math.max(2,maximumLanes));
  const shownKinds=Array.from({length:lanes},(_,index)=>
    availableKinds.includes(laneKinds[index])?laneKinds[index]:
    availableKinds[index%Math.max(1,availableKinds.length)]||'source');
  const keywordModeActive=keywordTabAvailable&&shownKinds.some(kind=>kind==='keyword'||kind==='all');
  // Resolve Class -> group -> item from the current Scope's *real* keyword
  // catalog. Stored aggregate metadata has item labels but no group mapping.
  const keywordCatalog=useAsyncResource({
    queryKey:['scope-advanced-keyword-catalog',scope?.id,keywords.data?.keywordMeta?.class_uid],
    enabled:valid&&keywordModeActive&&Boolean(scope?.keywords&&keywords.data?.keywordMeta?.class_uid),
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keyword-service-client.mjs');
      const {keywordTreeCatalog}=await import('../../../loc/keyword-tree-report.mjs');
      const result=await keywordService('catalog',{
        scopeId:scope.id,classUid:keywords.data.keywordMeta.class_uid});
      if(!result.class_uid)return [];
      return keywordTreeCatalog(result.rows,result.class_uid).groups.flatMap(group=>
        group.items.map(item=>({uid:item.uid,group_uid:group.uid,class_group:group.name})));
    }
  });
  const keywordItemGroup=useMemo(()=>new Map((keywordCatalog.data||[])
    .filter(item=>item.class_enable!==false&&String(item.group_uid||''))
    .map(item=>[String(item.uid),String(item.group_uid)])),
  [keywordCatalog.data]);
  const categoryList=useMemo(()=>{
    const known=catalog.data?.categories||[],aliases=catalog.data?.aliases||[];
    const basic=ownScopeCategoryCatalog(rows);
    const grouped=new Map();
    for(const row of rows){
      if(row.kind!=='source')continue;
      const id=assignedSource(row.category,aliases,known);
      if(id==='unclassified'||othersActive.has(id))continue;
      grouped.set(id,(grouped.get(id)||0)+(Number(row.item_count)||0));
    }
    const groups=[...grouped].filter(([,total])=>total>0).map(([id,total])=>({
      id:metricId('group',id),kind:'group',name:known.find(x=>x.category_code===id)?.display_name||id,total
    }));
    const analysis=keywords.data?.statisticsEnabled?keywords.data:null;
    const keywordGroups=(analysis?.groupTotals||[])
      .filter(row=>Number(row.document_count||0)>0)
      .map(row=>({id:metricId('keyword_group',row.group_uid),uid:String(row.group_uid),kind:'keyword_group',
        group:String(row.group||'').trim(),name:String(row.group||'').trim(),total:Number(row.document_count)||0}));
    const keywordItems=(analysis?.runeTotals||[])
      .filter(row=>Number(row.document_count||0)>0)
      .map(row=>({id:metricId('keyword_item',row.uid),kind:'keyword_item',
        group_uid:keywordItemGroup.get(String(row.uid))||'',
        name:String(row.label||row.uid),total:Number(row.document_count)||0}));
    const keywordGroupsItems=keywordGroups.filter(group=>
      keywordItems.some(item=>item.group_uid===group.uid))
      .map(group=>({id:metricId('keyword_group_items',group.uid),
        kind:'keyword_group_items',group_uid:group.uid,name:'群組內關鍵詞',total:0}));
    const keywordAll=keywordTabAvailable?[{
      id:metricId('keyword_all','all'),kind:'keyword_all',
      name:'全部關鍵詞',total:0
    }]:[];
    const othersCounts=new Map();
    for(const row of rows){
      if(row.kind!=='source')continue;
      const group=resolveOthers(row.category);
      if(group)othersCounts.set(group,(othersCounts.get(group)||0)+(Number(row.item_count)||0));
    }
    const others=[...othersCounts].filter(([,count])=>count>0).map(([id,total])=>({
      id:metricId('others_subgroup',id),kind:'others_subgroup',
      name:id==='unclassified'?'未分類':othersActive.get(id)||id,total
    }));
    let systemTotal=0,personalTotal=0;
    for(const row of rows){
      if(row.kind!=='source')continue;
      const amount=Number(row.item_count)||0;
      const personal=resolveOthers(row.category);
      if(personal&&personal!=='unclassified')personalTotal+=amount;
      else if(!personal&&assignedSource(row.category,aliases,known)!=='unclassified')systemTotal+=amount;
    }
    const rollups=[
      {id:metricId('source_rollup','system'),kind:'source_rollup',
        name:'作品分類',total:systemTotal},
      {id:metricId('source_rollup','personal'),kind:'source_rollup',
        name:'個人分類',total:personalTotal}
    ].filter(item=>item.total>0);
    const mediaTotals=new Map();
    for(const row of rows){
      if(row.kind!=='media')continue;
      const family=mediaTypeFamily(row.category)||'other';
      mediaTotals.set(family,(mediaTotals.get(family)||0)+(Number(row.item_count)||0));
    }
    const mediaGroups=[...mediaTotals].filter(([,total])=>total>0)
      .map(([id,total])=>({id:metricId('media_category',id),
        kind:'media_category',name:MEDIA_GROUP_NAMES[id]||'其他媒體',family:id,total}));
    return [...rollups,...groups,...basic,...others,...mediaGroups,
      ...keywordAll,...keywordGroups,...keywordGroupsItems,...keywordItems];
  },[rows,catalog.data,keywords.data,othersConfig.data,keywordItemGroup,keywordTabAvailable]);
  const candidatesForLane=index=>categoryList.filter(item=>
    (shownKinds[index]==='all'||dimensionForKind(item.kind)===shownKinds[index])&&
    !['group','others_subgroup','total'].includes(item.kind));
  const chosen=Array.from({length:lanes},(_,index)=>{
    const candidates=candidatesForLane(index);
    const id=selected[index];
    if(id&&candidates.some(item=>item.id===id)&&!selected.slice(0,index).includes(id))return id;
    const reserved=new Set(selected.filter((_,position)=>position!==index));
    return candidates.find(item=>!reserved.has(item.id))?.id||'';
  });
  const used=new Set();
  const selection=chosen.map((id,index)=>{
    const options=candidatesForLane(index);
    const output=id&&!used.has(id)?id:options.find(item=>!used.has(item.id))?.id||'';
    if(output)used.add(output);
    return output;
  });
  const categories=selection.map(id=>categoryList.find(c=>c.id===id)).filter(Boolean);
  const selectedKeywordItems=categories.some(item=>['keyword_all','keyword_group_items','keyword_item'].includes(item.kind));
  // Item-by-day data are not in the summary RPC. Load saved attributes only
  // when an item is actually selected, without reading or analyzing article bodies.
  const keywordItems=useAsyncResource({
    queryKey:['own-scope-keyword-item-days',scope?.id,classUid,start,end],
    enabled:valid&&keywordModeActive&&selectedKeywordItems,
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keyword-service-client.mjs');
      return keywordService('summary',{scopeId:scope.id,
        classUid:keywords.data?.keywordMeta?.class_uid||classUid,
        startDate:start,endDate:end});
    }
  });
  const unit=['year','month','week','day'].includes(range?.bucket)?range.bucket:(Date.parse(end)-Date.parse(start))/DAY_MS>180?'month':(Date.parse(end)-Date.parse(start))/DAY_MS>60?'week':'day';
  const calculated=useMemo(()=>{
    if(!valid||!categories.length)return {chart:[],days:[],totals:[]};
    const counts=new Map(), activeDays=new Map();
    const selectedIds=new Set(categories.map(category=>category.id));
    const add=(day,id,value)=>{
      if(!selectedIds.has(id)||!day||day<start||day>end||value<=0)return;
      const bucket=canonicalBucket(day,unit);
      if(!bucket)return;
      const item=counts.get(bucket.key)||{period:bucket.key,start_date:bucket.from,end_date:bucket.to};
      item[id]=(Number(item[id])||0)+value;
      counts.set(bucket.key,item);
      const active=activeDays.get(day)||new Set();
      active.add(id);
      activeDays.set(day,active);
    };
    for(const row of rows){
      const day=dateOnly(row.day);
      const rawId=String(row.kind)+'\u0000'+String(row.category||'');
      const ids=[rawId];
      if(row.kind==='source'){
        const assigned=assignedSource(row.category,catalog.data?.aliases||[],catalog.data?.categories||[]);
        const personal=resolveOthers(row.category);
        if(personal&&personal!=='unclassified'){
          ids.push('others_subgroup'+String.fromCharCode(0)+personal);
          ids.push('source_rollup'+String.fromCharCode(0)+'personal');
        }else if(!personal&&assigned!=='unclassified'){
          ids.push('group\u0000'+assigned);
          ids.push('source_rollup'+String.fromCharCode(0)+'system');
        }else if(personal==='unclassified'){
          ids.push('others_subgroup'+String.fromCharCode(0)+'unclassified');
        }
      }else if(row.kind==='media'){
        const family=mediaTypeFamily(row.category)||'other';
        ids.push('media_category'+String.fromCharCode(0)+family);
      }
      for(const id of ids)add(day,id,Number(row.item_count)||0);
    }
    // One Class per article. The existing summary already aggregates by day.
    for(const row of keywords.data?.classifications||[]){
      add(dateOnly(row.date),'keyword_group'+String.fromCharCode(0)+row.group_uid,Number(row.count)||0);
    }
    if(selectedKeywordItems){
      for(const row of keywordItems.data||[]){
        const day=dateOnly(row.day);
        const count=Number(row.document_count)||0;
        if(row.kind==='keyword_all_day')
          add(day,metricId('keyword_all','all'),count);
        else if(row.kind==='item_day')
          add(day,metricId('keyword_item',String(row.item_key)),count);
        else if(row.kind==='group_items_day')
          add(day,metricId('keyword_group_items',String(row.group_uid)),count);
      }
    }
    const chart=[];
    for(let date=new Date(start+'T00:00:00Z'),limit=new Date(end+'T00:00:00Z');date<=limit;){
      const day=date.toISOString().slice(0,10);
      const bucket=canonicalBucket(day,unit);
      const previous=chart.at(-1);
      if(previous?.period!==bucket.key)chart.push({
        period:bucket.key,start_date:bucket.from,end_date:bucket.to,
        ...Object.fromEntries(categories.map(category=>[category.id,Number(counts.get(bucket.key)?.[category.id])||0]))
      });
      date=new Date(bucket.to+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
    }
    return {
      chart,
      days:[...activeDays.values()].filter(day=>categories.every(category=>day.has(category.id))).length,
      totals:categories.map(category=>({
        name:category.name,
        value:chart.reduce((n,bucket)=>n+Number(bucket[category.id]||0),0)
      }))
    };
  },[rows,categories.map(c=>c.id).join(String.fromCharCode(0)),start,end,unit,valid,catalog.data,othersConfig.data,keywords.data,keywordItems.data,selectedKeywordItems,keywordItemGroup]);
  const series=categories.map(c=>({key:c.id,label:c.name}));
  const enough=maximumLanes>=2&&categories.length===lanes;
  const availableCharts=semanticStatisticChartTypes({purpose:'comparison',rows:calculated.chart,series,distribution:calculated.totals});
  const shownChartType=availableCharts.some(([id])=>id===chartType)?chartType:(availableCharts[0]?.[0]||'line');
  const chartGroups=chartTypeGroups(availableCharts,['line','stacked','scatter']);

  return <section className="scope-stat-section scope-self-intersection" aria-label={t('uiExtra.statisticsView.selfIntersectionTitle')}>
    <h3><UiText id="uiExtra.statisticsView.selfIntersectionTitle"/></h3>
      {query.isPending||keywords.isPending||othersConfig.isPending?<p className="scope-status">{l.readingSources}</p>:null}
      {query.error||catalog.error?<p className="scope-status scope-error">{String(query.error?.message||catalog.error?.message||l.readFailed)}</p>:null}
      {keywords.error?<p className="scope-status scope-error">關鍵詞分佈載入失敗：{String(keywords.error?.message||keywords.error)}</p>:null}
      {othersConfig.error?<p className="scope-status scope-error">{t('uiExtra.statisticsView.othersLoadFailed',{error:String(othersConfig.error?.message||othersConfig.error)})}</p>:null}
      {!query.isPending&&!catalog.isPending&&!query.error&&!catalog.error?<div className="scope-self-intersection-content">
        <div className="scope-stat-controls">
          <label><span><FieldText text="比較組數"/></span>
            <select className="scope-select" value={lanes} onChange={e=>{setNumberOfLanes(Number(e.target.value));setSelected([])}}>
              {Array.from({length:Math.max(0,maximumLanes-1)},(_,i)=>i+2).map(n=><option key={n} value={n}>{n}{l.groupUnit}</option>)}
              {maximumLanes<2?<option value={2}>可比較項目不足</option>:null}
            </select>
          </label>
        </div>
        <div className="scope-self-intersection-comparisons">
          {Array.from({length:lanes},(_,index)=>{
            const kind=shownKinds[index];
            const chosenId=selection[index]||'';
            const selectMetric=id=>setSelected(previous=>{
              const next=[...selection];next[index]=id;return next;
            });
            const switchKind=nextKind=>{
              setLaneKinds(previous=>{
                const next=[...shownKinds];next[index]=nextKind;return next;
              });
              setSelected(previous=>{
                const next=[...selection];next[index]='';return next;
              });
            };
            const sourceItems=categoryList.filter(item=>item.kind==='source');
            const systems=sourceItems.filter(item=>
              !resolveOthers(item.raw)&&assignedSource(item.raw,catalog.data?.aliases||[],catalog.data?.categories||[])!=='unclassified');
            const personals=sourceItems.filter(item=>resolveOthers(item.raw)&&resolveOthers(item.raw)!=='unclassified');
            const unclassified=sourceItems.filter(item=>resolveOthers(item.raw)==='unclassified');
            const sourceGroups=[
              {name:l.systemCategory,item:categoryList.find(c=>c.id===metricId('source_rollup','system')),items:systems},
              {name:l.personalCategory,item:categoryList.find(c=>c.id===metricId('source_rollup','personal')),items:personals},
              {name:l.uncategorized,item:null,items:unclassified}
            ].filter(group=>group.item||group.items.length);
            const mediaGroups=categoryList.filter(item=>item.kind==='media_category')
              .sort((a,b)=>['music','image','video','other'].indexOf(a.family)-['music','image','video','other'].indexOf(b.family))
              .map(group=>({name:group.family==='music'?l.music:group.family==='image'?l.image:group.family==='video'?l.video:l.otherMedia,item:group,items:categoryList.filter(item=>
                item.kind==='media'&&(mediaTypeFamily(item.raw)||'other')===group.family)}));
            const groupTabs=categoryList.filter(item=>item.kind==='keyword_group')
              .map(group=>({name:group.name,item:group,
                items:categoryList.filter(item=>
                  (item.kind==='keyword_group_items'||item.kind==='keyword_item')&&item.group_uid===group.uid)}));
            const allKeywords=categoryList.find(item=>item.kind==='keyword_all');
            const groups=comparisonMetricGroups(kind,{
              source:sourceGroups,
              media:mediaGroups,
              keyword:[
                ...(allKeywords?[{name:l.allKeywords,item:allKeywords,items:[]}]:[]),
                ...groupTabs
              ]
            });
            const currentGroup=selectedComparisonMetricGroup(groups,chosenId);
            const selectedGroupMetrics=currentGroup?.options||[];
            const takenByOther=new Set(selection.filter((_,lane)=>lane!==index));
            return <section className="scope-self-intersection-lane" key={index}
              aria-label={l.comparisonItem+' '+(index+1)}>
              <strong>{l.comparisonItem} {index+1}</strong>
              <div className="scope-self-intersection-kind-tabs" role="group"
                aria-label={l.comparisonItem+' '+(index+1)+' 類型'}>
                {DIMENSION_FILTERS.filter(tab=>tab.value==='all'?availableKinds.length>0:availableKinds.includes(tab.value)).map(tab=>
                  <button type="button" className="scope-self-stat-tab" key={tab.value}
                    aria-pressed={kind===tab.value} onClick={()=>switchKind(tab.value)}>
                    {tab.value==='all'?'全部':tab.value==='source'?l.sourceTab:tab.value==='media'?l.mediaTab:l.keywordTab}
                  </button>)}
              </div>
              <div className="scope-self-intersection-category-groups">
                <label className="scope-self-stat-picker"><span>類別</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 類別'}
                    value={currentGroup?.key||''}
                    onChange={event=>{
                      const target=groups.find(group=>group.key===event.target.value);
                      const id=firstAvailableGroupMetric(target,takenByOther);
                      if(id)selectMetric(id);
                    }}>
                    {!groups.length?<option value="">無可用類別</option>:null}
                    {groups.map(group=><option key={group.key} value={group.key}
                      disabled={!firstAvailableGroupMetric(group,takenByOther)}>{group.name}</option>)}
                  </select>
                </label>
                <label className="scope-self-stat-picker"><span>項目</span>
                  <select className="scope-select" aria-label={l.comparisonItem+' '+(index+1)+' 項目'}
                    value={selectedGroupMetrics.some(item=>item.id===chosenId)?chosenId:''}
                    disabled={!selectedGroupMetrics.length}
                    onChange={event=>selectMetric(event.target.value)}>
                    {!selectedGroupMetrics.length?<option value="">無可用項目</option>:null}
                    {selectedGroupMetrics.map(item=><option key={item.id} value={item.id}
                      disabled={takenByOther.has(item.id)}>{item.kind==='keyword_group_items'?l.groupItems:item.name}</option>)}
                  </select>
                </label>
                {kind==='keyword'||kind==='all'?keywordCatalog.isPending
                  ?<p className="scope-status" role="status">正在讀取組內項目…</p>:null:null}
                {(kind==='keyword'||kind==='all')&&keywordCatalog.error?<p role="alert" className="scope-status scope-error">
                  組內關鍵詞讀取失敗：{String(keywordCatalog.error?.message||keywordCatalog.error)}
                </p>:null}
                {!groups.length?<p className="scope-status">{l.noSelectableSource}</p>:null}
              </div>
            </section>;
          })}
        </div>
        <div className="scope-stat-controls">
          <label><span><FieldText text="圖表"/></span>
            <select className="scope-select" value={chartType} onChange={e=>setChartType(e.target.value)}>
              {chartGroups.primary.length?<optgroup label={t('uiExtra.statisticsView.chartPrimary')}>
  {chartGroups.primary.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}
{chartGroups.advanced.length?<optgroup label={t('uiExtra.statisticsView.chartAdvanced')}>
  {chartGroups.advanced.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}{!availableCharts.length?<option value="line"><FieldText text="尚無可用圖形"/></option>:null}
            </select>
          </label>
          <label className="scope-setting-toggle"><input type="checkbox" checked={foldBlank} onChange={e=>setFoldBlank(e.target.checked)}/> {l.foldEmptyTime}</label>
        </div>
        {selectedKeywordItems&&keywordItems.isPending?<p className="scope-status" role="status">正在讀取關鍵詞項目的每日統計…</p>:null}
        {selectedKeywordItems&&keywordItems.error?<p role="alert" className="scope-status scope-error">{String(keywordItems.error?.message||keywordItems.error)}</p>:null}
        {enough&&(!selectedKeywordItems||keywordItems.isSuccess)?<div>
          <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={range} idPrefix="scope-self-stat">
            <StatisticsMultiChart type={shownChartType} rows={calculated.chart} series={series}
              distribution={calculated.totals} foldBlank={foldBlank} height={410}/>
          </StatisticsChartFrame>
          <p className="scope-status">交互以「同日活躍」計算；關鍵詞群組與項目統一使用作品篇數，同日出現不代表同篇文章同時命中。</p>
          <StatisticsDetails>{()=><>
          <div className="scope-ranking">
            <div><strong>{l.activeDays}</strong><span>{calculated.days.toLocaleString(locale)}{l.dayUnit}</span></div>
            {calculated.totals.map(item=><div key={item.name}><strong>{item.name}</strong><span>{item.value.toLocaleString(locale)}{l.recordUnit}</span></div>)}
          </div>
          </>}</StatisticsDetails>
        </div>:!enough?<p className="scope-status">{l.notEnoughSources.replace('{count}',lanes)}</p>:null}
      </div>:null}
  </section>;
}
