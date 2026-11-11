'use client';
import UiText from '../../i18n/UiText';
import FieldText from '../../i18n/FieldText';

import {translateUiField,UI_COPY,registerDefaultSection} from '../../i18n/ui-copy';
import {useUiCopy,useUiLocale,useUiSection} from '../../i18n/ui-locale';
import cultureZh from '../../i18n/sections/culture.zh_tw.js';
import cultureViewZh from '../../i18n/sections/uiExtra.cultureView.zh_tw.js';
import dataErrorsZh from '../../i18n/sections/uiExtra.dataErrors.zh_tw.js';
import paginationZh from '../../i18n/sections/uiExtra.pagination.zh_tw.js';
registerDefaultSection('culture',cultureZh);
registerDefaultSection('uiExtra.cultureView',cultureViewZh);
registerDefaultSection('uiExtra.dataErrors',dataErrorsZh);
registerDefaultSection('uiExtra.pagination',paginationZh);

import {useEffect,useMemo,useRef,useState} from 'react';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import {cultureDensityByUnit,simpleTimeRiver} from '../../loc/loc-feature-preferences.mjs';
import dynamic from 'next/dynamic';
import {usePathname,useSearchParams} from 'next/navigation';
import {useAsyncResource,useAsyncInfiniteResource,useResourceCache} from '../../loc/use-async-resource';
import {featureNavigationHref,galaxyIdentityHref,galaxyRelationLinks,readFeatureNavigation} from '../feature-navigation';
import ScopeLink from '../ScopeLink';
import {useEditDock} from '../edit-dock';
import {featureDataErrorMessage} from '../feature-data-state';
const CultureTimeline=dynamic(()=>import('../modules/culture-timeline/CultureTimeline'),{loading:()=>null});
import {CultureTimelineModel} from '../modules/culture-timeline/culture-timeline-model';
import {useRiverDensityAnalysis} from '../modules/culture-timeline/use-river-density-analysis';
import {structurePeriodPreference} from '../../loc/culture-period-navigation.mjs';
import {buildEraRiver} from '../../loc/culture-time-trace-river.mjs';
import {allocateTimeUid,timePeriodContainsDate,timePeriodSortDate} from '../../loc/time-anchor-ranges.mjs';

import {selectGalaxyIdentity,selectScopeDailyCounts} from '../../loc/galaxy-query';
import {revalidateServerMetadata} from '../../loc/scope-data';

import {deleteRows,insertRows,updateRows} from '../../loc/db-client.mjs';
import {selectAllRows,selectRows} from '../../loc/db-query.mjs';
import {assignedSource} from '../../loc/member-intersection-model.mjs';
import {DEFAULT_YEAR_WINDOW} from '../../loc/default-year-window.mjs';
import {sourceKeywordOptions} from '../../loc/source-keyword-options.mjs';
import {buildCultureRiverRootPayload,selectCultureRiverChildren} from '../../loc/culture-river-roots.mjs';
import {mediaDay} from '../../loc/statistics-facets';
import {useAccount} from '../../loc/use-account';
import {useScopeRuntime} from '../use-scope-runtime';
import {ArticleSortSelect,FeaturePage,IncrementalList,WorkFullText} from '../ui';
import ManagementWorkspaceFrame from '../../loc/ManagementWorkspaceFrame';
// Article cards/editing are requested only when results actually render.
const Article=dynamic(()=>import('../Article'),{loading:()=>null});
const CultureTimelineEditor=dynamic(()=>import('./CultureTimelineEditor'),{loading:()=>null});
const CulturePlaceRiver=dynamic(()=>import('./trace/CulturePlaceRiver'),{loading:()=>null});
import {workDisplayHeading,workDisplayText} from '../work-display-model';
import {DEFAULT_LIST_BATCH_SIZE} from '../../loc/db-contract.mjs';
import {publicContentFilters,requireGalaxyContent,resolveGalaxyTitle} from '../../loc/content-policy';
const LrunesDailyCulturePanel=dynamic(()=>import('../../lrunes/DailyRuneAnalytics').then(m=>m.LrunesDailyCulturePanel),{loading:()=>null});
const LocItemConfluence=dynamic(()=>import('./LocItemConfluence'),{loading:()=>null});

function editorRiverYearWindow(){
  return {start:DEFAULT_YEAR_WINDOW.startDate,end:DEFAULT_YEAR_WINDOW.endDate};
}
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
  return item?.entry_type==='virtual_anchor'?(item.display_label||'◇'):'';
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
  return String(item?.period||item?.era_id||item?.id||'').trim();
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
// Paint the collapsed source overview from the numeric totals already in memory.
// vis-timeline is mounted only after a category is expanded, not for three
// full-window total bars that do not require virtualized time-axis layout.
function CultureSourceRootSummary({items,groups,windowStart,windowEnd,onGroupToggle,onGroupSelect}){
  const totals=items.filter(item=>item.entry_type==='source_total');
  const byGroup=new Map(totals.map(item=>[item.group_key,item]));
  const largest=Math.max(1,...totals.map(item=>Number(item.item_count)||0));
  return <div className='scope-period-timeline-wrap'>
    <div className='scope-period-timeline' role='region' aria-label='作品分類總量時間長河'
      style={{minHeight:0,overflow:'visible',padding:'.65rem',background:'var(--loc-panel)'}}>
      <div style={{display:'grid',gridTemplateColumns:'clamp(108px,23vw,248px) minmax(0,1fr)',gap:'.4rem .55rem',alignItems:'center'}}>
        <span className='scope-status'>分類總量</span>
        <div style={{display:'flex',justifyContent:'space-between',gap:'.5rem',fontSize:'.8rem',color:'var(--loc-muted)'}}>
          <time>{windowStart}</time><time>{windowEnd}</time>
        </div>
        {groups.map(group=>{
          const row=byGroup.get(group.id);
          const candidate=group.id==='dual:source:candidates';
          if(!row&&!candidate)return null;
          const count=Number(row?.item_count)||0;
          const action=group.collapsible?()=>onGroupToggle?.(group.id)
            :group.selectable?()=>onGroupSelect?.(group.id):null;
          return <div key={group.id} className={row?'scope-dual-river-root':'scope-candidate-lane'} style={{display:'contents'}}>
            <div style={{minWidth:0}}>
              {action?<button type='button' className='scope-river-group-button'
                aria-expanded={group.collapsible?Boolean(group.expanded):undefined} onClick={action}>
                {group.collapsible?'＋  ':''}{group.label}
              </button>:<span>{group.label}</span>}
            </div>
            <div style={{minWidth:0,minHeight:candidate?32:40,display:'flex',alignItems:'center',padding:'.35rem .45rem',
              border:'1px solid var(--loc-line)',borderRadius:'.5rem',background:'var(--loc-panel-2)'}}
              role={row?'img':undefined} aria-label={row?group.label+'，'+count+'筆':''}>
              {row?<div style={{width:'100%',height:Math.max(11,Math.round(11+19*count/largest)),
                borderRadius:'999px',background:'var(--loc-accent)',
                opacity:Math.max(.38,Math.min(1,count/largest)),boxShadow:'0 0 9px var(--loc-accent-border)'}}/>:null}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
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
  const {settings:userSettings,active:userActive}=useLocFeatureSettings('culture');
  // A list editor is offered only after the user opts in; authorization stays on Edit.
  const adminListRequested=Boolean(userActive&&userSettings.list===true);
  const [worksOpen,setWorksOpen]=useState(false);
  const searchParams=useSearchParams();
  const editDock=useEditDock();
  const canUseScopeEditor=Boolean(editDock?.active&&editDock.scopeId===scopeId);
  const pathname=usePathname()||'';
  const isTimeEditingView=canUseScopeEditor&&(pathname.endsWith('/culture/manage')||
    pathname.endsWith('/culture/manage/')||searchParams?.get('edit')==='1');
  // Public Culture does not load management grants; editing must verify them.
  const account=useAccount({enabled:isTimeEditingView||canUseScopeEditor});
  const [lrunesView,setLrunesView]=useState('daily');
  const [locCultureView,setLocCultureView]=useState('period');
  const [locDensityOpen,setLocDensityOpen]=useState(false);
  const isLrunesDaily=!isTimeEditingView&&scopeId==='lrunes'&&lrunesView==='daily';
  const isLocItemView=scopeId==='loc'&&locCultureView==='item';
  const resourceCache=useResourceCache();
  const navigation=useMemo(()=>readFeatureNavigation(searchParams),[searchParams]);
  const query=useAsyncResource({
    queryKey:['culture-timeline',scopeId],
    queryFn:async()=>{
      const {selectScopeCultureData}=await import('../../loc/culture-query');
      return selectScopeCultureData(scopeId);
    },
    enabled:!isLrunesDaily&&!isLocItemView,
  });

  const [selectedPeriodKey,setSelectedPeriodKey]=useState('year');
  const [structureWindowKey,setStructureWindowKey]=useState('');
  const [expandedEraIds,setExpandedEraIds]=useState([]);
  const [expandedEditorEraIds,setExpandedEditorEraIds]=useState([]);
  const periodSelectionScopeRef=useRef('');
  const [selectedCategory,setSelectedCategory]=useState('');
  const [articleSort,setArticleSort]=useState('desc');
  useEffect(()=>setArticleSort(userActive?userSettings.sort:'desc'),[userActive,userSettings.sort]);
  // Keyword Class is optional; ordinary Time River views must not scan the whole article corpus.
  const [styleFilter,setStyleFilter]=useState('none');
  const [selectedKeywordClassUid,setSelectedKeywordClassUid]=useState('');
  const [keywordDrillSource,setKeywordDrillSource]=useState('');
  const [keywordDrillGroup,setKeywordDrillGroup]=useState('');
  const [keywordPeriodKey,setKeywordPeriodKey]=useState('year');
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
  const [editingWorkKey,setEditingWorkKey]=useState('');
  const [authorizedWorkKey,setAuthorizedWorkKey]=useState('');
  const [selectedTimelineRecordId,setSelectedTimelineRecordId]=useState('');
  const [selectedTimelineInfo,setSelectedTimelineInfo]=useState(null);
  const [selectedTimelineDate,setSelectedTimelineDate]=useState('');
  const [timelineEditorRevision,setTimelineEditorRevision]=useState(0);
  // Opening the time editor is a UI action, not an authorization check.
  // Verify the active user only when a write is actually requested.
  const [suggestedRecordType,setSuggestedRecordType]=useState('anchor');
  const [suggestedRequestNonce,setSuggestedRequestNonce]=useState(0);
  const [editDraft,setEditDraft]=useState(null);
  const [editBusy,setEditBusy]=useState(false);
  const [editError,setEditError]=useState('');

  useEffect(()=>{
    setStyleFilter('none');
    setLocDensityOpen(false);
    setSelectedPeriodKey('year');
    setKeywordPeriodKey('year');
    setKeywordCustomStart('');
    setKeywordCustomEnd('');
    setOpenCultureRoots([]);
    setSelectedRiverGroup('');
    setFocusedAnchorDate('');
    setStructureWindowKey('');
  },[scopeId]);
  // The saved homepage display is an initial choice, not a background analysis.
  useEffect(()=>{
    setStyleFilter(userActive&&userSettings.display==='keywords'?'rune66':'none');
  },[scopeId,userActive,userSettings.display]);

  const isAggregateScope=Boolean(scope?.aggregateChildren);
  // LOC's first Time River never queries per-day article/media density.
  // On-demand second-river data uses the shared ZenStack query client.
  const locDensityQuery=useAsyncResource({
    queryKey:['loc-culture-density',scopeId,query.data?.intersectionStart,query.data?.intersectionEnd,
      JSON.stringify(query.data?.intersectionWindows||[])],
    enabled:!isTimeEditingView&&isAggregateScope&&scopeId==='loc'&&!isLocItemView&&locDensityOpen
      &&Boolean(query.data?.intersectionWindows?.length),
    queryFn:async()=>{
      const {selectLocCultureDensity}=await import('../../loc/culture-query');
      return selectLocCultureDensity({
        scopes:query.data?.scopes||[],
        intersectionWindows:query.data?.intersectionWindows||[],
        intersectionStart:query.data?.intersectionStart||'',
        intersectionEnd:query.data?.intersectionEnd||''
      });
    },
  });
  // Time structure is authoritative without any remote ISR Period request.
  const allPeriods=useMemo(()=>sortPeriods(query.data?.eras?.eras||[]),[query.data]);
  const classificationScope=scopeId;
  const scopeData=query.data?.scope||null;
  // Use a stable periods array: date-navigation effects must not re-run just
  // because a different Culture panel or query refreshed the page.
  const primaryPeriods=useMemo(()=>isAggregateScope?[]:allPeriods.filter(item=>String(item?.scope_id||'')===scopeId),[isAggregateScope,allPeriods,scopeId]);
  const structurePreference=useMemo(()=>structurePeriodPreference(primaryPeriods,
    (query.data?.timelineItems||[]).filter(item=>item.scope_id===scopeId)),
  [primaryPeriods,query.data?.timelineItems,scopeId]);
  const closestPeriod=primaryPeriods.find(item=>periodKey(item)===structurePreference.preferredKey)||null;
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
  // The lower Culture panel shares one selected interval across the source
  // classification river, keyword-density river, suggestions, and work list.
  // The upper Time structure river keeps its own period navigation.
  // Events are part of the selected Period window, never a selector mode.
  const keywordPeriod=keywordPeriodKey==='year'?defaultYearPeriod:
    keywordPeriodKey==='all'?allTimePeriod
    :keywordPeriodKey==='latest'?(closestPeriod||selectedWorkPeriod||allTimePeriod)
    :keywordPeriodKey==='current'?(selectedWorkPeriod||allTimePeriod)
    :primaryPeriods.find(period=>periodKey(period)===keywordPeriodKey)||closestPeriod||selectedWorkPeriod;
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
      setStructureWindowKey(periodKey(matched));
      setKeywordPeriodKey(periodKey(matched));
    }
  },[scopeId,isAggregateScope,requestedWindowStart,requestedWindowEnd,requestedPeriodUid,primaryPeriods]);

  // One public LocAnchor ZModel read, shared in meaning with Statistics.
  // The persisted Source hierarchy (attr.uid) replaces ArticleTag snapshots.
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['loc-zmodel-source-taxonomy'],
    enabled:!isTimeEditingView&&!isAggregateScope&&!isLrunesDaily&&!isLocItemView
      &&scopeId!=='local'&&Boolean(scopeData),
    queryFn:async()=>{
      const {readPublicSourceTaxonomy}=await import('../../loc/source-catalog-public.mjs');
      return readPublicSourceTaxonomy();
    },
    revalidateOnFocus:false,revalidateOnReconnect:false
  });
  const sourceTaxonomy=sourceTaxonomyQuery.data;
  const sourceStyleOptions=useMemo(()=>sourceKeywordOptions(sourceTaxonomy),[sourceTaxonomy]);
  const stagedSourceRiver=Boolean(sourceTaxonomy)&&!isAggregateScope&&scopeId!=='local';
  const expandedSourceRoots=['system','custom','media'].filter(id=>openCultureRoots.includes(id));
  // Retrieve one bounded daily aggregate per selected period. Reuse it when
  // expanding a group, so a UI interaction never starts a second SQL job.
  const sourceRootQuery=useAsyncResource({
    queryKey:['culture-period-roots','v5-zmodel-anchors',classificationScope,classificationWindowStart,classificationWindowEnd,periodRangeSignature],
    enabled:!isTimeEditingView&&stagedSourceRiver&&styleFilter!=='trace'&&!isLrunesDaily&&!isLocItemView
      &&Boolean(scopeData)&&classificationWindowValid,
    queryFn:async()=>{
      const {text}=await selectScopeDailyCounts(scopeData,{
        startDate:classificationWindowStart,endDate:classificationWindowEnd,
        includeUndated:true,requireAggregate:true
      });
      const inside=row=>!classificationPeriodRanges||timePeriodContainsDate(
        {ranges:classificationPeriodRanges},String(row.day||''));
      return buildCultureRiverRootPayload({
        text:text.filter(inside),media:[]
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
    enabled:!isTimeEditingView&&styleFilter!=='trace'&&!isLrunesDaily&&!isLocItemView&&!isAggregateScope&&Boolean(scopeData)&&classificationWindowValid
      &&Boolean(sourceTaxonomy)&&(!stagedSourceRiver||expandedSourceReady),
    queryFn:async()=>{
      const {selectScopePeriodSourceSnapshot}=await import('../../loc/culture-query');
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
    enabled:!isTimeEditingView&&styleFilter==='rune66'&&!isAggregateScope&&!isLrunesDaily&&!isLocItemView,
    queryFn:async()=>{
      const {selectAvailableKeywordClasses}=await import('../../loc/keyword-analysis');
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
      const {selectKeywordAnalysisSummary}=await import('../../loc/keyword-analysis');
      return selectKeywordAnalysisSummary({scopeId,classUid:resolvedKeywordClassUid,startDate:keywordWindowStart,endDate:keywordWindowEnd});
    },
    enabled:!isTimeEditingView&&!isAggregateScope&&!isLrunesDaily&&styleFilter==='rune66'&&Boolean(resolvedKeywordClassUid)&&keywordWindowValid,
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
    enabled:!isTimeEditingView&&styleFilter==='rune66'&&keywordDetailRequested&&!isAggregateScope&&!isLrunesDaily&&!isLocItemView
      &&Boolean(scopeData)&&keywordWindowValid&&Boolean(styleQuery.data?.statisticsEnabled),
    queryFn:async()=>{
      const {keywordService}=await import('../../loc/keyword-service-client.mjs');
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
  // Second-river source choices come from the exact Scope source snapshot.
  // These must be available before choosing a keyword style.
  const keywordSourceOptions=useMemo(()=>sourceRootQuery.data?.groups||sourceSnapshotQuery.data?.groups||[],[sourceRootQuery.data,sourceSnapshotQuery.data]);
  // Keep raw source values intact for river filtering; simply separate text
  // platforms from media and sort each group instead of ranking by volume.
  const sourceOptionGroups=useMemo(()=>[
    {label:'文字來源',items:keywordSourceOptions.filter(item=>item.category_type!=='media')},
    {label:'多媒體類型',items:keywordSourceOptions.filter(item=>item.category_type==='media')}
  ].map(group=>({...group,items:[...group.items].sort((a,b)=>String(a.display_label||'').localeCompare(String(b.display_label||''),locale))}))
    .filter(group=>group.items.length>0),[keywordSourceOptions,locale]);
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
      const {keywordService}=await import('../../loc/keyword-service-client.mjs');
      const {keywordTreeCatalog}=await import('../../loc/keyword-tree-report.mjs');
      const result=await keywordService('catalog',{scopeId,classUid:resolvedKeywordClassUid});
      if(!result.class_uid)return [];
      const catalog=keywordTreeCatalog(result.rows,result.class_uid);
      return (catalog.groups.find(group=>group.uid===keywordDrillGroup)?.items||[])
        .map((item,index)=>({...item,order_no:index}));
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
      // Multimedia is now a *source tree Universe*. Legacy media-type rows
      // cannot become a second source taxonomy or double-count Galaxy.site.
      if(source.category_type==='media')continue;
      const raw=String(source.site||'');
      const code=assignedSource(raw,catalog.aliases,catalog.categories);
      const node=byCode.get(code);
      const root=node?.root||'custom';
      const label=node?.display_name||l.other;
      const key=root+':'+code;
      if(!index.has(key))index.set(key,{key,root,label,site:label,
        sites:[],media_types:[],item_count:0});
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
    if(option?.type==='domain'){
      const descendants=new Set((sourceTaxonomy?.tree||[])
        .filter(node=>node.path.includes(option.code)).map(node=>node.uid));
      const members=groupedSources.filter(group=>
        descendants.has(group.key.slice(group.key.indexOf(':')+1)));
      if(members.length)return {key:option.key,root:option.root,label:option.label,
        site:option.label,sites:[...new Set(members.flatMap(item=>item.sites))],
        media_types:[],item_count:members.reduce((n,item)=>n+item.item_count,0)};
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
    enabled:!isTimeEditingView&&worksOpen&&styleFilter==='none'&&!isLrunesDaily
      &&!isAggregateScope&&Boolean(scopeData)&&Boolean(selectedGroup)
      &&classificationWindowValid,
    queryFn:async({pageParam})=>{
      const {selectCultureArticleListPage}=await import('../../loc/culture-query');
      return selectCultureArticleListPage(scopeData,{
        startDate:classificationWindowStart,endDate:classificationWindowEnd,
        site:selectedGroup?.site||'',sites:selectedGroup?.sites||[],
        sortDirection:articleSort,offset:pageParam?.offset||0
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
    setFullTextKey('');
    setFullText('');
    setFullTextError('');
    if(workScrollRef.current)workScrollRef.current.scrollTop=0;
  },[classificationWindowStart,classificationWindowEnd]);

  useEffect(()=>{
    setFullTextKey('');
    setFullText('');
    setFullTextError('');
    if(workScrollRef.current)workScrollRef.current.scrollTop=0;
  },[selectedCategory,selectedRiverGroup]);


  const timelineItems=useMemo(()=>
    (query.data?.timelineItems||[]).filter(item=>isAggregateScope||item.scope_id===scopeId)
  ,[query.data,scopeId]);
  // Keep the time traces in their saved chronological order. The first view
  // shows every trace, not only the last-selected trace at the top.
  const activeStructureKey=structureWindowKey==='all'||!structureWindowKey?'all'
    :primaryPeriods.some(item=>periodKey(item)===structureWindowKey)
      ?structureWindowKey:'all';
  const eraRiver=useMemo(()=>
    userActive&&userSettings.time!=='era'
      ?simpleTimeRiver(timelineItems,userSettings.time)
      :buildEraRiver(timelineItems,expandedEraIds),
    [timelineItems,expandedEraIds,userActive,userSettings.time]);
  const editorEraRiver=useMemo(()=>
    buildEraRiver(timelineItems,expandedEditorEraIds,{editorOnly:true}),
    [timelineItems,expandedEditorEraIds]);
  const editorRiverWindow=useMemo(editorRiverYearWindow,[]);
  const toggleEditorEra=groupId=>setExpandedEditorEraIds(current=>
    current.includes(groupId)?current.filter(id=>id!==groupId):[...current,groupId]);
  const toggleTimeTrace=groupId=>{
    const open=!expandedEraIds.includes(groupId);
    setExpandedEraIds(current=>
      current.includes(groupId)?current.filter(id=>id!==groupId):[...current,groupId]);
    if(open&&groupId.startsWith('trace:')){
      const trace=primaryPeriods.find(period=>
        'trace:'+String(period.scope_id||scopeId)+':'+periodKey(period)===groupId);
      if(trace)setStructureWindowKey(periodKey(trace));
    }
  };
  const currentStructurePeriod=primaryPeriods.find(item=>periodKey(item)===activeStructureKey)||null;
  const currentStructureStart=activeStructureKey==='all'?DEFAULT_YEAR_WINDOW.startDate
    :String(currentStructurePeriod?.start_date||'').slice(0,10);
  // A trace stops at its final real anchor; no virtual today endpoint.
  const lastAnchorDate=String(structurePreference.lastAnchor?.start_date||'').slice(0,10);
  const savedTraceEnd=String(currentStructurePeriod?.end_date||'').slice(0,10);
  const currentStructureEnd=activeStructureKey==='all'?DEFAULT_YEAR_WINDOW.endDate
    :structureWindowKey===''&&lastAnchorDate>savedTraceEnd?lastAnchorDate:savedTraceEnd;
  // Keep the first river grouped by era UID. A selected trace changes
  // only the camera viewport, never the saved anchor/event/trace graph.
  const anchorRecords=useMemo(()=>timelineItems
    .filter(item=>item.entry_type==='anchor'&&item.uid)
    .sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))||String(a.display_label||'').localeCompare(String(b.display_label||''))),[timelineItems]);
  const locScopeIntervalItems=useMemo(()=>query.data?.scopeTimeRanges||[],[query.data]);
  const locSourceRiverItems=useMemo(()=>locDensityOpen?locDensityQuery.data?.sourceRiverItems||[]:[],[locDensityQuery.data,locDensityOpen]);
  const locSourceGroups=useMemo(()=>locDensityOpen?locDensityQuery.data?.sourceGroups||[]:[],[locDensityQuery.data,locDensityOpen]);
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
  const locCombinedSourceRiverItems=useMemo(()=>locSourceRiverItems.map(item=>({
    ...item,
    end_date:nextRiverDay(item?.start_date),
    group_label:locSourceGroupLabel.get(String(item?.category||item?.group_label||''))||String(item?.group_label||'')
  })),[locSourceRiverItems,locSourceGroupLabel]);
  const locScopeDistributionItems=useMemo(()=>locDensityOpen?locDensityQuery.data?.scopeRanges||[]:[],[locDensityQuery.data,locDensityOpen]);
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
      setSelectedTimelineDate(type==='anchor'?creationDate:'');
      setSuggestedRequestNonce(value=>value+1);
      setTimelineEditorRevision(value=>value+1);
    });
  }

  function beginTimelineRecordEdit(item,recordId){
    const id=String(recordId||item?.recordId||'').trim();
    if(!id)return;
    switchTimelineEditor('edit-'+id,()=>{
      const recordType=String(item?.entryType||item?.raw?.entry_type||'');
      if(['anchor','period','era'].includes(recordType))setSuggestedRecordType(recordType);
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
    // anchor_ids. Only a real anchor point can be moved on the river.
    if(row?.entryType!=='anchor'||!row.recordId||!scopeData?.time)return null;
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
  const secondRiverBuckets=useMemo(()=>
    cultureDensityByUnit(classificationBuckets,userActive?userSettings.unit:'day'),
    [classificationBuckets,userActive,userSettings.unit]);
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
      .filter(item=>String(item?.entry_type||'')==='anchor')
      .map(item=>String(item?.start_date||item?.date||'').slice(0,10))
      .filter(Boolean)
  ,[timelineItems]);
  // Render the selected period immediately. Multi-year PELT executes in a
  // worker, so change-point suggestions cannot freeze the Time River.
  const riverAnalysis=useRiverDensityAnalysis(densityInputBuckets,existingAnchorDates,
    anchorSuggestOpen&&!isAggregateScope&&!isLrunesDaily&&!isLocItemView&&styleFilter!=='trace'&&Boolean(densityInputBuckets.length));
  const styleRiverAnalysis=useRiverDensityAnalysis(keywordDrillItems,existingAnchorDates,
    anchorSuggestOpen&&styleFilter==='rune66'&&Boolean(keywordDrillItems.length));
  const locRiverAnalysis=useRiverDensityAnalysis(locCombinedSourceRiverItems,EMPTY_CULTURE_GROUPS,
    isAggregateScope&&locDensityOpen&&Boolean(locCombinedSourceRiverItems.length));
  const virtualAnchorItems=useMemo(()=>{
    const total=Math.max(1,Number(riverAnalysis.totalCount)||0);
    return riverAnalysis.suggestions.map(item=>{
      const selected=selectedVirtualAnchorDates.includes(item.date);
      const beforeCount=Number(item.beforeCount||0);
      const afterCount=Number(item.afterCount||0);
      const strength=Math.min(1,Math.abs(Number(item.afterMean||0)-Number(item.beforeMean||0))/Math.max(1,Number(item.afterMean||0),Number(item.beforeMean||0)));
      const position=periodPositionRatio(item.date,classificationWindowStart,classificationWindowEnd);
      return {
        id:'virtual-anchor:'+item.date,
        entry_id:'virtual-anchor:'+item.date,
        entry_type:'virtual_anchor',
        start_date:item.date,
        title:formatCultureUi(l.candidateTitle,{date:item.date,position:(position*100).toFixed(1),before:beforeCount.toLocaleString(locale),beforeRatio:((beforeCount/total)*100).toFixed(1),after:afterCount.toLocaleString(locale),afterRatio:((afterCount/total)*100).toFixed(1),analysis:(item.analysis||[]).join(' ')}),
        display_label:'◇',
        group_label:l.candidateAnchor,
        item_count:0,
        className:'scope-virtual-anchor'+(selected?' is-selected':''),
        style:'--virtual-anchor-strength:'+strength+';',
        virtual_anchor:{...item,position_ratio:position,before_ratio:beforeCount/total,after_ratio:afterCount/total,strength_ratio:strength}
      };
    });
  },[riverAnalysis.suggestions,riverAnalysis.totalCount,selectedVirtualAnchorDates,classificationWindowStart,classificationWindowEnd,l,locale]);
  // Three true parent lanes always exist; children are mounted inside the same
  // vis-timeline chart only when their parent is expanded.
  const showKeywordRiver=styleFilter==='rune66';
  const cultureRiver=useMemo(()=>{
    const sourceRootLabels=new Map((sourceTaxonomy?.roots||[])
      .map(node=>[node.root,node.title]));
    const roots=[
      {id:'system',label:sourceRootLabels.get('system')||l.system,order:0},
      {id:'custom',label:sourceRootLabels.get('custom')||l.custom,order:300},
      {id:'media',label:sourceRootLabels.get('media')||l.media,order:600}
    ];
    const bySource=new Map();
    for(const group of groupedSources){
      for(const name of group.sites)bySource.set(name,group);
      for(const name of group.media_types)bySource.set('媒體 · '+name,group);
    }
    // Children (expanded lanes) still draw the real per-day river, built
    // from secondRiverBuckets, which only has data once a lane is expanded.
    const subtotals=new Map();
    const add=(map,key,count)=>map.set(key,(map.get(key)||0)+count);
    for(const item of secondRiverBuckets){
      const raw=String(item.category||''),day=String(item.start_date||'').slice(0,10);
      if(!day)continue;
      const group=bySource.get(raw);
      const parent=group?.root||(raw.startsWith('媒體 · ')?'media':'custom');
      const child=group?.key||parent+':unclassified';
      const count=Number(item.item_count)||0;
      add(subtotals,child+'\u0000'+day,count);
    }
    const childMaximum=(()=>{
      const result=new Map();
      for(const [key,n] of subtotals){
        const code=key.slice(0,key.indexOf('\u0000'));
        result.set(code,Math.max(result.get(code)||0,n));
      }
      return result;
    })();
    const childCounts=(()=>{
      const counts=new Map();
      for(const [key,count] of subtotals){
        if(!Number.isFinite(count)||count<=0)continue;
        const code=key.slice(0,key.indexOf('\u0000'));
        counts.set(code,(counts.get(code)||0)+count);
      }
      return counts;
    })();
    // Root (collapsed) lanes: one flat bar sized by this source's share of
    // the period total -- built straight from groupedSources, which already
    // carries the window-total item_count (from the totals-only RPC for a
    // staged scope, or from the full per-day snapshot otherwise). No per-day
    // data is read just to size a collapsed lane.
    const rootCounts=new Map();
    for(const group of groupedSources)rootCounts.set(group.root,(rootCounts.get(group.root)||0)+(Number(group.item_count)||0));
    const periodTotal=[...rootCounts.values()].reduce((sum,n)=>sum+n,0)||1;
    const numberedLabel=(label,count)=>label+'（'+count.toLocaleString(locale)+'）';
    const dayRow=(id,day,count,label,order,max,kind)=>({
      id:'dual:'+id+':'+day,entry_id:'dual:'+id+':'+day,
      entry_type:kind,group_key:'dual:'+id,group_label:label,group_order:order,
      start_date:day,end_date:nextRiverDay(day),item_count:count,
      density_ratio:count/Math.max(1,max),display_label:'',
      title:day+' · '+label+' · '+count.toLocaleString(locale)
    });
    const flatRow=(id,count,label,order,kind)=>({
      id:'dual:'+id+':flat',entry_id:'dual:'+id+':flat',
      entry_type:kind,group_key:'dual:'+id,group_label:label,group_order:order,
      start_date:classificationWindowStart,end_date:nextRiverDay(classificationWindowEnd),
      item_count:count,density_ratio:count/periodTotal,display_label:'',
      title:label+' · '+count.toLocaleString(locale)+' / '+periodTotal.toLocaleString(locale)
    });
    const items=[],groups=[];
    const activeChildren=new Set(groupedSources.filter(group=>group.item_count>0).map(group=>group.key));
    const activeRoots=new Set([...rootCounts].filter(([,count])=>count>0).map(([key])=>key));
    for(const parent of roots){
      // Hide zero-count parent lanes in the requested interval entirely.
      const parentCount=rootCounts.get(parent.id)||0;
      if(!activeRoots.has(parent.id)||parentCount<=0)continue;
      const members=groupedSources.filter(g=>g.root===parent.id&&activeChildren.has(g.key))
        .sort((a,b)=>a.label.localeCompare(b.label,locale));
      const expanded=openCultureRoots.includes(parent.id);
      const onlyChild=members.length===1?members[0]:null;
      // A lone child *is* the visible river: do not draw its parent's
      // identical total and force an unnecessary second lane on expansion.
      const label=onlyChild?.label||parent.label;
      groups.push({id:'dual:root:'+parent.id,label:numberedLabel(label,parentCount),order:parent.order,
        className:'scope-dual-river-root',collapsible:members.length!==1,
        selectable:Boolean(onlyChild),sourceKey:onlyChild?.key||'',expanded});
      items.push(flatRow('root:'+parent.id,parentCount,label,parent.order,'source_total'));
      // A lone populated child is already represented by the parent lane.
      if(!expanded||onlyChild||!sourceSnapshotQuery.data)continue;
      members.forEach((group,index)=>{
        const count=childCounts.get(group.key)||0;
        // After expansion, use the actual loaded date buckets. Empty children
        // must not create left-side labels or selectable blank lanes.
        if(count<=0)return;
        const id='dual:child:'+group.key;
        groups.push({id,label:numberedLabel(group.label,count),order:parent.order+index+1,
          className:'scope-dual-river-child',selectable:true,sourceKey:group.key});
        for(const [key,count] of subtotals){
          const [code,day]=key.split('\u0000');
          if(code===group.key&&count>0)items.push({...dayRow('child:'+group.key,day,count,group.label,parent.order+index+1,childMaximum.get(group.key),'source_group'),source_group_code:group.key});
        }
      });
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
    if(styleFilter!=='trace'&&activeRoots.size>0){
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
  },[groupedSources,secondRiverBuckets,openCultureRoots,sourceSnapshotQuery.data,virtualAnchorItems,showKeywordRiver,keywordDrillItems,keywordGroupOptions,keywordDrillGroup,l,locale,classificationWindowStart,classificationWindowEnd,styleFilter,densityInputBuckets,anchorSuggestOpen]);
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
    if(!id.startsWith('dual:root:'))return;
    const root=id.slice('dual:root:'.length);
    setOpenCultureRoots(current=>current.includes(root)
      ?current.filter(value=>value!==root):[...current,root]);
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
      if(!verified?.authorizer?.canManageScopeSync(scopeId))throw new Error('請先登入具備此 Scope 權限的帳號。');
      const used=new Set((query.data?.timelineItems||[]).filter(row=>row?.entry_type==='anchor').map(row=>String(row.uid||'')));
      const payload=dates.map(date=>{
        const uid=allocateTimeUid([...used].map(uid=>({uid})));
        used.add(uid);
        return {uid,type:'anchor',title:'建議定錨 '+date,description:null,address:date,anchor_ids:null};
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
      if(!verified?.authorizer?.canManageScopeSync(scopeId))throw new Error('請先登入具有此 Scope 編輯權限的帳號。');
      setAuthorizedWorkKey(key);
      if(!scopeData)throw new Error(l.sourceUnresolved);
      const {rows=[]}=await selectRows(scopeData.galaxy,{
        columns:'uid,title,content,able',
        filters:[{column:'uid',operator:'eq',value:uid}],
        limit:1
      });
      const row=rows[0];
      if(!row)throw new Error(l.workNotFound);
      const {plainTextToBlocks}=await import('../../loc/blocknote-content.mjs');
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
      const {blocksToPlainText}=await import('../../loc/blocknote-content.mjs');
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
    if(fullTextKey===key){
      setFullTextKey('');
      setFullText('');
      setFullTextError('');
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
      if(!row)throw new Error(l.workNotFound);
      setFullText(workDisplayText(row.content||''));
      setFullDetail(row);
    }catch(exception){
      setFullTextError(String(exception?.message||exception||l.fullTextFailed));
    }finally{
      setFullTextLoading(false);
    }
  }

  // The dedicated management entry is already in edit mode. Only its selected
  // record kind appears on the right, with the same native zoom/pan controls.
  if(isTimeEditingView){
    const editorAvailable=Boolean(scopeId&&scopeId!=='loc');
    const permissionPending=account.loading||account.permissionLoading;
    const editorAuthorized=Boolean(account.user&&account.canManageScopeSync(scopeId));
    return <FeaturePage featureId="culture">
      <ManagementWorkspaceFrame level="scope" title="時間定錨管理">
        <section className="management-workspace-panel scope-time-edit-root">
        {!editorAvailable?<p className='scope-status'>此區沒有個別 Scope 的時間編輯資料。</p>:null}
        {editorAvailable&&permissionPending?<p className='scope-status' role='status'>正在確認此 Scope 的編輯權限…</p>:null}
        {editorAvailable&&!permissionPending&&!editorAuthorized?<p className='scope-status scope-error' role='alert'>
          {account.error?String(account.error):account.user?'目前登入帳號沒有此 Scope 的管理權限。':'請先至設定首頁登入，才能編輯時間定錨。'}
        </p>:null}
        {editorAvailable&&!permissionPending&&editorAuthorized?<div className='scope-time-edit-workspace'>
          <div className='management-workspace-panel' id='time-editor-panel' role='region'
            aria-label='時間編輯'>
            <div className='scope-culture-timeline-tools'>
              <h3>時代／期間／時間定錨點</h3>
              <button type='button' className='loc-button' disabled={query.isPending}
                onClick={()=>void refreshTimelineData().catch(error=>setEditError(error?.message||'時間長河更新失敗'))}>更新時間長河</button>
            </div>
            {query.isPending?<p className='scope-status' role='status'>正在載入時間紀錄…</p>:null}
            {query.error?<p className='scope-status scope-error' role='alert'>{featureDataErrorMessage(query.error,UI_COPY)}</p>:null}
            {!query.isPending&&!query.error&&!timelineItems.length
              ?<p className='scope-status'>目前尚未建立此類時間紀錄，可直接在下方新增。</p>:null}
            {!query.isPending&&!query.error&&editorEraRiver.groups.length>0?<CultureTimeline
              key={'time-editor-era-period'}
              items={editorEraRiver.items}
              extraGroups={editorEraRiver.groups}
              labelOf={localizedLabelOf}
              focus={EMPTY_RIVER_FOCUS}
              mode='trace'
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
              <CultureTimelineEditor key={scopeId+':unified:'+timelineEditorRevision}
                scopeId={scopeId}
                timeTable={scopeData?.time||''}
                birthday={scopeData?.birthday||''}
                selectedRecordId={selectedTimelineRecordId}
                suggestedAnchorDate={selectedTimelineDate}
                suggestedRecordType={suggestedRecordType}
                defaultRecordType='anchor'
                suggestedRequestNonce={suggestedRequestNonce}
                onDataChanged={refreshTimelineData}
                onClose={()=>{setSelectedTimelineRecordId('');setSelectedTimelineDate('');setSelectedTimelineInfo(null);setSuggestedRequestNonce(0)}}/>
            </div>
            {editError?<p className='scope-status scope-error' role='alert'>{editError}</p>:null}
          </div>
        </div>:null}
        </section>
      </ManagementWorkspaceFrame>
    </FeaturePage>;
  }

  return <FeaturePage featureId="culture">
    <section className='loc-card scope-feature-card scope-feature-card-wide'>
      {scopeId==='lrunes'?<div className='scope-stat-controls'><label><span><UiText id="uiExtra.cultureView.timelineContent"/></span>
        <select className='scope-select' value={lrunesView} onChange={event=>setLrunesView(event.target.value)}>
          <option value='daily'><UiText id="uiExtra.cultureView.dailyRunes"/></option>
          <option value='works'><UiText id="uiExtra.cultureView.worksAndPeriods"/></option>
        </select>
      </label></div>:null}
      {scopeId==='loc'?<div className='scope-stat-controls'><label><span>{UI_COPY.culture.viewMode}</span>
        <select className='scope-select' aria-label={UI_COPY.culture.viewMode} value={locCultureView} onChange={event=>setLocCultureView(event.target.value)}>
          <option value='period'><UiText id="uiExtra.cultureView.periodIntersectionWorks"/></option>
          <option value='item'><UiText id="uiExtra.cultureView.itemIntersectionTwoRivers"/></option>
        </select>
      </label></div>:null}
      {isLrunesDaily?<LrunesDailyCulturePanel/>:isLocItemView?<LocItemConfluence/>:<>
      <p className='loc-eyebrow'>{UI_COPY.culture.distribution}</p>
      <h2>{UI_COPY.culture.river}</h2>
      {query.isPending?<p className="scope-status" role="status" aria-live="polite">{UI_COPY.common.loading}</p>:null}
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
                  windowStart={requestedWindowStart||locDistributionStart}
                  windowEnd={requestedWindowEnd||locDistributionEnd}
                  fixedMin={locDistributionStart}
                  fixedMax={locDistributionEnd}
                />:null}
                {!locIntersectionScopeIds.length&&query.data?.scopes?.length
                  ?<p className='scope-status' role='status'>目前各 Scope 的時代／時期沒有共同時間區間（單一定錨點亦計入）。</p>:null}
                <div className='scope-result-links'>
                  {[...new Set(locScopeIntervalItems.map(item=>item.scope_id))].map(id=><ScopeLink key={id} href={featureNavigationHref(id,'culture')}>{id}{l.personalTimelineSuffix}</ScopeLink>)}
                </div>
                {locIntersectionScopeIds.length?<details className='scope-stat-details scope-culture-density-details'
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
                    windowStart={requestedWindowStart||locIntersectionStart}
                    windowEnd={requestedWindowEnd||locIntersectionEnd}
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
                    windowStart={requestedWindowStart||locDistributionStart}
                    windowEnd={requestedWindowEnd||locDistributionEnd}
                    fixedMin={locDistributionStart}
                    fixedMax={locDistributionEnd}
                    hiddenDates={locRiverAnalysis.hiddenDates}
                  />
                </section>:null}
                  </>:null}
                </details>:null}

              </section>


            </>:<>
              <section className='scope-card scope-culture-structure-river'>
                <div className='scope-culture-structure-toolbar'>
                  <h3>{l.timeTrace}</h3>
                  <label><span>{l.timeTrace}</span>
                    <select className='scope-select' aria-label='第一條河道時代選擇'
                      value={activeStructureKey} onChange={event=>{
                         setStructureWindowKey(event.target.value);
                         setSelectedPeriodKey(event.target.value);
                       }}>
                      <option value='all'>{l.allTimeTraces}</option>
                      {primaryPeriods.map(item=><option key={periodKey(item)} value={periodKey(item)}>{localizedLabelOf(item,0)}</option>)}
                        </select>
                  </label>
                </div>
                {eraRiver.groups.length?<CultureTimeline
                  items={eraRiver.items}
                  extraGroups={eraRiver.groups}
                  labelOf={localizedLabelOf}
                  focus={navigation}
                  mode='trace'
                  onGroupToggle={toggleTimeTrace}
                  windowStart={currentStructureStart}
                  windowEnd={currentStructureEnd}
                  onSelect={item=>setSelectedTimelineInfo(item||null)}
                  editable={false}
                />:<p className='scope-status'>{UI_COPY.uiExtra.dataErrors.empty}</p>}
                {selectedTimelineInfo?<div className='scope-card scope-culture-timeline-selection' role='status'>
                  <strong>{selectedTimelineInfo.raw?.title||selectedTimelineInfo.content||selectedTimelineInfo.raw?.display_label||selectedTimelineInfo.title||translateUiField(locale,'時間長河紀錄')}</strong>
                  <p className='scope-status'>{String(selectedTimelineInfo.start||'').slice(0,10)}{selectedTimelineInfo.end?' ～ '+String(selectedTimelineInfo.end).slice(0,10):''}</p>
                  {selectedTimelineInfo.title?<p>{selectedTimelineInfo.title}</p>:null}
                </div>:null}
              </section>

              {(selectedWorkPeriod||!primaryPeriods.length)?<section className='scope-card scope-culture-classification-river'>
                <div className='scope-culture-river-toolbar'>
                  <h3>{UI_COPY.culture.classificationRiver}｜{classificationPeriodLabel}</h3>
                  <div className='scope-culture-river-selectors'>
                    <div className='scope-culture-time-picker'>
                      <label>
                        <select className='scope-select' aria-label={l.period}
                          value={keywordPeriodKey} onChange={event=>{
                            const next=event.target.value;
                            if(next==='custom'){
                              if(!keywordCustomStart)setKeywordCustomStart(keywordWindowStart);
                              if(!keywordCustomEnd)setKeywordCustomEnd(keywordWindowEnd);
                            }
                            setKeywordPeriodKey(next);

                          }}>
                          <option value='year'>{DEFAULT_YEAR_WINDOW.label}</option>
                          <option value='latest'>{primaryPeriods.length?l.recentTimeTrace:'未設定時代'}</option>
                           <option value='all'>{primaryPeriods.length?l.allTimeTraces:'本年度（未設定時代）'}</option>
                           {primaryPeriods.map(item=><option key={periodKey(item)} value={periodKey(item)}>{localizedLabelOf(item,0)}</option>)}
                           <option value='custom'>{l.customPeriod}</option>
                        </select>
                      </label>
                    </div>
                    <label><span>{l.styleLabel}</span>
                      <select className='scope-select' aria-label={l.styleLabel}
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
                            setOpenCultureRoots(current=>current.includes(choice.root)
                              ?current:[...current,choice.root]);
                          }else if(!next.startsWith('source:')){
                            setStyleFilter(next);
                            if(next==='none')setSelectedRiverGroup('');
                          }
                          setKeywordDrillGroup('');
                        }}>
                        <option value='none'>{l.noStyle}</option>
                        <option value='trace'>痕跡（地點）</option>
                        <optgroup label='關鍵詞'>
                          <option value='rune66'>{selectedKeywordClass?.name||l.keywordStyle}</option>
                        </optgroup>
                        {sourceStyleOptions.length?<optgroup label='來源'>
                          {sourceStyleOptions.map(item=><option key={item.key} value={'source:'+item.key}>
                            {item.domain?item.domain+' / ':''}{item.label}
                          </option>)}
                        </optgroup>:null}
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
                  {styleFilter!=='trace'&&riverRangeLoading?<span className='scope-status' role='status'>{UI_COPY.common.loading}</span>:null}
                  {riverAnalysis.error?<span className='scope-status scope-error' role='status'>{riverAnalysis.error}</span>:null}
                </div>
                {styleFilter==='rune66'?<section className='scope-culture-style-filter'>
                  <p className='loc-eyebrow'>下半河道｜關鍵詞：{String(styleQuery.data?.keywordMeta?.class_name||selectedKeywordClass?.name||'尚未設定')}</p>
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
                  {styleRiverAnalysis.suggestions.length>0?<details className='scope-culture-anchor-picker'>
                    <summary>風格密度建議定錨點：{styleRiverAnalysis.suggestions.length} 個（點開查看）</summary>
                    {styleRiverAnalysis.suggestions.length?<div className='scope-culture-anchor-choices'>
                      {styleRiverAnalysis.suggestions.map(item=>{
                        const route=featureNavigationHref(scopeId,'culture');
                        const href=route+(route.includes('?')?'&':'?')+'edit=1&anchorDate='+encodeURIComponent(item.date);
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
                {styleFilter!=='trace'&&sourceRootQuery.error?<p className='scope-status scope-error'>{featureDataErrorMessage(sourceRootQuery.error,UI_COPY)}</p>:null}
                {styleFilter!=='trace'&&sourceSnapshotQuery.error
                   ?<p className='scope-status scope-error' role='alert'>
                     {featureDataErrorMessage(sourceSnapshotQuery.error,UI_COPY)}</p>:null}
                 {styleFilter!=='trace'&&stagedSourceRiver&&openCultureRoots.length>0
                   &&sourceSnapshotQuery.isPending
                   ?<p className='scope-status' role='status'>正在展開河道的細部分布…</p>:null}
                 {/* Anchor suggestions never compute on their own just because a lane's
                     daily data arrived -- the PELT worker only runs once the user
                     explicitly clicks open the "建議定錨點" lane itself on the chart
                     above (see the dual:source:candidates group / onGroupToggle).
                     This panel is just the detail view for an already-opened lane. */}
                 {styleFilter!=='trace'&&!riverRangeLoading&&anchorSuggestOpen?<div className='scope-culture-anchor-actions'>
                  {riverAnalysis.suggestions.length>0?<>
                    <span>{formatCultureUi(l.candidateSummary,{count:riverAnalysis.suggestions.length})}</span>
                    {canUseScopeEditor?<button type='button' className='loc-button' disabled={creatingSuggestedAnchors||!selectedVirtualAnchorDates.length}
                      onClick={createSelectedSuggestedAnchors}>
                      {creatingSuggestedAnchors?'正在新增…':'新增選取的建議定錨點（'+selectedVirtualAnchorDates.length+'）'}
                    </button>:null}
                    {editError?<p className='scope-status scope-error' role='alert'>{editError}</p>:null}
                    <details className='scope-culture-anchor-picker' open>
                      <summary><span className='scope-culture-anchor-picker-mark' aria-hidden='true'/><UiText id="uiExtra.cultureView.expandToCompareWorkVolumeChanges"/></summary>
                      <div className='scope-culture-anchor-choices'>
                        {riverAnalysis.suggestions.map(item=>{
                          const route=featureNavigationHref(scopeId,'culture');
                          const href=route+(route.includes('?')?'&':'?')+'edit=1&anchorDate='+encodeURIComponent(item.date);
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
                {styleFilter!=='trace'&&classificationWindowValid&&!(stagedSourceRiver?sourceRootQuery.error:sourceSnapshotQuery.error)
                  &&(stagedSourceRiver?sourceRootQuery.data:sourceSnapshotQuery.data)
                  &&!cultureRiver.hasSourceData
                  ?<div className='scope-card scope-status scope-culture-no-data' role='status'>{l.noDataInPeriod}</div>:null}
                {/* Never mount vis-timeline over an empty/pending source snapshot:
                    on first entry it otherwise creates an unready chart and then
                    replaces its DOM while groups and density analysis arrive. */}
                {styleFilter!=='trace'&&classificationWindowValid&&!(stagedSourceRiver?sourceRootQuery.error:sourceSnapshotQuery.error)
                  &&(stagedSourceRiver?sourceRootQuery.data:sourceSnapshotQuery.data)&&cultureRiver.hasSourceData
                  ?<div className='scope-culture-double-river'>
                  {styleFilter==='none'&&openCultureRoots.length===0
                    &&cultureRiver.items.every(item=>item.entry_type==='source_total')
                    ?<CultureSourceRootSummary
                      items={cultureRiver.items}
                      groups={cultureRiver.groups}
                      windowStart={classificationWindowStart}
                      windowEnd={classificationWindowEnd}
                      onGroupToggle={toggleCultureRiverGroup}
                      onGroupSelect={selectCultureRiverGroup}
                    />:<CultureTimeline
                    items={cultureRiver.items}
                    extraGroups={cultureRiver.groups}
                    onGroupToggle={toggleCultureRiverGroup}
                    onGroupSelect={selectCultureRiverGroup}
                    anchorInsight={anchorInsight}
                    anchorLabels={{date:l.candidateDate,before:l.candidateBefore,after:l.candidateAfter,reason:l.candidateReason,close:l.candidateClose}}
                    onAnchorClose={()=>setFocusedAnchorDate('')}
                    heightVariant='double'
                    labelOf={classificationRiverLabel}
                    focus={EMPTY_RIVER_FOCUS}
                    mode='source'
                    windowStart={classificationWindowStart}
                    windowEnd={classificationWindowEnd}
                    hiddenDates={riverAnalysis.hiddenDates}
                    onSelect={item=>{
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
                    }}
                  />}
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
                      return <div className='scope-work-list-row' key={workKey+'-'+index}>
                        <span>標題：{work.title}</span>
                        <span> 日期：{work.date}</span>
                        <WorkFullText
                          open={fullTextKey===workKey}
                          loading={fullTextLoading&&fullTextKey===workKey}
                          error={fullTextKey===workKey?fullTextError:''}
                          content={fullTextKey===workKey?fullText:''}
                          onToggle={()=>toggleWorkContent(work)}
                        />
                      </div>;
                    }}
                  />
                  {!periodWorksPage.loading&&!periodWorksPage.error&&!visibleWorkRows.length?<p className='scope-status'>{UI_COPY.uiExtra.dataErrors.empty}</p>:null}
                  </>:null}
                </details>:null}
              </section>:null}
            </>}
      </>:null}
      </>}
    </section>
  </FeaturePage>;
}
