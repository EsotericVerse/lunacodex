'use client';
import UiText from '../../i18n/UiText';
import FieldText from '../../i18n/FieldText';

import {translateUiField,UI_COPY} from '../../i18n/ui-copy';
import {useUiCopy,useUiLocale,useUiSection} from '../../i18n/ui-locale';

import {useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname,useSearchParams} from 'next/navigation';
import {useAsyncResource,useAsyncInfiniteResource,useResourceCache,prepareTransientResourceAction} from '../../../packages/zenstack/client-queries';
import {featureNavigationHref,galaxyIdentityHref,galaxyRelationLinks,readFeatureNavigation} from '../routing/feature-navigation';
import ScopeLink from '../ScopeLink';
import {scopeHref} from '../routing/scope-registry';
import {useEditDock} from '../edit-dock';
import {featureDataErrorMessage} from '../feature-data-state';
// Keep a visible, CSS-only waiting state even before the timeline chunk loads.
function CultureTimeLoading({label='正在載入時間定錨…'}){
  return <div className='scope-culture-density-loading' role='status' aria-live='polite' aria-busy='true'>
    <span className='scope-culture-density-loading__bar' aria-hidden='true'/>
    <span>{label}</span>
  </div>;
}
const CultureTimeline=dynamic(()=>import('../modules/culture-timeline/CultureTimeline'),{
  loading:()=> <CultureTimeLoading label='正在準備時間長河…'/>
});
import {CultureTimelineModel} from '../modules/culture-timeline/culture-timeline-model';
import {useRiverDensityAnalysis} from '../modules/culture-timeline/use-river-density-analysis';
import {structurePeriodPreference} from '../../loc/culture/period-navigation.mjs';
import {buildEraRiver,nextEditorEraExpansion} from '../../loc/culture/time-trace-river.mjs';
import {cultureEraPeriodHierarchy} from '../../loc/culture/era-period-hierarchy.mjs';
import {buildLocCultureScopePreview} from '../../loc/culture/loc-scope-preview.mjs';
import {allocateTimeUid,timePeriodContainsDate,timePeriodSortDate} from '../../loc/culture/time-lucus-ranges.mjs';

import {selectGalaxyIdentity,selectScopeDailyCounts} from '../../loc/galaxy/galaxy-query';
import {defaultScopeData,revalidateServerMetadata} from '../../loc/scope/scope-data';

import {deleteRows,insertRows,updateRows} from '../../loc/db/db-client.mjs';
import {assignedSource} from '../../loc/statistics/member-intersection-model.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../loc/preferences/default-year-window.mjs';
import {sourceOutlineOptions,groupedSourceOutline} from '../../loc/source/outline-options.mjs';
import {buildCultureRiverRootPayload,selectCultureRiverChildren} from '../../loc/culture/river-roots.mjs';
import {buildCultureSourceTreeLanes,rollupCultureSourceDays} from '../../loc/culture/source-tree-lanes.mjs';
import {useAccount} from '../../loc/auth/use-account';
import {useScopeRuntime} from '../use-scope-runtime';
import {ArticleSortSelect,FeaturePage,IncrementalList,WorkFullText} from '../ui';
import ManagementWorkspaceFrame from '../../loc/management/ManagementWorkspaceFrame';
// Article cards/editing are requested only when results actually render.
const Article=dynamic(()=>import('../Article'),{loading:()=>null});
const CultureTimelineEditor=dynamic(()=>import('./CultureTimelineEditor'),{
  loading:()=> <CultureTimeLoading label='正在準備時間定錨編輯器…'/>
});
const CulturePlaceRiver=dynamic(()=>import('./trace/CulturePlaceRiver'),{loading:()=>null});
import {workDisplayHeading,workDisplayText} from '../work-display-model';
import {DEFAULT_LIST_BATCH_SIZE} from '../../loc/db/db-contract.mjs';
import {publicContentFilters,requireGalaxyContent,resolveGalaxyTitle} from '../../loc/content/content-policy';
import {readGalaxyRecords} from '../../loc/model/feature-query-client.mjs';
const LocItemConfluence=dynamic(()=>import('./LocItemConfluence'),{loading:()=>null});

function isInteractiveTarget(target){
  return Boolean(target?.closest?.('a,button,input,select,textarea,summary,[role="button"],[contenteditable="true"]'));
}

// Preserve timeline instances while editor dialogs, suggested points and
// density suggestions update around them.
// Time has ONE management entry. Type selection belongs to the editor form.
const EMPTY_RIVER_FOCUS=Object.freeze({});
const EMPTY_CULTURE_GROUPS=Object.freeze([]);
function emptyRiverLabel(){return '';}
function classificationRiverLabel(item){
  if(item?.entry_type==='virtual_anchor')return item.display_label||'◇';
  if(item?.entry_type==='anchor')return item.display_label||'●';
  return '';
}
function labelOf(item,index,periodName=UI_COPY.format.period(index+1)){
  return item?.display_label||item?.name||item?.title||item?.period||periodName;
}
function sortPeriods(rows=[]){
  return [...rows].filter(item=>item?.start_date||item?.end_date).sort((a,b)=>
    String(a.start_date||a.end_date||'').localeCompare(String(b.start_date||b.end_date||''))
  );
}
function periodRange(rows=[],scope='',allTime=UI_COPY.culture.allTime){
  const starts=rows.map(row=>row.start_date||row.end_date).filter(Boolean).sort();
  const ends=rows.map(row=>row.end_date||row.start_date).filter(Boolean).sort();
  const openEnded=rows.some(row=>Boolean(row?.open_end)||!row?.end_date);
  return {
    period:'all',title:allTime,display_label:allTime,
    start_date:starts[0]||'',end_date:openEnded?null:(ends.at(-1)||null),scope_id:scope
  };
}
function periodKey(item){
  return String(item?.period||item?.era_id||item?.event_id||item?.uid||item?.id||'').trim();
}
function classLabel(value){
  const text=String(value||'').trim();
  return !text?'':text.endsWith('群組')?text:text+' 群組';
}
// Display classified Groups and Item hits from the unified UID tree.
function keywordDrillRiverItems(rows,{groupId='',meta={},groupItems=[]}={}){
  const classes=meta.classes||{},className=String(meta.class_name||'').trim();
  const known=new Map(groupItems.map(item=>[String(item.uid),item]));
  const buckets=new Map(),maximum=new Map();
  for(const row of rows||[]){
    const day=String(row.day||row.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
    let key='',label='',count=0,order=0;
    if(groupId){
      if(row.kind!=='item_day')continue;
      const item=known.get(String(row.item_key));
      if(!item)continue;
      key=String(row.item_key);
      label=String(item.name||key);
      count=Number(row.hit_count)||0;
      order=Number(item.order_no)||0;
    }else if(row.kind==='class_day'||(row.classification_group&&row.group_uid)){
      key=String(row.group_uid??'');
      const groupName=String(classes[key]||row.classification_group||'').trim();
      if(!groupName)continue;
      label=[className,groupName,'群組'].filter(Boolean).join(' ');
      count=Number(row.hit_count??row.count)||0;
      order=Object.keys(classes).indexOf(key)+1;
    }else continue;
    if(!key||!count)continue;
    const id=key+'\u0000'+day;
    const previous=buckets.get(id);
    const accumulated=(previous?.count||0)+count;
    buckets.set(id,{key,label,day,count:accumulated,order});
    maximum.set(key,Math.max(maximum.get(key)||0,accumulated));
  }
  return [...buckets.values()].map(({key,label,day,count,order})=>({
    id:'keyword-density:'+(groupId?'item':'class')+':'+key+':'+day,
    entry_id:'keyword-density:'+(groupId?'item':'class')+':'+key+':'+day,
    entry_type:'keyword_density',drill_key:key,
    group_label:label,category:label,display_label:'',
    title:day+' · '+label+' · '+count.toLocaleString()+(groupId?' 次':' 篇'),
    start_date:day,end_date:nextRiverDay(day),
    item_count:count,group_order:order,density_ratio:count/Math.max(1,maximum.get(key)||1)
  })).sort((a,b)=>a.start_date.localeCompare(b.start_date)
    ||a.group_order-b.group_order||a.group_label.localeCompare(b.group_label));
}
function formatCultureUi(template,values={}){
  return String(template||'').replace(/\{([a-zA-Z][\w]*)\}/gu,(match,key)=>
    Object.prototype.hasOwnProperty.call(values,key)?String(values[key]??''):match);
}
function nextRiverDay(value){
  const key=String(value||'').slice(0,10);
  if(!key)return '';
  const date=new Date(key+'T00:00:00Z');
  if(Number.isNaN(date.getTime()))return '';
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
}
function dayKeyFromTimelineValue(value){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return date.toISOString().slice(0,10);
}
function periodPositionRatio(date,start,end){
  const a=Date.parse(String(start||'').slice(0,10));
  const b=Date.parse(String(end||'').slice(0,10));
  const x=Date.parse(String(date||'').slice(0,10));
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(x)||b<=a)return 0;
  return Math.max(0,Math.min(1,(x-a)/(b-a)));
}
export default function Culture(){
  useUiSection('culture');
  useUiSection('uiExtra.cultureView');
  useUiSection('uiExtra.dataErrors');
  useUiSection('uiExtra.pagination');
  const UI_COPY=useUiCopy();
  const l=UI_COPY.uiExtra.cultureView;
  const localizedLabelOf=useMemo(()=> (item,index)=>labelOf(item,index,UI_COPY.format.period(index+1)),[UI_COPY]);
  const {locale}=useUiLocale();
  const {scopeId,scope}=useScopeRuntime();
  const [worksOpen,setWorksOpen]=useState(false);
  const searchParams=useSearchParams();
  const editDock=useEditDock();
  const canUseScopeEditor=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  const pathname=usePathname()||'';
  // A management URL must render its management workspace even after a full
  // navigation or an Edit Dock remount. The verified account still controls
  // access to the editor; a URL or dock state never confers permission.
  const onTimeManageRoute=pathname.endsWith('/culture/manage')||
    pathname.endsWith('/culture/manage/');
  const isTimeEditingView=onTimeManageRoute||
    (canUseScopeEditor&&searchParams?.get('edit')==='1');
  // Only the explicit editing route/dock exposes editing; server permissions
  // are still verified when the user opens an editor and when writing.
  const adminListRequested=Boolean(isTimeEditingView||canUseScopeEditor);
  // Public Culture does not load management grants; editing must verify them.
  const account=useAccount({enabled:isTimeEditingView||canUseScopeEditor});
  const [locCultureView,setLocCultureView]=useState('period');
  // LOC displays the one-year source density river immediately; no first river.
  const [locDensityOpen,setLocDensityOpen]=useState(true);
  const [expandedLocScopes,setExpandedLocScopes]=useState([]);
  const isLocItemView=scopeId==='loc'&&locCultureView==='item';
  const resourceCache=useResourceCache();
  const navigation=useMemo(()=>readFeatureNavigation(searchParams),[searchParams]);
  const query=useAsyncResource({
    queryKey:['culture-timeline',scopeId,isTimeEditingView?'management':'public'],
    queryFn:async({signal})=>{
      const {selectScopeCultureData,selectScopeCultureManagementData}=await import('../../loc/culture/query');
      return isTimeEditingView
        ?selectScopeCultureManagementData(scopeId,{signal})
        :selectScopeCultureData(scopeId);
    },
    enabled:!isLocItemView,
  });

  const [selectedPeriodKey,setSelectedPeriodKey]=useState('year');
  const [expandedEraIds,setExpandedEraIds]=useState([]);
  const [expandedEditorEraIds,setExpandedEditorEraIds]=useState([]);
  // Mount the historical river before the large management list/editor.
  // Both consume one authorized TimeAnchor snapshot; no extra SQL fetch.
  const [timeRiverFirstPaint,setTimeRiverFirstPaint]=useState(false);
  const [timeEditorFrameReady,setTimeEditorFrameReady]=useState(false);
  useEffect(()=>{setTimeRiverFirstPaint(false)},[scopeId,isTimeEditingView]);
  // Never make TimeAnchor editing depend exclusively on a vis-timeline paint
  // callback: a ready DataSet can have no visible bars or zero-size panels.
  // Give the real first river two paint frames, then release the editor even
  // if vis is still recovering; this cannot deadlock on missing callbacks.
  useEffect(()=>{
    if(!isTimeEditingView||query.isPending||query.error){
      setTimeEditorFrameReady(false);
      return undefined;
    }
    let first=0,second=0,cancelled=false;
    first=window.requestAnimationFrame(()=>{
      second=window.requestAnimationFrame(()=>{
        if(!cancelled)setTimeEditorFrameReady(true);
      });
    });
    return ()=>{
      cancelled=true;
      if(first)window.cancelAnimationFrame(first);
      if(second)window.cancelAnimationFrame(second);
    };
  },[isTimeEditingView,scopeId,query.isPending,query.error]);
  const periodSelectionScopeRef=useRef('');
  const [selectedCategory,setSelectedCategory]=useState('');
  const [articleSort,setArticleSort]=useState('desc');
  // Keyword Class is optional; ordinary Time River views must not scan the whole article corpus.
  const [styleFilter,setStyleFilter]=useState('none');
  // Media sites are already included in the unified SiteAnchor source river.
  // Only geography and keywords use independent presentation dimensions.
  const usesSourceRiver=styleFilter!=='trace';
  const [selectedKeywordClassUid,setSelectedKeywordClassUid]=useState('');
  const [keywordDrillSource,setKeywordDrillSource]=useState('');
  const [keywordDrillGroup,setKeywordDrillGroup]=useState('');
  const [keywordPeriodKey,setKeywordPeriodKey]=useState('year');
  const [keywordEraKey,setKeywordEraKey]=useState('year');
  const [keywordCustomStart,setKeywordCustomStart]=useState('');
  const [keywordCustomEnd,setKeywordCustomEnd]=useState('');
  const [selectedVirtualAnchorDates,setSelectedVirtualAnchorDates]=useState([]);
  const [focusedAnchorDate,setFocusedAnchorDate]=useState('');
  const [openCultureRoots,setOpenCultureRoots]=useState([]);
  // Anchor suggestions never compute just because a lane's daily data
  // arrived -- that would auto-run the PELT worker as a side effect of
  // expanding a source lane. They only compute once the user explicitly
  // opens the "建議定錨點" panel itself; see anchorSuggestOpen below.
  const [anchorSuggestOpen,setAnchorSuggestOpen]=useState(false);
  const [selectedRiverGroup,setSelectedRiverGroup]=useState('');
  const [creatingSuggestedAnchors,setCreatingSuggestedAnchors]=useState(false);
  const workScrollRef=useRef(null);
  const [fullTextKey,setFullTextKey]=useState('');
  const [fullText,setFullText]=useState('');
  const [fullDetail,setFullDetail]=useState(null);
  const [fullTextLoading,setFullTextLoading]=useState(false);
  const [fullTextError,setFullTextError]=useState('');
  const fullTextSequenceRef=useRef(0);
  useEffect(()=>()=>{fullTextSequenceRef.current+=1;},[]);
  const [editingWorkKey,setEditingWorkKey]=useState('');
  const [authorizedWorkKey,setAuthorizedWorkKey]=useState('');
  const [selectedTimelineRecordId,setSelectedTimelineRecordId]=useState('');
  const [selectedTimelineInfo,setSelectedTimelineInfo]=useState(null);
  const [selectedTimelineDate,setSelectedTimelineDate]=useState('');
  const [timelineEditorRevision,setTimelineEditorRevision]=useState(0);
  // Opening the time editor is a UI action, not an authorization check.
  // Verify the active user only when a write is actually requested.
  const [suggestedRecordType,setSuggestedRecordType]=useState('lucus');
  const [suggestedRequestNonce,setSuggestedRequestNonce]=useState(0);
  const [editDraft,setEditDraft]=useState(null);
  const [editBusy,setEditBusy]=useState(false);
  const [editError,setEditError]=useState('');

  useEffect(()=>{
    setStyleFilter('none');
    setLocDensityOpen(true);
    setExpandedLocScopes([]);
    setSelectedPeriodKey('year');
    setKeywordPeriodKey('year');
    setKeywordEraKey('year');
    setKeywordCustomStart('');
    setKeywordCustomEnd('');
    setOpenCultureRoots([]);
    setSelectedRiverGroup('');
    setFocusedAnchorDate('');
  },[scopeId]);
  const isAggregateScope=Boolean(scope?.aggregateChildren);
  // LOC's first Time River never queries per-day article/media density.
  // On-demand second-river data uses the shared ZenStack query client.
  const locRequestedStart=String(navigation.from||'').slice(0,10);
  const locRequestedEnd=String(navigation.to||'').slice(0,10);
  const locRequestedValid=/^\d{4}-\d{2}-\d{2}$/.test(locRequestedStart)&&
    /^\d{4}-\d{2}-\d{2}$/.test(locRequestedEnd)&&locRequestedStart<=locRequestedEnd;
  // The LOC landing river is always the latest year, not a period intersection.
  const locSourceStart=DEFAULT_YEAR_WINDOW.startDate;
  const locSourceEnd=DEFAULT_YEAR_WINDOW.endDate;
  const [locDensityCheckpoint,setLocDensityCheckpoint]=useState(null);
  const locDensityKey=JSON.stringify([scopeId,locSourceStart,locSourceEnd,(query.data?.scopes||[]).map(scope=>scope.id)]);
  const locDensityQuery=useAsyncResource({
    queryKey:['loc-culture-density','zmodel-source-year',scopeId,locSourceStart,locSourceEnd],
    enabled:!isTimeEditingView&&isAggregateScope&&scopeId==='loc'&&!isLocItemView&&locDensityOpen
      &&Boolean(query.data?.scopes?.length),
    queryFn:async({signal})=>{
      setLocDensityCheckpoint(null);
      const {selectLocCultureDensity}=await import('../../loc/culture/query');
      return selectLocCultureDensity({
        scopes:query.data?.scopes||[],startDate:locSourceStart,endDate:locSourceEnd,signal,
        onCheckpoint:data=>{if(!signal.aborted)setLocDensityCheckpoint({key:locDensityKey,data});}
      });
    },
  });
  // Time structure is authoritative without any remote ISR Period request.
  const allPeriods=useMemo(()=>sortPeriods(query.data?.eras?.eras||[]),[query.data]);
  const classificationScope=scopeId;
  // Published Scope/table identity is synchronous. The protected editor can
  // begin its own authorized read without waiting for a second public river.
  const scopeData=query.data?.scope||(!isAggregateScope?defaultScopeData(scopeId):null);
  // Use a stable periods array: date-navigation effects must not re-run just
  // because a different Culture panel or query refreshed the page.
  const primaryPeriods=useMemo(()=>isAggregateScope?[]:allPeriods.filter(item=>String(item?.scope_id||'')===scopeId),[isAggregateScope,allPeriods,scopeId]);
  const structurePreference=useMemo(()=>structurePeriodPreference(primaryPeriods,
    (query.data?.timelineItems||[]).filter(item=>item.scope_id===scopeId)),
  [primaryPeriods,query.data?.timelineItems,scopeId]);
  const closestPeriod=primaryPeriods.find(item=>periodKey(item)===structurePreference.preferredKey)||null;
  const secondRiverHierarchy=useMemo(()=>cultureEraPeriodHierarchy(
    primaryPeriods,query.data?.timelineItems||[],scopeId
  ),[primaryPeriods,query.data?.timelineItems,scopeId]);
  const activeSecondEra=secondRiverHierarchy.groups.find(group=>
    periodKey(group.era)===keywordEraKey)||null;
  const activeSecondPeriods=keywordEraKey==='__unassigned__'
    ?secondRiverHierarchy.unassigned:(activeSecondEra?.periods||[]);

  // Articles may exist even when no formal Period has been created. Use an
  // ordinary bounded date window; never treat an empty Time table as invalid.
  const defaultYearPeriod=useMemo(()=>({
    period:'year',title:DEFAULT_YEAR_WINDOW.label,
    display_label:DEFAULT_YEAR_WINDOW.label,
    start_date:DEFAULT_YEAR_WINDOW.startDate,
    end_date:DEFAULT_YEAR_WINDOW.endDate,
    scope_id:classificationScope
  }),[classificationScope]);
  const allTimePeriod=useMemo(()=>{
    if(primaryPeriods.length)return periodRange(primaryPeriods,classificationScope,UI_COPY.culture.allTime);
    return defaultYearPeriod;
  },[primaryPeriods,classificationScope,UI_COPY.culture.allTime,defaultYearPeriod]);
  useEffect(()=>{
    if(isAggregateScope||!query.data)return;
    const preferred=structurePreference.preferredKey;
    const scopeChanged=periodSelectionScopeRef.current!==scopeId;
    periodSelectionScopeRef.current=scopeId;
    setSelectedPeriodKey(current=>scopeChanged?'year':
      (current==='year'||current==='all'||primaryPeriods.some(period=>periodKey(period)===current))?current:'year');
  },[scopeId,isAggregateScope,query.data,structurePreference,primaryPeriods]);
  const selectedWorkPeriod=selectedPeriodKey==='year'?defaultYearPeriod
    :selectedPeriodKey==='all'?allTimePeriod
    :(primaryPeriods.find(item=>periodKey(item)===selectedPeriodKey)||closestPeriod||defaultYearPeriod);
  // Use the nearest saved trace until the selected period is settled.
  const selectedWindowStart=String(selectedWorkPeriod?.start_date||'');
  const selectedWindowEnd=String(selectedWorkPeriod?.end_date||new Date().toISOString().slice(0,10));
  // The integrated Culture timeline shares one interval across time hierarchy,
  // article density, keyword density, suggestions, and the work list.
  const keywordPeriod=keywordPeriodKey==='year'?defaultYearPeriod:
    keywordPeriodKey==='all'?allTimePeriod
    :keywordPeriodKey==='latest'?(closestPeriod||selectedWorkPeriod||allTimePeriod)
    :keywordPeriodKey==='current'?(selectedWorkPeriod||allTimePeriod)
    :activeSecondEra&&periodKey(activeSecondEra.era)===keywordPeriodKey?activeSecondEra.era
    :activeSecondPeriods.find(period=>periodKey(period)===keywordPeriodKey)
      ||primaryPeriods.find(period=>periodKey(period)===keywordPeriodKey)||closestPeriod||selectedWorkPeriod;
  const keywordWindowStart=keywordPeriodKey==='custom'
    ?keywordCustomStart:String(keywordPeriod?.start_date||'').slice(0,10);
  const keywordWindowEnd=keywordPeriodKey==='custom'
    ?keywordCustomEnd:String(keywordPeriod?.end_date||new Date().toISOString().slice(0,10)).slice(0,10);
  const keywordWindowValid=/^\d{4}-\d{2}-\d{2}$/.test(keywordWindowStart)
    &&/^\d{4}-\d{2}-\d{2}$/.test(keywordWindowEnd)
    &&keywordWindowStart<=keywordWindowEnd;
  const classificationWindowStart=keywordWindowStart;
  const classificationWindowEnd=keywordWindowEnd;
  // SQL reads only the bounding envelope. The selected period's exact
  // intervals must still exclude every day of an unlinked gap.
  const classificationPeriodRanges=keywordPeriodKey==='custom'||keywordPeriodKey==='all'||keywordPeriodKey==='year'
    ?null:(Array.isArray(keywordPeriod?.ranges)?keywordPeriod.ranges:null);
  const periodRangeSignature=JSON.stringify((classificationPeriodRanges||[]).map(range=>
    [range.start_date,range.end_date,range.open_end,range.invalid]));
  const classificationWindowValid=keywordWindowValid;
  // An unfilled custom range is normal until dates are supplied.
  const optionalTimeRangeUnfilled=!keywordWindowStart||!keywordWindowEnd;
  const classificationPeriodLabel=keywordPeriodKey==='year'?DEFAULT_YEAR_WINDOW.label:
    keywordPeriodKey==='custom'?l.customPeriod:
    keywordPeriod?localizedLabelOf(keywordPeriod,0):l.timeTrace;
  const requestedWindowStart=String(navigation.from||'').slice(0,10);
  const requestedWindowEnd=String(navigation.to||'').slice(0,10);
  const requestedPeriodUid=String(navigation.period||'').trim();
  const appliedDateNavigationRef=useRef('');
  useEffect(()=>{
    if(!requestedWindowStart){
      appliedDateNavigationRef.current='';
      return;
    }
    if(isAggregateScope||!primaryPeriods.length)return;
    const navigationKey=[scopeId,requestedWindowStart,requestedWindowEnd,requestedPeriodUid].join('|');
    if(appliedDateNavigationRef.current===navigationKey)return;
    const exactPeriod=requestedPeriodUid?primaryPeriods.find(item=>
      String(item.uid||'')===requestedPeriodUid||periodKey(item)===requestedPeriodUid):null;
    const matched=exactPeriod||primaryPeriods.find(item=>{
      const start=String(item?.start_date||'').slice(0,10);
      const end=String(item?.end_date||'9999-12-31').slice(0,10);
      // Never select a disconnected time trace merely because the clicked
      // date is inside its broad first-to-last bounding envelope.
      if(Array.isArray(item?.ranges))return timePeriodContainsDate(item,requestedWindowStart);
      return (!start||requestedWindowStart>=start)&&requestedWindowStart<=end;
    });
    if(matched){
      appliedDateNavigationRef.current=navigationKey;
      setSelectedPeriodKey(periodKey(matched));
      setKeywordEraKey(periodKey(matched));
      setKeywordPeriodKey(periodKey(matched));
    }
  },[scopeId,isAggregateScope,requestedWindowStart,requestedWindowEnd,requestedPeriodUid,primaryPeriods]);

  // One public LocAnchor ZModel read, shared in meaning with Statistics.
  // The persisted SiteAnchor hierarchy (attr.uid) is the only source tree.
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['loc-zmodel-source-taxonomy'],
    enabled:!isTimeEditingView&&!isAggregateScope&&!isLocItemView
      &&scopeId!=='local'&&Boolean(scopeData)&&usesSourceRiver,
    queryFn:async()=>{
      const {readPublicSourceTaxonomy}=await import('../../loc/source/catalog-public.mjs');
      return readPublicSourceTaxonomy();
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const sourceTaxonomy=sourceTaxonomyQuery.data;
  const sourceStyleOptions=useMemo(()=>sourceOutlineOptions(sourceTaxonomy),[sourceTaxonomy]);
  const sourceStyleGroups=useMemo(()=>groupedSourceOutline(sourceTaxonomy),[sourceTaxonomy]);
  const stagedSourceRiver=Boolean(sourceTaxonomy)&&!isAggregateScope&&scopeId!=='local';
  // The expanded items are saved loc_lucus UIDs; root family codes here
  // are only an internal daily-aggregate query filter, never a UI level.
  const expandedSourceRoots=(sourceTaxonomy?.roots||[])
    .filter(row=>openCultureRoots.includes(row.uid)).map(row=>row.root);
  // Retrieve one bounded daily aggregate per selected period. Reuse it when
  // expanding a group, so a UI interaction never starts a second SQL job.
  const sourceRootQuery=useAsyncResource({
    queryKey:['culture-period-roots','v5-zmodel-anchors',classificationScope,classificationWindowStart,classificationWindowEnd,periodRangeSignature],
    enabled:!isTimeEditingView&&stagedSourceRiver&&usesSourceRiver&&!isLocItemView
      &&Boolean(scopeData)&&classificationWindowValid,
    queryFn:async()=>{
      const {text}=await selectScopeDailyCounts(scopeData,{
        startDate:classificationWindowStart,endDate:classificationWindowEnd,
        includeUndated:true,requireAggregate:true
      });
      const inside=row=>!classificationPeriodRanges||timePeriodContainsDate(
        {ranges:classificationPeriodRanges},String(row.day||''));
      return buildCultureRiverRootPayload({
        text:text.filter(inside)
      },sourceTaxonomy);
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const expandedSourceRootsKey=expandedSourceRoots.join(',');
  const requestedChildren=useMemo(()=>{
    if(!stagedSourceRiver||!sourceRootQuery.data?.numericRows||!expandedSourceRoots.length)return [];
    return selectCultureRiverChildren(sourceRootQuery.data.numericRows,sourceTaxonomy,expandedSourceRoots);
  },[stagedSourceRiver,sourceRootQuery.data,sourceTaxonomy,expandedSourceRootsKey]);
  const expandedSourceReady=Boolean(sourceRootQuery.data)&&expandedSourceRoots.length>0;
  // In a published scope expanding a lane only transforms cached numeric rows.
  const sourceSnapshotQuery=useAsyncResource({
    queryKey:['culture-period-source-snapshot','v9-zmodel-source-only',classificationScope,classificationWindowStart,classificationWindowEnd,periodRangeSignature,stagedSourceRiver?expandedSourceRootsKey:'all'],
    enabled:!isTimeEditingView&&usesSourceRiver&&!isLocItemView&&!isAggregateScope&&Boolean(scopeData)&&classificationWindowValid
      &&Boolean(sourceTaxonomy)&&(!stagedSourceRiver||expandedSourceReady),
    queryFn:async()=>{
      const {selectScopePeriodSourceSnapshot}=await import('../../loc/culture/query');
      const range={
        startDate:classificationWindowStart,endDate:classificationWindowEnd,
        periodRanges:classificationPeriodRanges
      };
      return selectScopePeriodSourceSnapshot(scopeData,stagedSourceRiver
        ?{...range,numericRows:requestedChildren}:range);
    }
  });
  const keywordClassQuery=useAsyncResource({
    queryKey:['scope-active-keyword-class-name',scopeId],
    // Opening/focusing the style selector is the first reason to look up
    // the active Class. Ordinary Time River viewing performs no keyword SQL.
    enabled:!isTimeEditingView&&styleFilter==='rune66'&&!isAggregateScope&&!isLocItemView,
    queryFn:async()=>{
      const {selectAvailableKeywordClasses}=await import('../../loc/keywords/analysis');
      return selectAvailableKeywordClasses(scopeId);
    },
  });
  const availableKeywordClasses=keywordClassQuery.data?.classes||[];
  const selectedKeywordClass=availableKeywordClasses.find(item=>item.classUid===selectedKeywordClassUid)
    ||availableKeywordClasses.find(item=>item.classUid===keywordClassQuery.data?.currentClassUid)
    ||availableKeywordClasses[0];
  const resolvedKeywordClassUid=String(selectedKeywordClass?.classUid||'');
  const keywordClassLabel=selectedKeywordClass?'關鍵詞組：'+selectedKeywordClass.name
    :keywordClassQuery.isPending?'關鍵詞組（讀取中）':'關鍵詞組（尚未設定）';
  const styleQuery=useAsyncResource({
    queryKey:['culture-style-filter','rune66',classificationScope,resolvedKeywordClassUid,keywordWindowStart,keywordWindowEnd],
    queryFn:async()=>{
      const {selectKeywordAnalysisSummary}=await import('../../loc/keywords/analysis');
      return selectKeywordAnalysisSummary({scopeId,classUid:resolvedKeywordClassUid,startDate:keywordWindowStart,endDate:keywordWindowEnd});
    },
    enabled:!isTimeEditingView&&!isAggregateScope&&styleFilter==='rune66'&&Boolean(resolvedKeywordClassUid)&&keywordWindowValid,
  });
  // The original source-classification river must not wait for (or disappear
  // when) a separate keyword-density query runs.
  const riverRangeLoading=classificationWindowValid&&(stagedSourceRiver
    ?sourceRootQuery.isPending||sourceRootQuery.isFetching
    :sourceSnapshotQuery.isPending||sourceSnapshotQuery.isFetching);
  // Existing SQL summary covers the overview. Drill-down fetches only the
  // requested source and/or class, without eagerly reading all Galaxy attrs.
  // Expanding a Rune group reads only its catalog, not all Galaxy attributes.
  const keywordDetailRequested=Boolean(keywordDrillSource);
  const keywordDensityQuery=useAsyncResource({
    queryKey:['culture-keyword-attributes',scopeId,resolvedKeywordClassUid,keywordWindowStart,keywordWindowEnd,keywordDrillSource,keywordDrillGroup],
    enabled:!isTimeEditingView&&styleFilter==='rune66'&&keywordDetailRequested&&!isAggregateScope&&!isLocItemView
      &&Boolean(scopeData)&&keywordWindowValid&&Boolean(styleQuery.data?.statisticsEnabled),
    queryFn:async()=>{
      const {keywordService}=await import('../../loc/keywords/service-client.mjs');
      return keywordService('summary',{scopeId,
        classUid:resolvedKeywordClassUid,startDate:keywordWindowStart,
        endDate:keywordWindowEnd,source:keywordDrillSource
      });
    },
  });
  const keywordRiverPending=keywordDetailRequested?keywordDensityQuery.isPending:styleQuery.isPending;
  const keywordRiverError=keywordDetailRequested?keywordDensityQuery.error:null;
  useEffect(()=>{
    setKeywordDrillSource('');
    setKeywordDrillGroup('');
  },[scopeId]);
  const keywordGroupOptions=useMemo(()=>Object.entries(styleQuery.data?.keywordMeta?.classes||{})
    .map(([id,name])=>({id,label:String(name||'').trim()}))
    .filter(item=>item.label),
  [styleQuery.data?.keywordMeta?.classes]);
  // Fetch Group names/membership only after the user opens a specific Class.
  // The initial Class-density river never downloads the Group catalog.
  const keywordGroupCatalogQuery=useAsyncResource({
    queryKey:['culture-keyword-group-catalog',scopeId,styleQuery.data?.keywordMeta?.class_uid||'',keywordDrillGroup],
    enabled:!isTimeEditingView&&styleFilter==='rune66'&&Boolean(keywordDrillGroup)
      &&Boolean(styleQuery.data?.keywordMeta?.class_uid)&&Boolean(scopeData?.keywords),
    queryFn:async()=>{
      const {keywordService}=await import('../../loc/keywords/service-client.mjs');
      const {keywordClassCatalog}=await import('../../loc/keywords/tree.mjs');
      const result=await keywordService('catalog',{scopeId,classUid:resolvedKeywordClassUid});
      if(!result.class_uid)return [];
      const {catalog}=keywordClassCatalog(result.rows,result.class_uid);
      // The canonical UID Tree already supplies Group membership; no legacy
      // Group/Item article-hit lists are needed to label the Culture river.
      return catalog.filter(item=>item.group_uid===keywordDrillGroup)
        .map((item,index)=>({uid:item.uid,name:item.item_name,order_no:index}));
    },
    revalidateOnFocus:false,
    revalidateOnReconnect:false,
    revalidateIfStale:false
  });
  const keywordDrillItems=useMemo(()=>{
    if(keywordDetailRequested&&!keywordDensityQuery.data)return [];
    // Expanding a group preserves the Class density; no guessed per-day Rune bars.
    return keywordDrillRiverItems(keywordDetailRequested
      ?keywordDensityQuery.data:styleQuery.data?.classifications,{
      source:keywordDrillSource,groupId:keywordDetailRequested?keywordDrillGroup:'',
      meta:styleQuery.data?.keywordMeta,groupItems:keywordGroupCatalogQuery.data||[]
    });
  },[keywordDetailRequested,keywordDensityQuery.data,styleQuery.data?.classifications,keywordDrillSource,keywordDrillGroup,styleQuery.data?.keywordMeta,keywordGroupCatalogQuery.data]);

  const categoryGroups=sourceRootQuery.data?.groups||sourceSnapshotQuery.data?.groups||EMPTY_CULTURE_GROUPS;
  const groupedSources=useMemo(()=>{
    const catalog=sourceTaxonomy||{categories:[],aliases:[]};
    const byCode=new Map(catalog.categories.map(row=>[row.category_code,row]));
    const index=new Map();
    for(const source of categoryGroups){
      const raw=String(source.site||'');
      const code=assignedSource(raw,catalog.aliases,catalog.categories);
      const node=byCode.get(code);
      const root=node?.root||'custom';
      const label=node?.display_name||l.other;
      const key=root+':'+code;
      if(!index.has(key))index.set(key,{key,root,label,site:label,
        sites:[],item_count:0});
      const group=index.get(key);
      group.item_count+=Number(source.item_count)||0;
      group.sites.push(...(source.sites||[]));
    }
    return [...index.values()].map(group=>({
      ...group,sites:[...new Set(group.sites)]
    }));
  },[categoryGroups,sourceTaxonomy,l.other]);
  // Selecting a Domain uses the existing From descendant UID list; it does
  // not require querying each From or joining article text in the browser.
  const selectedGroup=useMemo(()=>{
    const exact=groupedSources.find(item=>item.key===selectedRiverGroup);
    if(exact)return exact;
    const option=sourceStyleOptions.find(item=>item.key===selectedRiverGroup);
    if(option){
      const descendants=new Set((sourceTaxonomy?.tree||[])
        .filter(node=>node.path.includes(option.code)).map(node=>node.uid));
      const members=groupedSources.filter(group=>
        descendants.has(group.key.slice(group.key.indexOf(':')+1)));
      if(members.length)return {key:option.key,root:option.root,label:option.label,
        site:option.label,sites:[...new Set(members.flatMap(item=>item.sites))],
        item_count:members.reduce((n,item)=>n+item.item_count,0)};
    }
    return categoryGroups.find(item=>item.category_key===
      (keywordDrillSource?'source:'+keywordDrillSource:selectedCategory))||null;
  },[groupedSources,selectedRiverGroup,sourceStyleOptions,sourceTaxonomy,categoryGroups,
    keywordDrillSource,selectedCategory]);
  const effectiveCategoryKey=selectedGroup?.category_key||selectedGroup?.key||'';
  // Density and Site expansion never load Galaxy IDs. The explicit
  // "顯示文章列表" click is the sole entry to this bounded reader.
  const periodWorksQuery=useAsyncInfiniteResource({
    queryKey:['culture-article-list',classificationScope,classificationWindowStart,
      classificationWindowEnd,effectiveCategoryKey||'',articleSort],
    initialPageParam:null,
    getNextPageParam:lastPage=>lastPage.hasMore?lastPage.nextCursor:undefined,
    enabled:!isTimeEditingView&&worksOpen&&styleFilter==='none'
      &&!isAggregateScope&&Boolean(scopeData)&&Boolean(selectedGroup)
      &&classificationWindowValid,
    queryFn:async({pageParam,signal})=>{
      const {selectCultureArticleListPage}=await import('../../loc/culture/query');
      return selectCultureArticleListPage(scopeData,{
        startDate:classificationWindowStart,endDate:classificationWindowEnd,
        site:selectedGroup?.site||'',sites:selectedGroup?.sites||[],
        sortDirection:articleSort,offset:pageParam?.offset||0,signal
      });
    }
  });
  const periodWorksPages=periodWorksQuery.data?.pages||[];
  const visibleWorkRows=useMemo(()=>{
    const map=new Map();
    periodWorksPages.forEach((page,pageIndex)=>(page.rows||[]).forEach((row,index)=>{
      const key=String(row?.key||row?.uid||row?.entry_id||'')||(pageIndex+':'+index);
      // OFFSET windows can overlap if new content arrives between requests.
      // Keep the first rendered article stable instead of overwriting it
      // with a later duplicate. The next page only appends unseen UIDs.
      if(!map.has(key))map.set(key,row);
    }));
    return [...map.values()];
  },[periodWorksPages]);
  const periodWorksPage={
    rows:visibleWorkRows,
    totalCount:undefined,
    loading:periodWorksQuery.isLoading||periodWorksQuery.isFetchingNextPage,
    error:periodWorksQuery.error,
    hasMore:Boolean(periodWorksQuery.hasNextPage),
    loadNext:periodWorksQuery.fetchNextPage,
    reload:periodWorksQuery.refetch
  };
  const selectedCount=Number(periodWorksPage.totalCount??selectedGroup?.item_count)||0;

  useEffect(()=>{
    setSelectedCategory('');
    setWorksOpen(false);
  },[scopeId]);

  useEffect(()=>{
    setSelectedCategory('');
    setWorksOpen(false);
    fullTextSequenceRef.current+=1;
    setFullTextLoading(false);
    setFullTextKey('');
    setFullText('');
    setFullDetail(null);
    setFullTextError('');
    if(workScrollRef.current)workScrollRef.current.scrollTop=0;
  },[classificationWindowStart,classificationWindowEnd]);

  useEffect(()=>{
    fullTextSequenceRef.current+=1;
    setFullTextLoading(false);
    setFullTextKey('');
    setFullText('');
    setFullDetail(null);
    setFullTextError('');
    if(workScrollRef.current)workScrollRef.current.scrollTop=0;
  },[selectedCategory,selectedRiverGroup]);


  const timelineItems=useMemo(()=>
    (query.data?.timelineItems||[]).filter(item=>isAggregateScope||item.scope_id===scopeId)
  ,[query.data,scopeId]);
  // The initial hierarchy paints only Era rows. Period and date rows appear
  // after the visitor opens that Era and then one of its Periods.
  const eraRiver=useMemo(()=>{
    const classified=buildEraRiver(timelineItems,expandedEraIds,{editorOnly:true,scopeId});
    return classified;
  },[timelineItems,expandedEraIds,scopeId]);
  const editorEraRiver=useMemo(()=>
    buildEraRiver(timelineItems,expandedEditorEraIds,{editorOnly:true,scopeId}),
    [timelineItems,expandedEditorEraIds,scopeId]);
  // Keep one active Era -> Period -> Date drill-down at a time.
  // The initial display is always a chronological Era-only list.
  const toggleEditorEra=groupId=>setExpandedEditorEraIds(current=>
    nextEditorEraExpansion(current,groupId));
  const toggleTimeTrace=groupId=>{
    const open=!expandedEraIds.includes(groupId);
    setExpandedEraIds(current=>nextEditorEraExpansion(current,groupId));
    if(open&&groupId.startsWith('time-undefined:')){
      setKeywordEraKey('__unassigned__');setKeywordPeriodKey('all');setSelectedPeriodKey('all');
    }else if(open&&groupId.includes(':period:')){
      const prefix='trace:'+scopeId+':';
      const path=groupId.startsWith(prefix)?groupId.slice(prefix.length):'';
      const marker=path.indexOf(':period:');
      if(marker>0){
        const eraKey=path.slice(0,marker),periodUid=path.slice(marker+8);
        setKeywordEraKey(eraKey);setKeywordPeriodKey(periodUid);setSelectedPeriodKey(periodUid);
      }
    }else if(open&&groupId.startsWith('trace:')){
      const trace=secondRiverHierarchy.groups.find(({era})=>
        'trace:'+String(era.scope_id||scopeId)+':'+periodKey(era)===groupId)?.era;
      if(trace){
        const key=periodKey(trace);
        setKeywordEraKey(key);setKeywordPeriodKey(key);setSelectedPeriodKey(key);
      }
    }
  };
  // The "all eras" camera includes actual saved history, not just the
  // latest year, so valid older time ranges cannot render off-screen.
  const structureDateBounds=useMemo(()=>{
    const dates=timelineItems.flatMap(item=>[item?.start_date,item?.end_date])
      .map(value=>String(value||'').slice(0,10))
      .filter(value=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)).sort();
    const start=dates[0]||DEFAULT_YEAR_WINDOW.startDate;
    const last=dates.at(-1)||DEFAULT_YEAR_WINDOW.endDate;
    return {start,end:last>start?last:nextRiverDay(start)};
  },[timelineItems]);
  // Management displays the same complete historical Time graph as Culture;
  // the current calendar year is not a filter or the initial editor camera.
  const editorRiverWindow=structureDateBounds;
  const currentStructureStart=activeStructureKey==='all'?structureDateBounds.start
    :String(currentStructurePeriod?.start_date||'').slice(0,10);
  // A trace stops at its final real lucus; no virtual today endpoint.
  const lastAnchorDate=String(structurePreference.lastAnchor?.start_date||'').slice(0,10);
  const savedTraceEnd=String(currentStructurePeriod?.end_date||'').slice(0,10);
  const currentStructureEnd=activeStructureKey==='all'?structureDateBounds.end
    :structureWindowKey===''&&lastAnchorDate>savedTraceEnd?lastAnchorDate:savedTraceEnd;
  // Keep the first river grouped by era UID. A selected trace changes
  // only the camera viewport, never the saved lucus/event/trace graph.
  const anchorRecords=useMemo(()=>timelineItems
    .filter(item=>item.entry_type==='lucus'&&item.uid)
    .sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))||String(a.display_label||'').localeCompare(String(b.display_label||''))),[timelineItems]);
  const locScopeIntervalItems=useMemo(()=>query.data?.scopeTimeRanges||[],[query.data]);
  // The LOC landing preview reads only per-Scope aggregates below.
  // Do not also construct the retired combined-source display arrays.
  const locSourceRiverItems=useMemo(()=>scopeId!=='loc'&&locDensityOpen?locDensityQuery.data?.sourceRiverItems||[]:[],[scopeId,locDensityQuery.data,locDensityOpen]);
  const locSourceGroups=useMemo(()=>scopeId!=='loc'&&locDensityOpen?locDensityQuery.data?.sourceGroups||[]:[],[scopeId,locDensityQuery.data,locDensityOpen]);
  const locCombinedSourceTotal=useMemo(()=>locSourceGroups.reduce((sum,item)=>sum+Number(item?.item_count||0),0),[locSourceGroups]);
  const locSourceGroupLabel=useMemo(()=>{
    const labels=new Map();
    for(const group of locSourceGroups){
      const count=Number(group?.item_count)||0;
      const ratio=locCombinedSourceTotal>0?(count/locCombinedSourceTotal)*100:0;
      labels.set(String(group?.site||group?.display_label||''),String(group?.display_label||group?.site||'')+' '+formatCultureUi(l.sourceGroupCount,{count:count.toLocaleString(locale),ratio:ratio.toFixed(1)}));
    }
    return labels;
  },[locSourceGroups,locCombinedSourceTotal,l,locale]);
  // LOC is a read-only annual preview. The first lane is always a Scope;
  // its child source categories are revealed from the same numeric query.
  const locMid=locDensityQuery.isPending&&!locDensityQuery.error&&locDensityCheckpoint?.key===locDensityKey
    ?locDensityCheckpoint.data:null;
  const locScopePreview=useMemo(()=>buildLocCultureScopePreview({
    scopes:query.data?.scopes||[],
    scopeRanges:locDensityQuery.data?.scopeRanges||locMid?.scopeRanges||[],
    completedScopeIds:locDensityQuery.data?null:locMid?.completedScopeIds||[],
    sourceScopeGroups:locDensityQuery.data?.sourceScopeGroups||[],
    sourceScopeRiverItems:locDensityQuery.data?.sourceScopeRiverItems||[],
    expandedScopeIds:expandedLocScopes
  }),[query.data?.scopes,locDensityQuery.data,expandedLocScopes,locMid]);
  const toggleLocScopeGroup=id=>{
    const prefix='loc-preview:';
    if(!String(id).startsWith(prefix))return;
    const scope=String(id).slice(prefix.length);
    if(!locScopePreview.scopeIds.includes(scope))return;
    setExpandedLocScopes(current=>current.includes(scope)
      ?current.filter(value=>value!==scope):[...current,scope]);
  };
  const locCombinedSourceRiverItems=useMemo(()=>locSourceRiverItems.map(item=>({
    ...item,
    end_date:nextRiverDay(item?.start_date),
    group_label:locSourceGroupLabel.get(String(item?.category||item?.group_label||''))||String(item?.group_label||'')
  })),[locSourceRiverItems,locSourceGroupLabel]);
  const locScopeDistributionItems=useMemo(()=>scopeId!=='loc'&&locDensityOpen?locDensityQuery.data?.scopeRanges||[]:[],[scopeId,locDensityQuery.data,locDensityOpen]);
  const locIntersectionScopeIds=useMemo(()=>query.data?.intersectionScopeIds||[],[query.data]);
  const locIntersectionStart=String(query.data?.intersectionStart||'');
  const locIntersectionEnd=String(query.data?.intersectionEnd||'');
  const locDistributionStart=locScopeIntervalItems.map(item=>String(item?.start_date||''))
    .filter(Boolean).sort()[0]||locIntersectionStart;
  const locDistributionEnd=locScopeIntervalItems.map(item=>String(item?.end_date||item?.start_date||''))
    .filter(Boolean).sort().at(-1)||locIntersectionEnd||new Date().toISOString().slice(0,10);
  const locScopeRiverItems=useMemo(()=>{
    const perScopeMax=new Map();
    let globalMax=0;
    for(const item of locScopeDistributionItems){
      const scope=String(item?.scope_id||'').trim();
      const count=Number(item?.item_count)||0;
      if(!scope)continue;
      perScopeMax.set(scope,Math.max(perScopeMax.get(scope)||0,count));
      globalMax=Math.max(globalMax,count);
    }
    const rows=locScopeDistributionItems.map((item,index)=>{
      const scope=String(item?.scope_id||'').trim();
      const day=String(item?.start_date||'').slice(0,10);
      const count=Number(item?.item_count)||0;
      return {
        ...item,
        id:item?.id||('loc-scope:'+scope+':'+day+':'+index),
        entry_id:item?.entry_id||('loc-scope:'+scope+':'+day+':'+index),
        entry_type:'scope_density',
        group_label:scope,
        category:scope,
        display_label:'',
        title:formatCultureUi(l.scopeDensityTitle,{date:day,scope,count:count.toLocaleString(locale)}),
        end_date:nextRiverDay(day),
        density_ratio:count/Math.max(1,perScopeMax.get(scope)||1),
        global_density_ratio:count/Math.max(1,globalMax)
      };
    }).filter(item=>item.group_label&&item.start_date);
    const represented=new Set(rows.map(item=>String(item.group_label||'')));
    for(const scopeId of locIntersectionScopeIds){
      const scope=String(scopeId||'').trim();
      if(!scope||represented.has(scope)||!locDistributionStart)continue;
      rows.push({
        id:'loc-scope-empty:'+scope,
        entry_id:'loc-scope-empty:'+scope,
        entry_type:'scope_density',
        scope_id:scope,
        group_label:scope,
        category:scope,
        display_label:'',
        title:formatCultureUi(l.scopeDensityTitle,{date:locDistributionStart,scope,count:'0'}),
        start_date:locDistributionStart,
        end_date:nextRiverDay(locDistributionStart),
        item_count:0,
        density_ratio:0,
        global_density_ratio:0
      });
    }
    return rows;
  },[locScopeDistributionItems,locIntersectionScopeIds,locDistributionStart,l,locale]);
  // An empty Time/Galaxy/Media database is a legitimate new Scope. Keep the
  // controls and empty-state river, not an absent Culture screen.
  const hasTimelineSurface=isAggregateScope?Boolean(locScopeIntervalItems.length||locSourceRiverItems.length||query.data?.scopes?.length):Boolean(query.data);

  function switchTimelineEditor(target,apply){
    // Reuse the edit dock's Save / Discard / Cancel safeguard when the
    // current inline form has unsaved changes. No navigation is involved.
    if(editDock?.active&&editDock.scopeId===scopeId){
      editDock.switchSection('time-record:'+target,apply);
    }else apply();
  }

  function beginTimelineCreation(type,date){
    switchTimelineEditor('new-'+type,()=>{
      // Creation must work even for periods without an exact Gregorian start day.
      const creationDate=/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))?String(date):new Date().toISOString().slice(0,10);
      setSelectedTimelineRecordId('');
      setSelectedTimelineInfo(null);
      setSuggestedRecordType(type);
      setSelectedTimelineDate(type==='lucus'?creationDate:'');
      setSuggestedRequestNonce(value=>value+1);
      setTimelineEditorRevision(value=>value+1);
    });
  }

  function beginTimelineRecordEdit(item,recordId){
    const id=String(recordId||item?.recordId||'').trim();
    if(!id)return;
    switchTimelineEditor('edit-'+id,()=>{
      const recordType=String(item?.entryType||item?.raw?.entry_type||'');
      if(['lucus','period','era'].includes(recordType))setSuggestedRecordType(recordType);
      setSelectedTimelineInfo(item||null);
      setSelectedTimelineRecordId(id);
      setSelectedTimelineDate('');
      setSuggestedRequestNonce(0);
      setTimelineEditorRevision(value=>value+1);
    });
  }

  async function refreshCultureSourceSummary(){
    await Promise.all([
      // Active keys use v4-staged-numeric / v8-reused-numeric and include
      // date windows. Invalidate by prefix, not retired exact versions.
      resourceCache.invalidate({queryKey:['culture-period-roots']}),
      resourceCache.invalidate({queryKey:['culture-period-source-snapshot']})
    ]);
  }
  async function refreshTimelineData(){
    // Time edits refresh direct database reads and shared client-query keys.
    if(scopeId!=='local')await revalidateServerMetadata();
    await Promise.all([
      resourceCache.invalidate({queryKey:['culture-timeline',scopeId]}),
      resourceCache.invalidate({queryKey:['culture-period-settings',scopeId]}),
      resourceCache.invalidate({queryKey:['search-style-keyword']}),
      refreshCultureSourceSummary()
    ]);
  }
  async function moveTimelineRecord(item,row){
    // Dates on Time periods/events are derived exclusively from existing
    // anchor_ids. Only a real lucus point can be moved on the river.
    if(row?.entryType!=='lucus'||!row.recordId||!scopeData?.time)return null;
    try{
      // Scope permissions are enforced by the database write RPC.
      const date=dayKeyFromTimelineValue(item?.start);
      if(!date)throw new Error(l.invalidAnchorDate);
      await updateRows(scopeData.time,{address:date},{filters:[{column:'uid',operator:'eq',value:row.recordId}]});
      await refreshTimelineData();
      setEditError('');
      return {...item,start:date};
    }catch(error){
      setEditError(error?.message||l.moveAnchorFailed);
      return null;
    }
  }
  async function removeTimelineRecord(item,row){
    if(!row?.recordId||!scopeData?.time)return null;
    try{
      // Scope permissions are enforced by the database write RPC.
      await deleteRows(scopeData.time,{filters:[{column:'uid',operator:'eq',value:row.recordId}]});
      setSelectedTimelineRecordId('');
      setSelectedTimelineDate('');
      setEditError('');
      await refreshTimelineData();
      return item;
    }catch(error){
      setEditError(error?.message||l.deleteFailed);
      return null;
    }
  }

  // The source selector drives the SECOND river, whether or not a keyword
  // style is active. LOC aggregate's own source river is separate.
  const classificationBuckets=useMemo(()=>(
    sourceSnapshotQuery.data?.buckets||[]
  ).filter(item=>!keywordDrillSource||String(item.category||'')===keywordDrillSource),
  [sourceSnapshotQuery.data,keywordDrillSource]);
  const secondRiverBuckets=classificationBuckets; // Daily river; no stored personal unit.
  // Anchor-suggestion density analysis only has data once a lane is expanded
  // (secondRiverBuckets is empty until then): suggestions are never computed
  // just from opening the Culture page.
  const densityInputBuckets=classificationBuckets;
  // Close the panel again whenever the underlying daily data changes (a
  // different lane expanded, the period changed) so a stale, already-open
  // panel doesn't silently keep showing suggestions for the old data.
  useEffect(()=>{setAnchorSuggestOpen(false)},[densityInputBuckets]);

  const existingAnchorDates=useMemo(()=>
    timelineItems
      .filter(item=>String(item?.entry_type||'')==='lucus')
      .map(item=>String(item?.start_date||item?.date||'').slice(0,10))
      .filter(Boolean)
  ,[timelineItems]);
  // Render the selected period immediately. Multi-year PELT executes in a
  // worker, so change-point suggestions cannot freeze the Time River.
  const riverAnalysis=useRiverDensityAnalysis(densityInputBuckets,existingAnchorDates,
    anchorSuggestOpen&&!isAggregateScope&&!isLocItemView&&usesSourceRiver&&Boolean(densityInputBuckets.length));
  const styleRiverAnalysis=useRiverDensityAnalysis(keywordDrillItems,existingAnchorDates,
    anchorSuggestOpen&&styleFilter==='rune66'&&Boolean(keywordDrillItems.length));
  // LOC's single source river has no automatic lucus suggestion/PELT worker.
  const locRiverAnalysis=useRiverDensityAnalysis(locCombinedSourceRiverItems,EMPTY_CULTURE_GROUPS,false);
  const virtualAnchorItems=useMemo(()=>{
    const total=Math.max(1,Number(riverAnalysis.totalCount)||0);
    return riverAnalysis.suggestions.map(item=>{
      const selected=selectedVirtualAnchorDates.includes(item.date);
      const beforeCount=Number(item.beforeCount||0);
      const afterCount=Number(item.afterCount||0);
      const strength=Math.min(1,Math.abs(Number(item.afterMean||0)-Number(item.beforeMean||0))/Math.max(1,Number(item.afterMean||0),Number(item.beforeMean||0)));
      const position=periodPositionRatio(item.date,classificationWindowStart,classificationWindowEnd);
      return {
        id:'virtual-lucus:'+item.date,
        entry_id:'virtual-lucus:'+item.date,
        entry_type:'virtual_anchor',
        start_date:item.date,
        title:formatCultureUi(l.candidateTitle,{date:item.date,position:(position*100).toFixed(1),before:beforeCount.toLocaleString(locale),beforeRatio:((beforeCount/total)*100).toFixed(1),after:afterCount.toLocaleString(locale),afterRatio:((afterCount/total)*100).toFixed(1),analysis:(item.analysis||[]).join(' ')}),
        display_label:'◇',
        group_label:l.candidateAnchor,
        item_count:0,
        className:'scope-virtual-lucus'+(selected?' is-selected':''),
        style:'--virtual-lucus-strength:'+strength+';',
        virtual_anchor:{...item,position_ratio:position,before_ratio:beforeCount/total,after_ratio:afterCount/total,strength_ratio:strength}
      };
    });
  },[riverAnalysis.suggestions,riverAnalysis.totalCount,selectedVirtualAnchorDates,classificationWindowStart,classificationWindowEnd,l,locale]);
  // The source river renders the *actual* four-level loc_lucus UID tree.
  // A single child still occupies its own row; no Universe/Galaxy/Domain/From
  // level is silently flattened into a site name.
  const showKeywordRiver=styleFilter==='rune66';
  const cultureRiver=useMemo(()=>{
    const hierarchy=buildCultureSourceTreeLanes(
      sourceTaxonomy,groupedSources,openCultureRoots);
    const {days,maximum}=rollupCultureSourceDays(
      secondRiverBuckets,groupedSources,sourceTaxonomy);
    const periodTotal=hierarchy.total||1;
    const numberedLabel=(label,count)=>label+'（'+count.toLocaleString(locale)+'）';
    const dayRow=(id,day,count,label,order,max,kind,sourceKey)=>({
      id:'dual:'+id+':'+day,entry_id:'dual:'+id+':'+day,
      entry_type:kind,group_key:'dual:'+id,group_label:label,group_order:order,
      start_date:day,end_date:nextRiverDay(day),item_count:count,
      density_ratio:count/Math.max(1,max),display_label:'',
      source_group_code:sourceKey,
      title:day+' · '+label+' · '+count.toLocaleString(locale)
    });
    const flatRow=(id,count,label,order,kind,sourceKey)=>({
      id:'dual:'+id+':flat',entry_id:'dual:'+id+':flat',
      entry_type:kind,group_key:'dual:'+id,group_label:label,group_order:order,
      start_date:classificationWindowStart,end_date:nextRiverDay(classificationWindowEnd),
      item_count:count,density_ratio:count/periodTotal,display_label:'',
      source_group_code:sourceKey,
      title:label+' · '+count.toLocaleString(locale)+' / '+periodTotal.toLocaleString(locale)
    });
    const items=[],groups=[];
    const activeRoots=new Set(hierarchy.visible
      .filter(node=>node.level===0&&node.item_count>0)
      .map(node=>node.uid||'unassigned'));
    for(const [index,node] of hierarchy.visible.entries()){
      const id='source:'+(node.uid||'unassigned');
      const order=index+1;
      const label=numberedLabel(node.label,node.item_count);
      const kind=node.level>0&&node.selectable?'source_group':'source_total';
      groups.push({
        id:'dual:'+id,label,order,depth:node.level,
        className:node.level===0?'scope-dual-river-root':'scope-dual-river-child',
        collapsible:node.collapsible,selectable:node.selectable,
        sourceKey:node.sourceKey,expanded:node.expanded
      });
      // The primary row is a window-total (never an extra SQL query).
      // After expanding a Universe, reuse its already-loaded daily buckets
      // on individual source children, keeping parent UID rows intact.
      let dayCount=0;
      if(node.level>0&&sourceSnapshotQuery.data&&node.item_count>0){
        for(const [key,count] of days){
          const [uid,day]=key.split('\u0000');
          if(uid!==node.uid||count<=0)continue;
          dayCount++;
          items.push(dayRow(id,day,count,node.label,order,
            maximum.get(uid),kind,node.sourceKey));
        }
      }
      if(dayCount===0)items.push(flatRow(id,node.item_count,node.label,
        order,kind,node.sourceKey));
    }
    // "建議定錨點" is a permanent lane/track, exactly like the source-category
    // lanes above -- it must stay on the chart whenever there is underlying
    // daily data to potentially analyze, even before anyone has clicked it.
    // Only its *content* (the computed candidate markers) is deferred: the
    // lane itself is just collapsible like any other lane, and clicking it
    // (via onGroupToggle) is what sets anchorSuggestOpen and starts the
    // PELT worker -- never pushing/popping the lane's existence itself.
    // Visible whenever the second river itself has any lanes at all --
    // exactly the same condition the source-category lanes above use
    // (activeRoots.size>0) -- never tied to a specific lane having been
    // expanded. Expanding a category is what actually produces daily
    // buckets to analyze; the lane's existence does not wait for that.
    if(usesSourceRiver&&activeRoots.size>0){
      // Opened but nothing computed yet -- show a "loading" label on the
      // lane itself, except when there is nothing to analyze yet because no
      // category has been expanded (no daily data exists at all), where we
      // say so instead of implying a computation is silently running.
      const anchorLaneWaitingForExpansion=anchorSuggestOpen&&!virtualAnchorItems.length&&!densityInputBuckets.length;
      const anchorLaneLoading=anchorSuggestOpen&&!virtualAnchorItems.length&&densityInputBuckets.length>0;
      groups.push({id:'dual:source:candidates',
        label:anchorLaneLoading?l.candidateLaneLoading:anchorLaneWaitingForExpansion?l.candidateLaneNeedsExpansion:l.candidateLane,
        order:900,className:'scope-candidate-lane',collapsible:true,expanded:anchorSuggestOpen});
      if(virtualAnchorItems.length)
        items.push(...virtualAnchorItems.map(item=>({...item,group_key:'dual:source:candidates',group_label:l.candidateLane,group_order:900})));
    }
    if(showKeywordRiver){
      items.push(...keywordDrillItems.map((item,index)=>({
        ...item,id:'dual:'+String(item.id),
        group_key:'dual:keyword:'+String(item.drill_key||item.group_label||index),
        group_label:String(item.group_label||''),group_order:1000+(Number(item.group_order)||index)
      })));
      const keywordCounts=new Map();
      for(const item of keywordDrillItems){
        const key=String(item.drill_key||'');
        if(key)keywordCounts.set(key,(keywordCounts.get(key)||0)+(Number(item.item_count)||0));
      }
      for(const group of keywordGroupOptions){
        const count=keywordCounts.get(String(group.id))||0;
        if(count<=0)continue;
        groups.push({
          id:'dual:keyword:'+group.id,label:group.label+'（'+count.toLocaleString(locale)+'）',
          order:1000+Number(group.id)*100,className:'scope-dual-river-root',
          collapsible:true,expanded:keywordDrillGroup===group.id
        });
      }
    }
    return {items,groups,hasSourceData:activeRoots.size>0};
  },[sourceTaxonomy,groupedSources,secondRiverBuckets,openCultureRoots,sourceSnapshotQuery.data,virtualAnchorItems,showKeywordRiver,keywordDrillItems,keywordGroupOptions,l,locale,classificationWindowStart,classificationWindowEnd,styleFilter,densityInputBuckets,anchorSuggestOpen]);
  const integratedCultureRiver=useMemo(()=>{
    const timeEra=activeSecondEra?.era||
      (keywordEraKey==='latest'?closestPeriod:null);
    const timePeriod=activeSecondPeriods.find(row=>periodKey(row)===keywordPeriodKey)||null;
    const eraUid=String(timeEra?.uid||'');
    const periodUid=String(timePeriod?.uid||'');
    const eraGroupId=eraUid?'trace:'+String(timeEra.scope_id||scopeId)+':'+eraUid:'';
    const periodGroupId=periodUid?eraGroupId+':period:'+periodUid:'';
    const exactRanges=(classificationPeriodRanges||[]).filter(range=>
      /^\d{4}-\d{2}-\d{2}$/.test(String(range?.start_date||'').slice(0,10)));
    const overlaps=(row,range)=>{
      const from=String(row?.start_date||'').slice(0,10);
      const until=String(row?.end_date||row?.start_date||'').slice(0,10);
      return from&&until&&from<=range.end&&until>=range.start;
    };
    const visibleInSelectedWindow=row=>exactRanges.length
      ?exactRanges.some(range=>overlaps(row,{
        start:String(range.start_date).slice(0,10),
        end:String(range.end_date||range.start_date).slice(0,10)
      }))
      :overlaps(row,{start:classificationWindowStart,end:classificationWindowEnd});
    const timeGroups=eraRiver.groups.filter(group=>{
      if(keywordEraKey==='__unassigned__')return group.id.startsWith('time-undefined:');
      if(eraGroupId){
        if(group.id===eraGroupId)return true;
        if(periodGroupId)return group.id===periodGroupId||group.id===periodGroupId+':dates';
        return group.id.startsWith(eraGroupId+':period:');
      }
      return true;
    }).map((group,index)=>({
      ...group,order:index,
      className:[group.className,'scope-culture-time-lane'].filter(Boolean).join(' ')
    }));
    const timeItems=eraRiver.items.filter(item=>{
      if(!visibleInSelectedWindow(item))return false;
      if(keywordEraKey==='__unassigned__')return item.group_key?.startsWith('time-undefined:');
      if(eraUid&&String(item.uid||'')!==eraUid&&String(item.era_uid||'')!==eraUid)return false;
      if(periodUid&&item.entry_type!=='era'&&String(item.period_uid||'')!==periodUid)return false;
      return true;
    });
    const sourceGroups=usesSourceRiver?cultureRiver.groups:[];
    const sourceItems=usesSourceRiver?cultureRiver.items:[];
    const groups=[...timeGroups,...sourceGroups.map((group,index)=>({
      ...group,order:100000+index,
      className:[group.className,'scope-culture-source-lane'].filter(Boolean).join(' ')
    }))];
    return {groups,items:[...timeItems,...sourceItems],hasTimeGroups:timeGroups.length>0};
  },[activeSecondEra,activeSecondPeriods,keywordEraKey,keywordPeriodKey,closestPeriod,
    scopeId,classificationPeriodRanges,classificationWindowStart,classificationWindowEnd,
    eraRiver,cultureRiver,usesSourceRiver]);
  const focusedCandidate=riverAnalysis.suggestions.find(item=>item.date===focusedAnchorDate);
  const anchorInsight=focusedCandidate?{
    date:focusedCandidate.date,before:Number(focusedCandidate.beforeCount)||0,
    after:Number(focusedCandidate.afterCount)||0,reason:(focusedCandidate.analysis||[]).join(' ')
  }:null;
  useEffect(()=>{
    setSelectedVirtualAnchorDates(current=>current.filter(date=>riverAnalysis.suggestions.some(item=>item.date===date)));
    setFocusedAnchorDate(current=>riverAnalysis.suggestions.some(item=>item.date===current)?current:'');
  },[scopeId,classificationWindowStart,classificationWindowEnd,riverAnalysis.suggestions]);

  const toggleCultureRiverGroup=id=>{
    if(id==='dual:source:candidates'){
      setAnchorSuggestOpen(current=>!current);
      return;
    }
    if(id.startsWith('dual:keyword:')){
      const groupId=id.slice('dual:keyword:'.length);
      if(keywordGroupOptions.some(group=>group.id===groupId))
        setKeywordDrillGroup(current=>current===groupId?'':groupId);
      return;
    }
    if(!id.startsWith('dual:source:'))return;
    const uid=id.slice('dual:source:'.length);
    // Only a saved SiteAnchor UID with actual children can be expanded.
    if(!(sourceTaxonomy?.tree||[]).some(node=>node.uid===uid))return;
    setOpenCultureRoots(current=>current.includes(uid)
      ?current.filter(value=>value!==uid):[...current,uid]);
  };
  const selectCultureRiverGroup=id=>{
    const key=cultureRiver.groups.find(group=>group.id===id)?.sourceKey
      ||id.replace('dual:child:','');
    setSelectedRiverGroup(current=>current===key?'':key);
    setSelectedCategory('');
    setWorksOpen(true);
  };
  const toggleVirtualAnchor=date=>{
    setSelectedVirtualAnchorDates(current=>current.includes(date)?current.filter(item=>item!==date):[...current,date].sort());
  };

  async function createSelectedSuggestedAnchors(){
    if(!canUseScopeEditor||creatingSuggestedAnchors||!scopeData?.time)return;
    const suggestedDates=new Set(riverAnalysis.suggestions.map(item=>item.date));
    const existingDates=new Set(existingAnchorDates);
    const dates=[...new Set(selectedVirtualAnchorDates)]
      .filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&suggestedDates.has(date)&&!existingDates.has(date));
    if(!dates.length){setEditError('目前沒有可新增的建議定錨點。');return;}
    setCreatingSuggestedAnchors(true);setEditError('');
    try{
      // Only this explicitly requested bulk write needs the extra foreground
      // authorization check. The database RPC remains the final guard.
      const verified=await account.refresh();
      if(!verified?.authorizer?.canLocAccessSync('scope',scopeId))throw new Error('請先登入具備此 Scope 權限的帳號。');
      const used=new Set((query.data?.timelineItems||[]).filter(row=>row?.entry_type==='lucus').map(row=>String(row.uid||'')));
      const payload=dates.map(date=>{
        const uid=allocateTimeUid([...used].map(uid=>({uid})));
        used.add(uid);
        return {uid,type:'lucus',title:'建議定錨 '+date,description:null,address:date,anchor_ids:null};
      });
      await insertRows(scopeData.time,payload);
      setSelectedVirtualAnchorDates([]);
      await refreshTimelineData();
    }catch(error){setEditError(String(error?.message||error));}
    finally{setCreatingSuggestedAnchors(false);}
  }

  async function startEditingWork(work){
    if(!adminListRequested)return;
    const uid=String(work?.uid||'').trim();
    if(!uid)return;
    const key=String(work?.key||('galaxy:'+uid));
    setEditingWorkKey(key);setEditDraft(null);setAuthorizedWorkKey('');setEditError('');
    try{
      // Editing is offered to every reader, but only an authorized Scope
      // editor may load an editable draft after clicking the button.
      const verified=await account.refresh();
      if(!verified?.authorizer?.canLocAccessSync('scope',scopeId))throw new Error('請先登入具有此 Scope 編輯權限的帳號。');
      setAuthorizedWorkKey(key);
      if(!scopeData)throw new Error(l.sourceUnresolved);
      // The editor uses the fixed GalaxyUidRead action, which verifies the
      // Scope grant on the server and selects only this article UID.
      const {rows=[]}=await readGalaxyRecords({
        scope:scopeId,view:'detail',uids:[uid]
      },{editor:true});
      const row=rows[0];
      if(!row)throw new Error(l.workNotFound);
      const {plainTextToBlocks}=await import('../../loc/editor/blocknote-content.mjs');
      setEditDraft({
        title:String(row.title||work.title||''),
        body:String(row.content||''),
        bodyHtml:String(row.content||''),
        bodyBlocks:plainTextToBlocks(String(row.content||'')),
        editorKey:uid,
        hidden:row.list===false,
        originalHidden:row.list===false,
        originalSearch:row.search!==false
      });
    }catch(exception){
      setEditingWorkKey('');setAuthorizedWorkKey('');
      const message=String(exception?.message||exception||l.editReadFailed);
      setEditError(message);setFullTextError(message);
    }
  }

  async function saveEditingWork(work){
    const uid=String(work?.uid||'').trim();
    if(!adminListRequested||authorizedWorkKey!==String(work?.key||('galaxy:'+uid)))return;
    if(!uid||!editDraft)return;
    setEditBusy(true);setEditError('');
    try{
      if(!scopeData)throw new Error(l.sourceUnresolved);
      const {blocksToPlainText}=await import('../../loc/editor/blocknote-content.mjs');
      const content=await requireGalaxyContent(editDraft.bodyHtml??blocksToPlainText(editDraft.bodyBlocks));
      const plainBody=blocksToPlainText(editDraft.bodyHtml??editDraft.bodyBlocks);
      await updateRows(scopeData.galaxy,{
        title:resolveGalaxyTitle(editDraft.title,plainBody),
        content,
        ...(editDraft.hidden===editDraft.originalHidden?{}:{list:editDraft.hidden!==true,search:editDraft.hidden!==true}),
        UpdateTime:new Date().toISOString()
      },{filters:[{column:'uid',operator:'eq',value:uid}]});
      const key=String(work?.key||('galaxy:'+uid));
      if(fullTextKey===key)setFullText(content);
      setEditingWorkKey('');setAuthorizedWorkKey('');setEditDraft(null);
      await refreshCultureSourceSummary();
      periodWorksPage.reload();
    }catch(exception){
      setEditError(String(exception?.message||exception||l.saveFailed));
    }finally{
      setEditBusy(false);
    }
  }

  async function deleteEditingWork(work){
    const uid=String(work?.uid||'').trim();
    if(!adminListRequested||authorizedWorkKey!==String(work?.key||('galaxy:'+uid)))return;
    if(!uid)return;
    setEditBusy(true);setEditError('');
    try{
      if(!scopeData)throw new Error(l.sourceUnresolved);
      await deleteRows(scopeData.galaxy,{filters:[{column:'uid',operator:'eq',value:uid}]});
      const key=String(work?.key||('galaxy:'+uid));
      if(fullTextKey===key){setFullTextKey('');setFullText('');}
      setEditingWorkKey('');setAuthorizedWorkKey('');setEditDraft(null);
      await refreshCultureSourceSummary();
      periodWorksPage.reload();
    }catch(exception){
      setEditError(String(exception?.message||exception||l.deleteFailed));
    }finally{setEditBusy(false)}
  }

  async function toggleWorkContent(work){
    const uid=String(work?.uid||'').trim();
    if(!uid)return;
    const key=String(work?.key||('galaxy:'+uid));
    const request=++fullTextSequenceRef.current;
    if(fullTextKey===key){
      setFullTextKey('');
      setFullText('');
      setFullDetail(null);
      setFullTextError('');
      setFullTextLoading(false);
      return;
    }
    setFullTextKey(key);
    setFullText('');
    setFullTextError('');
    setFullDetail(null);
    setFullTextLoading(true);
    try{
      if(!scopeData)throw new Error(l.sourceUnresolved);
      const row=await selectGalaxyIdentity(scopeData,uid);
      if(request!==fullTextSequenceRef.current)return;
      if(!row)throw new Error(l.workNotFound);
      setFullText(workDisplayText(row.content||''));
      setFullDetail(row);
    }catch(exception){
      if(request===fullTextSequenceRef.current)
        setFullTextError(String(exception?.message||exception||l.fullTextFailed));
    }finally{
      if(request===fullTextSequenceRef.current)setFullTextLoading(false);
    }
  }

  // The dedicated management entry is already in edit mode. Only its selected
  // record kind appears on the right, with the same native zoom/pan controls.
  if(isTimeEditingView){
    const editorAvailable=Boolean(scopeId&&scopeId!=='loc');
    const permissionPending=account.loading||account.permissionLoading;
    const editorAuthorized=Boolean(account.user&&account.canLocAccessSync('scope',scopeId));
    return <FeaturePage featureId="culture">
      <ManagementWorkspaceFrame level="scope" title="時間定錨管理">
        <section className="management-workspace-panel scope-time-edit-root">
        {!editorAvailable?<p className='scope-status'>此區沒有個別 Scope 的時間編輯資料。</p>:null}
        {editorAvailable&&permissionPending?<CultureTimeLoading label='正在確認此 Scope 的編輯權限…'/>:null}
        {editorAvailable&&!permissionPending&&!editorAuthorized?<p className='scope-status scope-error' role='alert'>
          {account.error?String(account.error):account.user?'目前登入帳號沒有此 Scope 的管理權限。':'請先至設定首頁登入，才能編輯時間定錨。'}
        </p>:null}
        {editorAvailable&&!permissionPending&&editorAuthorized?<div className='scope-time-edit-workspace scope-culture-structure-river'>
          <div className='management-workspace-panel' id='time-editor-panel' role='region'
            aria-label='時間編輯'>
            <div className='scope-culture-timeline-tools'>
              <h3>時代／期間／時間定錨點</h3>
              <button type='button' className='loc-button' disabled={query.isPending}
                onClick={()=>void refreshTimelineData().catch(error=>setEditError(error?.message||'時間長河更新失敗'))}>更新時間長河</button>
            </div>
            {query.isPending?<CultureTimeLoading label='正在載入時間紀錄…'/>:null}
            {query.error?<p className='scope-status scope-error' role='alert'>{featureDataErrorMessage(query.error,UI_COPY)}</p>:null}
            {!query.isPending&&!query.error&&!timelineItems.length
              ?<p className='scope-status'>目前尚未建立此類時間紀錄，可直接在下方新增。</p>:null}
            {!query.isPending&&!query.error&&!editorEraRiver.groups.length
              ?<p className='scope-status' role='status'>時間紀錄已讀取，但目前沒有可顯示的時代／定錨點。</p>:null}
            {!query.isPending&&!query.error&&editorEraRiver.groups.length>0?<CultureTimeline
              key={'time-editor-era-period'}
              items={editorEraRiver.items}
              extraGroups={editorEraRiver.groups}
              labelOf={localizedLabelOf}
              focus={EMPTY_RIVER_FOCUS}
              mode='trace'
              compactHierarchy
              unfoldCurtain={false}
              onFirstPaint={()=>setTimeRiverFirstPaint(true)}
              onGroupToggle={toggleEditorEra}
              windowStart={editorRiverWindow.start}
              windowEnd={editorRiverWindow.end}
              onSelect={item=>beginTimelineRecordEdit(item)}
              editable={false}
            />:null}
            {selectedTimelineInfo?<div className='scope-card scope-culture-timeline-selection' role='status'>
              <strong>{selectedTimelineInfo.content||selectedTimelineInfo.title||'時間紀錄'}</strong>
              <p className='scope-status'>{String(selectedTimelineInfo.start||'').slice(0,10)}{selectedTimelineInfo.end?' ～ '+String(selectedTimelineInfo.end).slice(0,10):''}</p>
            </div>:null}
            <div className='scope-culture-time-input-area'>
              {!query.isPending&&!query.error&&(timeRiverFirstPaint||timeEditorFrameReady||!editorEraRiver.groups.length)
                ?<CultureTimelineEditor key={scopeId+':unified:'+timelineEditorRevision}
                scopeId={scopeId}
                timeTable={scopeData?.time||''}
                timeRecords={query.data?.editorRows||null}
                timeLoading={query.isPending}
                timeError={query.error}
                birthday={scopeData?.birthday||''}
                selectedRecordId={selectedTimelineRecordId}
                suggestedAnchorDate={selectedTimelineDate}
                suggestedRecordType={suggestedRecordType}
                defaultRecordType='lucus'
                suggestedRequestNonce={suggestedRequestNonce}
                onDataChanged={refreshTimelineData}
                onClose={()=>{setSelectedTimelineRecordId('');setSelectedTimelineDate('');setSelectedTimelineInfo(null);setSuggestedRequestNonce(0)}}/>
                :null}
            </div>
            {editError?<p className='scope-status scope-error' role='alert'>{editError}</p>:null}
          </div>
        </div>:null}
        </section>
      </ManagementWorkspaceFrame>
    </FeaturePage>;
  }

  // LOC Culture is a fixed one-year overview of member Scopes.
  // All detailed TimeAnchor rivers and article browsing live inside each Scope.
  if(scopeId==='loc'&&!isTimeEditingView)return <FeaturePage featureId="culture">
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      {query.isPending||Boolean(query.data?.scopes?.length)&&locDensityQuery.isPending
        ?<p className='scope-status' role='status'>{locMid?`已完成 ${locMid.completed}／${locMid.total} 個 Scope，暫計 ${locMid.scopeRanges.reduce((n,row)=>n+Number(row.item_count||0),0).toLocaleString()} 篇；其餘仍在計算。`:UI_COPY.common.loading}</p>:null}
      {query.isPending&&!locScopePreview.groups.length?<div className='loc-progressive-river-frame' aria-busy='true'><div className='loc-progressive-river-axis'/><small>{locSourceStart} ～ {locSourceEnd}</small></div>:null}
      {query.error?<p className='scope-status scope-error' role='alert'>
        {featureDataErrorMessage(query.error,UI_COPY)}</p>:null}
      {locDensityQuery.error?<p className='scope-status scope-error' role='alert'>
        {featureDataErrorMessage(locDensityQuery.error,UI_COPY)}</p>:null}
      {!query.isPending&&!locDensityQuery.isPending&&!query.error&&!locDensityQuery.error
        &&!locScopePreview.scopeIds.length
        ?<p className='scope-status'>目前沒有可顯示的 Scope。</p>:null}
      {locScopePreview.groups.length?<CultureTimeline
        items={locScopePreview.items}
        extraGroups={locScopePreview.groups}
        onGroupToggle={toggleLocScopeGroup}
        labelOf={emptyRiverLabel}
        focus={EMPTY_RIVER_FOCUS}
        mode='source'
        windowStart={locSourceStart}
        windowEnd={locSourceEnd}
        fixedMin={locSourceStart}
        fixedMax={locSourceEnd}
        naturalSourceHeight
        readOnlyViewport
      />:null}
      {locScopePreview.scopeIds.length?<nav className='scope-result-links' aria-label='各 Scope 文化詳情'>
        {locScopePreview.scopeIds.map(id=><ScopeLink key={id} href={featureNavigationHref(id,'culture')}>
          {id} · 查看完整文化
        </ScopeLink>)}
      </nav>:null}
    </section>
  </FeaturePage>;

  return <FeaturePage featureId="culture">
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      {scopeId==='loc'?<div className='scope-stat-controls'><label><span>{UI_COPY.culture.viewMode}</span>
        <select className='scope-select' aria-label={UI_COPY.culture.viewMode} value={locCultureView} onChange={event=>setLocCultureView(event.target.value)}>
          <option value='period'><UiText id="uiExtra.cultureView.periodIntersectionWorks"/></option>
          <option value='item'><UiText id="uiExtra.cultureView.itemIntersectionTwoRivers"/></option>
        </select>
      </label></div>:null}
      {isLocItemView?<LocItemConfluence/>:<>
      <p className='loc-eyebrow'>{UI_COPY.culture.distribution}</p>
      <h2>{UI_COPY.culture.river}</h2>
      {query.isPending?<div className="loc-progressive-river-frame" role="status" aria-busy="true">
        <span>{UI_COPY.common.loading}</span><div className="loc-progressive-river-axis" aria-hidden="true"/>
      </div>:null}
      {query.error?<p className='scope-status scope-error'>{featureDataErrorMessage(query.error,UI_COPY)}</p>:null}
      {!query.isPending&&!query.error&&!hasTimelineSurface?<p className='scope-status'>{UI_COPY.uiExtra.dataErrors.empty}</p>:null}
      {!query.isPending&&!query.error&&hasTimelineSurface?<>


            {isAggregateScope?<>

              <section className='scope-card scope-culture-classification-river scope-loc-time-river'>
                <p className='loc-eyebrow'>{UI_COPY.culture.distribution}</p>
                <h3>各 Scope 時間區間</h3>
                {locScopeIntervalItems.length?<CultureTimeline
                  items={locScopeIntervalItems}
                  labelOf={emptyRiverLabel}
                  focus={EMPTY_RIVER_FOCUS}
                  mode='source'
                  windowStart={locSourceStart}
                  windowEnd={locSourceEnd}
                  fixedMin={locDistributionStart}
                  fixedMax={locDistributionEnd}
                />:null}
                {!locIntersectionScopeIds.length&&query.data?.scopes?.length
                  ?<p className='scope-status' role='status'>目前各 Scope 的時代／時期沒有共同時間區間（單一定錨點亦計入）。</p>:null}
                <div className='scope-result-links'>
                  {[...new Set(locScopeIntervalItems.map(item=>item.scope_id))].map(id=><ScopeLink key={id} href={featureNavigationHref(id,'culture')}>{id}{l.personalTimelineSuffix}</ScopeLink>)}
                </div>
                {query.data?.scopes?.length?<details className='scope-stat-details scope-culture-density-details'
                  onToggle={event=>setLocDensityOpen(event.currentTarget.open)}>
                  <summary>{UI_COPY.culture.intersectionRiver} · {UI_COPY.culture.combinedRiver}</summary>
                  {locDensityOpen?<>
                    {locDensityQuery.isPending?<p className='scope-status' role='status'>{UI_COPY.common.loading}</p>:null}
                    {locDensityQuery.error?<p className='scope-status scope-error'>{featureDataErrorMessage(locDensityQuery.error,UI_COPY)}</p>:null}
                {locScopeRiverItems.length?<section className='scope-culture-interval-density'>
                  <h4>{UI_COPY.culture.intersectionRiver}</h4>
                  <CultureTimeline
                    items={locScopeRiverItems}
                    labelOf={emptyRiverLabel}
                    focus={EMPTY_RIVER_FOCUS}
                    mode='source'
                    windowStart={locSourceStart}
                    windowEnd={locSourceEnd}
                    fixedMin={locIntersectionStart}
                    fixedMax={locIntersectionEnd}
                    hiddenDates={locRiverAnalysis.hiddenDates}
                  />
                </section>:null}
                {locCombinedSourceRiverItems.length?<section className='scope-culture-combined-source-river'>
                  <p className='loc-eyebrow'>{UI_COPY.culture.combinedSources}</p>
                  <h4>{UI_COPY.culture.combinedRiver}</h4>
                  <CultureTimeline
                    items={locCombinedSourceRiverItems}
                    labelOf={emptyRiverLabel}
                    focus={EMPTY_RIVER_FOCUS}
                    mode='source'
                    windowStart={locSourceStart}
                    windowEnd={locSourceEnd}
                    fixedMin={locDistributionStart}
                    fixedMax={locDistributionEnd}
                    hiddenDates={locRiverAnalysis.hiddenDates}
                  />
                </section>:null}
                  </>:null}
                </details>:null}

              </section>


            </>:<>
              <section className='scope-card scope-culture-classification-river'>
                <div className='scope-culture-river-toolbar'>
                  <h3>時間與作品｜{classificationPeriodLabel}</h3>
                  <div className='scope-culture-river-selectors'>
                    <div className='scope-culture-time-picker'>
                      <label><span>時代</span>
                        <select className='scope-select' aria-label='選擇時代'
                          value={keywordEraKey} onChange={event=>{
                            const next=event.target.value;
                            if(next==='custom'){
                              if(!keywordCustomStart)setKeywordCustomStart(keywordWindowStart);
                              if(!keywordCustomEnd)setKeywordCustomEnd(keywordWindowEnd);
                            }
                            prepareTransientResourceAction('period',{queryKeys:[
                              ['culture-article-list',classificationScope],
                              ['culture-river-root',classificationScope]
                            ]});
                            setWorksOpen(false);
                            setKeywordEraKey(next);
                            setKeywordPeriodKey(next==='__unassigned__'?'all':next);
                            setSelectedPeriodKey(next);
                          }}>
                          <option value='year'>{DEFAULT_YEAR_WINDOW.label}</option>
                          <option value='latest'>{primaryPeriods.length?l.recentTimeTrace:'未設定時代'}</option>
                          <option value='all'>{primaryPeriods.length?l.allTimeTraces:'本年度（未設定時代）'}</option>
                          {secondRiverHierarchy.groups.map(group=><option
                            key={periodKey(group.era)} value={periodKey(group.era)}>
                            {localizedLabelOf(group.era,0)}
                          </option>)}
                          {secondRiverHierarchy.unassigned.length?<option value='__unassigned__'>未歸屬時代的期間</option>:null}
                          <option value='custom'>{l.customPeriod}</option>
                        </select>
                      </label>
                      {activeSecondEra||keywordEraKey==='__unassigned__'?<label>
                        <span>期間</span>
                        <select className='scope-select' aria-label='選擇期間'
                          value={activeSecondPeriods.some(row=>periodKey(row)===keywordPeriodKey)
                            ?keywordPeriodKey:'__era__'}
                          onChange={event=>{
                            prepareTransientResourceAction('period',{queryKeys:[
                              ['culture-article-list',classificationScope],
                              ['culture-river-root',classificationScope]
                            ]});
                            setWorksOpen(false);
                            const nextPeriod=event.target.value==='__era__'
                              ?(activeSecondEra?periodKey(activeSecondEra.era):'all')
                              :event.target.value;
                            setKeywordPeriodKey(nextPeriod);
                            setSelectedPeriodKey(nextPeriod);
                          }}>
                          <option value='__era__'>{activeSecondEra?'整個時代':'全部未歸屬期間'}</option>
                          {activeSecondPeriods.map(period=><option key={periodKey(period)}
                            value={periodKey(period)}>{localizedLabelOf(period,0)}</option>)}
                        </select>
                      </label>:null}
                    </div>
                    <label><span>文章選項</span>
                      <select className='scope-select' aria-label='文章選項'
                        value={styleFilter==='none'&&sourceStyleOptions.some(item=>item.key===selectedRiverGroup)
                          ?'source:'+selectedRiverGroup:styleFilter}
                        onChange={event=>{
                          const next=event.target.value;
                          const choice=next.startsWith('source:')
                            ?sourceStyleOptions.find(item=>'source:'+item.key===next):null;
                          if(choice){
                            // Sources use the existing numeric Source River. Never
                            // misinterpret an Anchor From as a Keyword Class UID.
                            setStyleFilter('none');
                            setSelectedRiverGroup(choice.key);
                            setSelectedCategory('');
                            setWorksOpen(false);
                            const ancestorUids=(sourceTaxonomy?.tree||[])
                              .find(node=>node.uid===choice.code)?.path?.slice(0,-1)||[];
                            const hasChildren=(sourceTaxonomy?.tree||[])
                              .some(node=>node.parentUid===choice.code);
                            setOpenCultureRoots(current=>[...new Set([
                              ...current,...ancestorUids,...(hasChildren?[choice.code]:[])
                            ])]);
                          }else if(!next.startsWith('source:')){
                            setStyleFilter(next);
                            if(next==='none')setSelectedRiverGroup('');
                          }
                          setKeywordDrillGroup('');
                        }}>
                        <option value='none'>來源</option>
                        <option value='trace'>地點</option>
                        <optgroup label='關鍵詞'>
                          <option value='rune66'>{selectedKeywordClass?.name||l.keywordStyle}</option>
                        </optgroup>
                        {sourceStyleGroups.map(group=><optgroup
                          key={group.key} label={group.label}>
                          {group.items.map(item=><option key={item.key} value={'source:'+item.key}>
                            {'\u00a0\u00a0\u00a0'.repeat(item.orphanType
                              ?Math.max(0,item.level-['universe','galaxy','domain','from'].indexOf(item.orphanType))
                              :item.level)}{item.label}
                          </option>)}
                        </optgroup>)}
                      </select>
                    </label>
                    {keywordPeriodKey==='custom'?<>
                      <label><span>{l.period}</span><input className='scope-select' aria-label={l.customPeriod} type='date'
                        value={keywordCustomStart} max={keywordCustomEnd||undefined}
                        onChange={event=>setKeywordCustomStart(event.target.value)}/></label>
                      <label><span>～</span><input className='scope-select' aria-label={l.customPeriod} type='date'
                        value={keywordCustomEnd} min={keywordCustomStart||undefined}
                        onChange={event=>setKeywordCustomEnd(event.target.value)}/></label>
                    </>:null}
                  </div>
                  {usesSourceRiver&&riverRangeLoading?<div className="loc-progressive-river-frame" role="status" aria-busy="true">
                    <CultureTimeLoading label={UI_COPY.common.loading}/><div className="loc-progressive-river-axis" aria-hidden="true"/>
                    <small>{classificationWindowStart} ～ {classificationWindowEnd}</small>
                  </div>:null}
                  {riverAnalysis.error?<span className='scope-status scope-error' role='status'>{riverAnalysis.error}</span>:null}
                </div>
                {styleFilter==='rune66'?<section className='scope-culture-style-filter'>
                  <p className='loc-eyebrow'>關鍵詞｜{String(styleQuery.data?.keywordMeta?.class_name||selectedKeywordClass?.name||'尚未設定')}</p>
                  {availableKeywordClasses.length>0?<label className='scope-culture-keyword-class-picker'>
                    <span>關鍵字群組</span>
                    <select className='scope-select' aria-label='關鍵字群組'
                      value={resolvedKeywordClassUid} onChange={event=>{
                        setSelectedKeywordClassUid(event.target.value);
                        setKeywordDrillSource('');
                        setKeywordDrillGroup('');
                      }}>
                      {availableKeywordClasses.map(item=><option key={item.classUid} value={item.classUid}>{[item.categoryName,item.name].filter(Boolean).join('／')}</option>)}
                    </select>
                  </label>:null}
                  <div className='scope-stat-controls'>
                    {keywordDrillGroup?<button type='button' className='loc-button' onClick={()=>setKeywordDrillGroup('')}>← 返回群組總覽</button>
                      :keywordDrillSource?<button type='button' className='loc-button' onClick={()=>setKeywordDrillSource('')}>← 返回全部來源</button>:null}
                    <span className='scope-status' aria-live='polite'>
                      {classificationPeriodLabel} → {keywordDrillSource||'全部來源'} → {keywordDrillGroup
                        ?String(styleQuery.data?.keywordMeta?.classes?.[keywordDrillGroup]||'群組')+' · 符文列表'
                        :'全部群組'}
                    </span>
                  </div>
                  <h4>{keywordDrillGroup?'符文列表｜'+String(styleQuery.data?.keywordMeta?.classes?.[keywordDrillGroup]||'群組'):'符文群組（點選河道左側名稱展開）'}</h4>
                  {!keywordWindowValid?<p className='scope-status scope-error' role='status'>請選擇有效的時間區間。</p>:null}
                  {styleRiverAnalysis.suggestions.length>0?<details className='scope-culture-lucus-picker'>
                    <summary>風格密度建議定錨點：{styleRiverAnalysis.suggestions.length} 個（點開查看）</summary>
                    {styleRiverAnalysis.suggestions.length?<div className='scope-culture-lucus-choices'>
                      {styleRiverAnalysis.suggestions.map(item=>{
                        // Deep-link straight to the protected TimeAnchor
                        // editor, not the public Culture view (?edit=1 alone
                        // does not authorize or mount that editor).
                        const href=scopeHref(scopeId,
                          'culture/manage?edit=1&anchorDate='+encodeURIComponent(item.date));
                        return <div key={item.date} className='scope-status'>
                          <strong>{item.date}</strong>
                          <span>｜前 3 日 {Number(item.beforeCount||0).toLocaleString(locale)} 次／後 3 日 {Number(item.afterCount||0).toLocaleString(locale)} 次</span>
                          {(item.analysis||[]).length?<span>｜{item.analysis.join(' ')}</span>:null}
                          {canUseScopeEditor?<span>｜<ScopeLink href={href}>前往時間編輯，確認定錨點</ScopeLink></span>:null}
                        </div>;
                      })}
                    </div>:<p className='scope-status'>此時間區間暫無足夠的風格密度變化，或分析資料尚在載入。</p>}
                  </details>:null}
                  {styleQuery.error?<p className='scope-status scope-error'>{featureDataErrorMessage(styleQuery.error,UI_COPY)}</p>:null}
                  {!styleQuery.isPending&&!styleQuery.error&&!styleQuery.data?.staticstime?<p className='scope-status'>關鍵詞尚未定錨；請先於關鍵詞設定完成分析。</p>:null}
                  {!styleQuery.isPending&&!styleQuery.error&&styleQuery.data?.staticstime&&!styleQuery.data?.statisticsEnabled?<p className='scope-status'>目前關鍵詞統計尚未啟用。</p>:null}
                  {keywordDetailRequested&&keywordDensityQuery.isPending&&styleQuery.data?.statisticsEnabled
                    ?<p className='scope-status' role='status'>正在讀取所選來源／群組的文章屬性…</p>:null}
                  {keywordDrillGroup&&keywordGroupCatalogQuery.isPending?<p className='scope-status' role='status'>正在載入所選群組的符文列表…</p>:null}
                  {keywordRiverError||keywordGroupCatalogQuery.error
                    ?<p className='scope-status scope-error'>{featureDataErrorMessage(keywordRiverError||keywordGroupCatalogQuery.error,UI_COPY)}</p>:null}
                  {!keywordRiverPending&&(!keywordDrillGroup||!keywordGroupCatalogQuery.isPending)
                    &&!keywordRiverError&&!styleQuery.error&&!keywordGroupCatalogQuery.error&&!keywordDrillItems.length
                    ?<p className='scope-status'>此範圍沒有可顯示的命中資料。</p>:null}
                </section>:null}
                {styleFilter==='trace'&&classificationWindowValid?<CulturePlaceRiver
                  scopeId={scopeId} startDate={classificationWindowStart} endDate={classificationWindowEnd}/>:null}
                {!classificationWindowValid&&optionalTimeRangeUnfilled?<p className='scope-status' role='status'>尚未選擇時間範圍；可使用時代、期間或自訂日期。</p>:null}
                {!classificationWindowValid&&!optionalTimeRangeUnfilled?<p className='scope-status scope-error' role='status'>請選擇有效的時間區間（起始日期不得晚於結束日期）。</p>:null}
                {usesSourceRiver&&sourceRootQuery.error?<p className='scope-status scope-error'>{featureDataErrorMessage(sourceRootQuery.error,UI_COPY)}</p>:null}
                {usesSourceRiver&&sourceSnapshotQuery.error
                   ?<p className='scope-status scope-error' role='alert'>
                     {featureDataErrorMessage(sourceSnapshotQuery.error,UI_COPY)}</p>:null}
                 {usesSourceRiver&&stagedSourceRiver&&openCultureRoots.length>0
                   &&sourceSnapshotQuery.isPending
                   ?<p className='scope-status' role='status'>正在展開河道的細部分布…</p>:null}
                 {/* Anchor suggestions never compute on their own just because a lane's
                     daily data arrived -- the PELT worker only runs once the user
                     explicitly clicks open the "建議定錨點" lane itself on the chart
                     above (see the dual:source:candidates group / onGroupToggle).
                     This panel is just the detail view for an already-opened lane. */}
                 {usesSourceRiver&&!riverRangeLoading&&anchorSuggestOpen?<div className='scope-culture-lucus-actions'>
                  {riverAnalysis.suggestions.length>0?<>
                    <span>{formatCultureUi(l.candidateSummary,{count:riverAnalysis.suggestions.length})}</span>
                    {canUseScopeEditor?<button type='button' className='loc-button' disabled={creatingSuggestedAnchors||!selectedVirtualAnchorDates.length}
                      onClick={createSelectedSuggestedAnchors}>
                      {creatingSuggestedAnchors?'正在新增…':'新增選取的建議定錨點（'+selectedVirtualAnchorDates.length+'）'}
                    </button>:null}
                    {editError?<p className='scope-status scope-error' role='alert'>{editError}</p>:null}
                    <details className='scope-culture-lucus-picker' open>
                      <summary><span className='scope-culture-lucus-picker-mark' aria-hidden='true'/><UiText id="uiExtra.cultureView.expandToCompareWorkVolumeChanges"/></summary>
                      <div className='scope-culture-lucus-choices'>
                        {riverAnalysis.suggestions.map(item=>{
                          const href=scopeHref(scopeId,
                            'culture/manage?edit=1&anchorDate='+encodeURIComponent(item.date));
                          return <div key={item.date} className='scope-status'>
                            {canUseScopeEditor?<label><input type='checkbox' checked={selectedVirtualAnchorDates.includes(item.date)}
                              onChange={()=>toggleVirtualAnchor(item.date)}/>
                              {formatCultureUi(l.candidateComparison,{date:item.date,before:Number(item.beforeCount||0).toLocaleString(locale),after:Number(item.afterCount||0).toLocaleString(locale),analysis:(item.analysis||[]).join(' ')})}
                            </label>:<span>{formatCultureUi(l.candidateComparison,{date:item.date,before:Number(item.beforeCount||0).toLocaleString(locale),after:Number(item.afterCount||0).toLocaleString(locale),analysis:(item.analysis||[]).join(' ')})}</span>}
                            {canUseScopeEditor?<ScopeLink href={href}>前往時間編輯</ScopeLink>:null}
                          </div>;
                        })}
                      </div>
                    </details>
                  </>:<p className='scope-status' role='status'>正在分析建議定錨點…</p>}
                </div>:null}
                {usesSourceRiver&&classificationWindowValid&&!(stagedSourceRiver?sourceRootQuery.error:sourceSnapshotQuery.error)
                  &&(stagedSourceRiver?sourceRootQuery.data:sourceSnapshotQuery.data)
                  &&!cultureRiver.hasSourceData
                  ?<div className='scope-card scope-status scope-culture-no-data' role='status'>{l.noDataInPeriod}</div>:null}
                {classificationWindowValid&&(integratedCultureRiver.items.length||integratedCultureRiver.groups.length)
                  ?<div className='scope-culture-double-river scope-culture-integrated-river'
                    aria-label='時代、期間、定錨點與作品來源密度時間長河'>
                    <CultureTimeline
                    items={integratedCultureRiver.items}
                    extraGroups={integratedCultureRiver.groups}
                    onGroupToggle={id=>id.startsWith('dual:')
                      ?toggleCultureRiverGroup(id):toggleTimeTrace(id)}
                    onGroupSelect={id=>id.startsWith('dual:')?selectCultureRiverGroup(id):null}
                    anchorInsight={anchorInsight}
                    anchorLabels={{date:l.candidateDate,before:l.candidateBefore,after:l.candidateAfter,reason:l.candidateReason,close:l.candidateClose}}
                    onAnchorClose={()=>setFocusedAnchorDate('')}
                    heightVariant='double'
                    labelOf={classificationRiverLabel}
                    focus={navigation}
                    mode='trace'
                    windowStart={classificationWindowStart}
                    windowEnd={classificationWindowEnd}
                    hiddenDates={riverAnalysis.hiddenDates}
                    onSelect={item=>{
                      if(['era','period','anchor'].includes(item?.entryType)){
                        setSelectedTimelineInfo(item||null);
                        return;
                      }
                      setSelectedTimelineInfo(null);
                      if(item?.entryType==='virtual_anchor'){
                        const date=String(item?.start||'').slice(0,10);
                        setFocusedAnchorDate(date);
                        toggleVirtualAnchor(date);
                        return;
                      }
                      if(item?.entryType==='keyword_density'){
                        const key=String(item?.raw?.drill_key||'').trim();
                        if(key&&keywordGroupOptions.some(group=>group.id===key))
                          setKeywordDrillGroup(current=>current===key?'':key);
                        return;
                      }
                      if(item?.entryType==='source_group'){
                        setSelectedRiverGroup(String(item.raw?.source_group_code||''));
                        setSelectedCategory('');
                        setWorksOpen(false);
                        return;
                      }
                      if(item?.entryType!=='source')return;
                      const term=String(item?.raw?.category||'').trim();
                      const key='source:'+term;
                      if(term&&categoryGroups.some(group=>group.category_key===key)){
                        setSelectedRiverGroup('');
                        setSelectedCategory(key);
                      }
                    }}/>
                    {selectedTimelineInfo?<div className='scope-card scope-culture-timeline-selection' role='status'>
                      <strong>{selectedTimelineInfo.raw?.title||selectedTimelineInfo.content||selectedTimelineInfo.raw?.display_label||selectedTimelineInfo.title||translateUiField(locale,'時間長河紀錄')}</strong>
                      <p className='scope-status'>{String(selectedTimelineInfo.start||'').slice(0,10)}{selectedTimelineInfo.end?' ～ '+String(selectedTimelineInfo.end).slice(0,10):''}</p>
                      {selectedTimelineInfo.title?<p>{selectedTimelineInfo.title}</p>:null}
                    </div>:null}
                  {showKeywordRiver&&keywordDrillGroup?<section className='scope-culture-rune-list'
                    role='region' aria-label={(styleQuery.data?.keywordMeta?.classes?.[keywordDrillGroup]||'符文群組')+'符文列表'}>
                    <header>
                      <strong>{styleQuery.data?.keywordMeta?.classes?.[keywordDrillGroup]||'群組'}｜符文列表</strong>
                      <button className='loc-button' type='button' onClick={()=>setKeywordDrillGroup('')}>收合符文列表</button>
                    </header>
                    {keywordGroupCatalogQuery.isPending?<p className='scope-status' role='status'>正在載入此群組的符文…</p>:null}
                    {keywordGroupCatalogQuery.error?<p className='scope-status scope-error' role='alert'>{featureDataErrorMessage(keywordGroupCatalogQuery.error,UI_COPY)}</p>:null}
                    {keywordGroupCatalogQuery.data?.length?<ul>
                      {keywordGroupCatalogQuery.data.map(rune=>{
                        const matched=(styleQuery.data?.runeTotals||[]).find(item=>String(item.uid)===String(rune.uid));
                        return <li key={rune.uid}>
                          <strong>{rune.name}</strong>
                          <span>{Number(matched?.count||0).toLocaleString(locale)} 次命中</span>
                        </li>;
                      })}
                    </ul>:null}
                    {keywordGroupCatalogQuery.data&&!keywordGroupCatalogQuery.data.length
                      ?<p className='scope-status'>此群組目前沒有符文項目。</p>:null}
                  </section>:null}
                </div>:null}
                {styleFilter==='none'&&selectedGroup&&!worksOpen?<button
                  type='button' className='loc-button scope-culture-show-articles'
                  onClick={()=>setWorksOpen(true)}>
                  {selectedGroup.label||selectedGroup.site||'來源'}｜顯示相關文章列表
                </button>:null}
                {styleFilter==='none'&&(!(stagedSourceRiver?sourceRootQuery.error:sourceSnapshotQuery.error)
                  &&(stagedSourceRiver?sourceRootQuery.data:sourceSnapshotQuery.data)&&cultureRiver.hasSourceData)?<details className='scope-culture-source-detail' open={worksOpen} onToggle={event=>setWorksOpen(event.currentTarget.open)}>
                  <summary>顯示相關文章列表</summary>
                  {worksOpen?<><header className="loc-public-list-header">
                    {selectedGroup?<button type='button' className='scope-pagination-button' onClick={()=>setSelectedCategory('')}>{UI_COPY.culture.showAllWorks}</button>:<span/>}
                    <ArticleSortSelect value={articleSort} onChange={setArticleSort} disabled={Boolean(editingWorkKey)}/>
                  </header>
                  {periodWorksPage.error?<p className='scope-status scope-error'>{featureDataErrorMessage(periodWorksPage.error,UI_COPY)} <button type='button' className='loc-button' onClick={periodWorksPage.reload}><UiText id="uiExtra.cultureView.reloadWorks"/></button></p>:null}
                  {periodWorksPage.loading&&!visibleWorkRows.length?<p role='status' className='scope-status'>{l.loadingPeriodWorks}</p>:null}
                  <IncrementalList
                    items={visibleWorkRows}
                    batchSize={DEFAULT_LIST_BATCH_SIZE}
                    resetKey={classificationWindowStart+'|'+classificationWindowEnd+'|'+selectedCategory+'|'+selectedRiverGroup+'|source|'+articleSort}
                    className='scope-culture-source-work-scroll loc-public-article-list'
                    externalHasMore={periodWorksPage.hasMore}
                    loading={periodWorksPage.loading}
                    error={periodWorksPage.error}
                    onLoadMore={periodWorksPage.loadNext}
                    scrollRootRef={workScrollRef}
                    renderItem={(work,index)=>{
                      const workKey=String(work.key||('galaxy:'+work.uid));
                      if(work.hidden)return <div key={workKey+'-'+index}
                        className='scope-work-list-row scope-status'>本文已隱藏</div>;
                      const detail=fullTextKey===workKey&&!fullTextLoading&&
                        String(fullDetail?.uid||'')===String(work.uid)?fullDetail:null;
                      return <Article key={workKey+'-'+index}
                        uid={work.uid} title={work.title||'未命名文章'}
                        articleHref={galaxyIdentityHref(scopeId,work.uid)}
                        date={work.date} source={detail?.site||work.site||''}
                        detailReading={Boolean(detail)}
                        relationLinks={detail?galaxyRelationLinks(scopeId,detail):[]}
                        relatedMedia={detail?.related_media||[]}
                        relatedTime={detail?.related_time||null}
                        relatedSpace={detail?.related_space||null}
                        relatedStatistics={detail?.related_statistics||null}
                        articleScopeId={scopeId}
                        articleDate={detail?.article_day||detail?.date||work.date||''}
                        articleCreateTime={detail?.createtime||work.createtime||''}
                        tracePlace={detail?.trace_place||null}
                        traceHref={detail?.trace_place
                          ?featureNavigationHref(scopeId,'trace',{place:detail.trace_place.uid}):''}
                        locationName={detail?.location||''}
                        links={detail?.links||[]}
                        editOnCardClick={false}>
                        {work.extract===true?<WorkFullText
                          open={fullTextKey===workKey}
                          loading={fullTextLoading&&fullTextKey===workKey}
                          error={fullTextKey===workKey?fullTextError:''}
                          content={fullTextKey===workKey?fullText:''}
                          onToggle={()=>toggleWorkContent(work)}
                        />:<span className='scope-status'>僅顯示列表，禁止閱讀全文</span>}
                      </Article>;
                    }}
                  />
                  {!periodWorksPage.loading&&!periodWorksPage.error&&!visibleWorkRows.length?<p className='scope-status'>{UI_COPY.uiExtra.dataErrors.empty}</p>:null}
                  </>:null}
                </details>:null}
              </section>
            </>}
      </>:null}
      </>}
    </section>
  </FeaturePage>;
}
