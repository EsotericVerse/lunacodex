'use client';
import FieldText from '../../i18n/FieldText';

import {UI_COPY,registerDefaultSection} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';
import searchZh from '../../i18n/sections/search.zh_tw.js';
import searchUIZh from '../../i18n/sections/uiExtra.searchUI.zh_tw.js';
import editBlocksZh from '../../i18n/sections/uiExtra.editBlocks.zh_tw.js';
import cultureViewZh from '../../i18n/sections/uiExtra.cultureView.zh_tw.js';
import paginationZh from '../../i18n/sections/uiExtra.pagination.zh_tw.js';
registerDefaultSection('search',searchZh);
registerDefaultSection('uiExtra.searchUI',searchUIZh);
registerDefaultSection('uiExtra.editBlocks',editBlocksZh);
registerDefaultSection('uiExtra.cultureView',cultureViewZh);
registerDefaultSection('uiExtra.pagination',paginationZh);

import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {motion,useReducedMotion} from 'motion/react';
import ActivityMotion from '../ActivityMotion';
import {publicPatternSuggestions} from '../../loc/public-pattern-suggestions.mjs';
import {blockNoteSuggestionItems} from '../../loc/blocknote-suggestions.mjs';
import {useAsyncResource,useResourceCache} from '../../loc/use-async-resource';
import {useRouter,useSearchParams} from 'next/navigation';

import {dbAuthClient,dbPublicClient,deleteRows,updateRows} from '../../loc/db-client.mjs';
import {useAccount} from '../../loc/use-account';
import {ArticleSortSelect,FeaturePage,IncrementalList,WorkFullText} from '../ui';
import ScopeLink from '../ScopeLink';
import SearchSummary from '../../loc/SearchSummary';
// Article cards/editing are requested only when results actually render.
const Article=dynamic(()=>import('../Article'),{loading:()=>null});
import {useScopeRuntime} from '../use-scope-runtime';
import useLocFeatureSettings from '../../loc/use-loc-feature-settings';
import useDefaultTimeUnit from '../../loc/use-default-time-unit';
import {timeUnitBucket,localTodayKey} from '../../loc/default-time-unit.mjs';
import {useEditDock} from '../edit-dock';
import {scopeHref} from '../scope-registry';
import {featureNavigationHref,galaxyIdentityHref,galaxyRelationLinks} from '../feature-navigation';
import {featureDataErrorMessage} from '../feature-data-state';
import {parseSearchQuery} from '../../loc/search-query.mjs';
import {locGlobalUid} from '../../../zenstack/global-identity.mjs';
import {galaxyAble} from '../../loc/galaxy-able.mjs';
import {searchGalaxyRows,selectGalaxyContent,selectGalaxyIdentity,selectStyleKeywordMatches,selectSourceTaxonomy} from '../../loc/galaxy-query';
import {defaultScopeData,selectLocSearchScopes,selectScopeRegistry,revalidateServerMetadata} from '../../loc/scope-data';

import {MEDIA_FALLBACK_TITLE,WORK_FALLBACK_TITLE,workDisplayHeading,workDisplayText} from '../work-display-model';
import {requireGalaxyContent,resolveGalaxyTitle,assertPlainGalaxyAttributes} from '../../loc/content-policy';
import {DEFAULT_LIST_BATCH_SIZE} from '../../loc/db-contract.mjs';
import {applyFilters,isAbortError,selectRows} from '../../loc/db-query.mjs';
const ScopeGroupOverview=dynamic(()=>import('../../loc/ScopeGroupOverview'),{loading:()=>null});
const ScopeEditableBlocks=dynamic(()=>import('../../loc/ScopeEditableBlocks'),{loading:()=>null});
// Explanatory Scope blocks are fetched only when their Search tab opens.
const TraceBlocks=dynamic(()=>import('./TraceBlocks'),{loading:()=>null});


const MEDIA_EDITOR_COLUMNS='uid,location,type,title,url,description,createtime';
const MEDIA_ATTR_ORDER=['uid','location','type','url','description','createtime'];
const MEDIA_ATTR_FIELDS=MEDIA_ATTR_ORDER.map(key=>({key,readOnly:key==='uid',kind:key==='createtime'?'date':'text'}));

const GALAXY_EDITOR_COLUMNS='uid,title,content,createtime,location,place_id,UpdateTime,url,source_id,target_id,ref_id,site,media_link,statics,culture,search,trace,list,keyword,extract,others';

const GALAXY_ATTR_ORDER=Object.freeze([
  'uid','title','content','createtime','location','place_id',
  'UpdateTime','url','source_id','target_id','ref_id','site',
  'media_link','statics','culture','search','trace','list','keyword','extract','others'
]);
const GALAXY_ATTR_FIELDS=Object.freeze(GALAXY_ATTR_ORDER.map(key=>({
  key,
  readOnly:['uid','title','content','UpdateTime'].includes(key),
  kind:['statics','culture','search','trace','list','keyword','extract','others'].includes(key)?'boolean':
    ['target_id','media_link'].includes(key)?'array':
    key==='createtime'?'date':'text'
})));

function canManageSearchScope(account,scopeId){
  const id=String(scopeId||'').trim();
  const normalized=id.toLowerCase();
  const ownScope=Array.isArray(account.scopes)&&account.scopes.some(scope=>String(scope?.id||'').trim().toLowerCase()===normalized);
  return Boolean(account.role==='admin'||account.canManageGlobalSync?.()||ownScope||account.canManageScopeSync(id)||account.canManageScopeSync(normalized));
}

async function selectPublicEditableRow(table,idColumn,id,columns,{authenticated=false}={}){
  const {rows=[]}=await selectRows(table,{
    columns,
    filters:[{column:idColumn,operator:'eq',value:String(id)}],
    limit:1,authenticated
  });
  return rows[0]||null;
}

function escapeSearchRegExp(value){
  return String(value||'').replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');
}
function highlightSearchText(text='',query=''){
  const source=String(text||''),raw=String(query||'').trim();
  if(!source||!raw)return source;
  const terms=[...new Set([parseSearchQuery(raw).exact,...parseSearchQuery(raw).terms].filter(Boolean))].sort((a,b)=>b.length-a.length);if(!terms.length)return source;
  const pattern=new RegExp('('+terms.map(escapeSearchRegExp).join('|')+')','giu');
  const normalized=new Set(terms.map(term=>term.normalize('NFKC').toLocaleLowerCase('zh-Hant')));
  return source.split(pattern).map((part,index)=>{
    const key=part.normalize('NFKC').toLocaleLowerCase('zh-Hant');
    return normalized.has(key)?<mark className="scope-search-highlight" key={index}>{part}</mark>:part;
  });
}


function toResult(row,source,scopeId,copy=UI_COPY){
  // Results are Galaxy articles. Anchor data is only available via a
  // selected article's existing time/space/keyword/media relationships.
  const isMedia=Boolean(row.uid&&(row.record_type==='galaxy_media'||
    String(row.__table||'').endsWith('_media')));
  const isGalaxy=Boolean(row.uid)&&!isMedia;
  const explicitTitle=workDisplayText(row.title||row.name||row.display_title||row.label||row.rune_name||row.song_id||row.id||'').trim();
  const fallbackTitle=isMedia?MEDIA_FALLBACK_TITLE:WORK_FALLBACK_TITLE;
  const title=(isGalaxy||isMedia)
    ?workDisplayHeading(row,{media:isMedia,fallback:fallbackTitle,limit:80})
    :(explicitTitle||fallbackTitle);
  const displaySource=isGalaxy&&row.site?String(row.site):source;
  const identity=row.uid||row.song_id||row.rune_id||row.record_id||row.resource_id||row.id;
  const scope=String(row.scope_id||scopeId||'').trim();
  const dbId=String(row.__db_id||row.db_id||row.dbId||'').trim();
  // ZModel virtual federation identity; DB aliases remain opaque user-set IDs.
  const globalUid=isGalaxy&&/^[a-z][a-z0-9_-]{0,63}$/.test(dbId)&&
    /^[a-z][a-z0-9]{0,14}$/.test(scope)&&
    /^[A-Za-z0-9]{8}$/.test(String(row.uid||''))
    ?locGlobalUid({databaseId:dbId,scopeId:scope,uid:row.uid}):'';
  const resourceType=isGalaxy?'galaxy':isMedia?'galaxy_media':'';
  const resourceId=row.uid||'';
  const editableTable=resourceType?String(row.__table||''):'';
  const editableIdColumn=resourceType
    ?(resourceType==='galaxy'?'uid':'uid')
    :'';
  const editResourceId=resourceId;
  const editableField=resourceType==='galaxy'?'content':resourceType==='galaxy_media'?'description':'';
  const isScopeCard=Boolean(row.scope_card);
  const href=isScopeCard?scopeHref(scope):(row.url||row.href||row.suno_url||'');
  return {
    key:globalUid?'galaxy:'+globalUid:
      identity?[scope,dbId,source,identity].join(':'):[source,scope,dbId,title].join('-'),
    source:displaySource,title:String(title),
    checkInPlace:'',
    date:row.date||row.createtime||row.address||row.record_date||row.UpdateTime||row.updated_at||'',
    createtime:row.createtime||'',
    snippet:'',...(isGalaxy?{statics:row.statics,culture:row.culture,search:row.search,trace:row.trace,list:row.list,keyword:row.keyword,others:row.others,extract:row.extract}:{}),
    scopeId:scope,dbId,globalUid,federated:Boolean(row.__federated),resourceType,resourceId,
    relatedMedia:Array.isArray(row.related_media)?row.related_media:[],
    relatedTime:row.related_time||null,
    relatedSpace:row.related_space||null,
    relatedStatistics:row.related_statistics||null,
    tracePlace:row.trace_place||null,
    locationName:String(row.location||'').trim(),
    styleTagMatch:Boolean(row.style_keyword_tag),
    styleIntroText:row.style_keyword_tag?workDisplayText(row.style_description||''):'',
    editableTable,editableIdColumn,editResourceId,editableField,isScopeCard,href,
    editRow:resourceType?row:null,
    relationLinks:resourceType==='galaxy'
      ?galaxyRelationLinks(scope,row)
      :[],
    dedupeKey:resourceType==='galaxy'&&typeof row.content==='string'
      ?'article-copy:'+JSON.stringify([scope,dbId,
        String(row.title||'').normalize('NFKC').trim(),
        String(row.content||'').replace(/[\r\n]/g,'').trim(),
        String(row.site||'').normalize('NFKC').trim(),
        String(row.createtime||''),String(row.url||'').trim()])
      :'',
    groupKey:row.style_keyword_tag
      ?'style-tag:'+String(title).normalize('NFKC').trim().toLocaleLowerCase('zh-Hant')
      :(resourceType==='galaxy'&&resourceId
      ?'galaxy:'+(globalUid||scope+':'+dbId+':'+resourceId)
      :(resourceType==='galaxy_media'&&resourceId?'media:'+scope+':'+dbId+':'+resourceId:
        'result:'+scope+':'+dbId+':'+(identity||title))),
    links:uniqueExternalLinks([...(href?[{id:resourceType||'primary',href,label:resourceType==='galaxy_media'?copy.search.mediaLink:copy.search.externalLink}]:[]),...(Array.isArray(row.resolved_links)?row.resolved_links:[])]),
    destinations:[]
  };
}


// Only after a real search, and only for current-page article IDs.
async function loadPageSearchExcerpts(rows,query,scopeById,{authenticated=false,signal}={}){
  if(!String(query||'').trim())return new Map();
  const groups=new Map();
  for(const row of rows){
    if(row.resourceType!=='galaxy'||!row.resourceId||
      row.search===false||row.extract===false)continue;
    if(!groups.has(row.scopeId))groups.set(row.scopeId,new Set());
    groups.get(row.scopeId).add(row.resourceId);
  }
  const snippets=new Map();
  for(const [scopeId,ids] of groups){
    if(signal?.aborted)break;
    const scope=scopeById.get(scopeId);
    if(!scope?.galaxy)continue;
    try{
      const {rows:articles=[]}=await selectRows(scope.galaxy,{
        columns:scopeId==='local'?'uid,content,able':'uid,content,search,extract',
        filters:[{column:'uid',operator:'in',value:[...ids]}],
        limit:ids.size,authenticated,signal
      });
      for(const article of articles){
        if(galaxyAble(article).search===false||galaxyAble(article).extract===false)continue;
        const excerpt=extractSearchContext(article.content,query,10);
        if(excerpt)snippets.set(scopeId+':'+article.uid,excerpt);
      }
    }catch{
      if(signal?.aborted)break;
    }
  }
  return snippets;
}
function uniqueExternalLinks(links=[]){
  const byHref=new Map();
  for(const link of links){
    const href=String(link?.href||'').trim();
    if(!/^https?:\/\//i.test(href))continue;
    const prior=byHref.get(href);
    if(!prior||([UI_COPY.search.externalLink,UI_COPY.search.mediaLink].includes(prior.label)&&![UI_COPY.search.externalLink,UI_COPY.search.mediaLink].includes(link.label)))byHref.set(href,link);
  }
  return [...byHref.values()];
}
function mergeSummaryResults(rows=[],copy=UI_COPY){
  const groups=new Map();
  for(const row of rows){
    const key=row.dedupeKey||row.groupKey||row.key;
    if(!groups.has(key)){
      groups.set(key,{...row,links:[...(row.links||[])]});
      continue;
    }
    const current=groups.get(key);
    const preferRow=current.resourceType==='galaxy'?current:(row.resourceType==='galaxy'?row:current);
    const links=[...(current.links||[]),...(row.links||[])];
    const uniqueLinks=[...new Map(links.filter(link=>link?.href).map(link=>[link.href,link])).values()]
      .map((link,index)=>({...link,label:(links.length>1&&link.label===copy.search.mediaLink)?copy.format.songLink(index+1):link.label}));
    groups.set(key,{
      ...preferRow,
      links:uniqueExternalLinks(uniqueLinks),
      destinations:[...(current.destinations||[]),...(row.destinations||[])].filter((item,index,all)=>all.findIndex(other=>other.href===item.href&&other.label===item.label)===index),
      relationLinks:[...(current.relationLinks||[]),...(row.relationLinks||[])].filter((item,index,all)=>all.findIndex(other=>other.href===item.href&&other.label===item.label)===index)
    });
  }
  return [...groups.values()];
}

function prioritizeStyleTagResults(rows=[]){
  return [...rows].sort((left,right)=>Number(Boolean(right.styleTagMatch))-Number(Boolean(left.styleTagMatch)));
}


function searchHref(scopeId,query,filters={}){
  const href=featureNavigationHref(scopeId,'search',filters.placeOnly?{place:query}:{q:query});
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries({
    type:filters.contentType,source:filters.sourceFilter,
    from:filters.startDate,to:filters.endDate,scope:filters.scopeFilter
  })){
    if(value)params.set(key,value);
  }
  return href+(params.size?(href.includes('?')?'&':'?')+params.toString():'');
}


export default function Search({managementMode:legacyManagementRoute=false}){
  useUiSection('search');
  useUiSection('uiExtra.searchUI');
  useUiSection('uiExtra.editBlocks');
  useUiSection('uiExtra.cultureView');
  useUiSection('uiExtra.pagination');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const defaultTimeUnit=useDefaultTimeUnit();
  const {scopeId,scope}=useScopeRuntime();
  const {settings:userSettings,active:userActive}=useLocFeatureSettings('search');
  // Personal list visibility is opt-in, even for an administrator.
  const adminListRequested=Boolean(userActive&&userSettings.list===true);
  const editDock=useEditDock();
  const publicScopeEditing=Boolean(editDock?.active&&editDock.scopeId===scopeId&&scopeId!=='loc');
  const account=useAccount({enabled:adminListRequested||publicScopeEditing||legacyManagementRoute});
  // LOC's public Search is global. Only the separate authorized management
  // workspace may narrow the query to a specific Scope.
  const managementAuthorized=Boolean(adminListRequested&&account.user&&!account.loading&&!account.permissionLoading&&
    (scopeId==='loc'?(account.canManageGroupSync('loc')||account.scopes.length>0):canManageSearchScope(account,scopeId)));
  const managementMode=Boolean(adminListRequested&&managementAuthorized);
  const locPublicSearch=scopeId==='loc'&&!managementMode;
  const searchParams=useSearchParams();
  const router=useRouter();
  const resourceCache=useResourceCache();
  const [publicView,setPublicView]=useState('search');
  const [query,setQuery]=useState('');
  const [searchPopularOpen,setSearchPopularOpen]=useState(false);
  const [placeOnly,setPlaceOnly]=useState(false);
  const [selectedPlaceArticles,setSelectedPlaceArticles]=useState([]);
  const [bulkPlace,setBulkPlace]=useState('');
  const [bulkPreview,setBulkPreview]=useState(null);
  const [bulkBusy,setBulkBusy]=useState(false);
  const [bulkNotice,setBulkNotice]=useState('');
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [advancedTab,setAdvancedTab]=useState('type');
  const [contentType,setContentType]=useState('');
  const [sourceFilter,setSourceFilter]=useState('');
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['statistics-source-taxonomy'],
    queryFn:selectSourceTaxonomy,
    enabled:advancedOpen&&advancedTab==='source'||sourceFilter.startsWith('category:'),
  });
  const [scopeFilter,setScopeFilter]=useState('');
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [browseResults,setBrowseResults]=useState(false);
  const activeSearchOptionsRef=useRef(null);
  const [results,setResults]=useState([]);
  const [articleSort,setArticleSort]=useState('desc');
  useEffect(()=>setArticleSort(userActive?userSettings.sort:'desc'),[userActive,userSettings.sort]);
  const [status,setStatus]=useState(UI_COPY.search.start);
  const [error,setError]=useState('');
  const [loadMoreError,setLoadMoreError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [nextCursor,setNextCursor]=useState(null);
  const [loadingMore,setLoadingMore]=useState(false);
  const [editingKey,setEditingKey]=useState('');
  const editTargetRef=useRef(null);
  const dockActions=useRef({save:null,discard:null});
  const [editDraft,setEditDraft]=useState(null);
  const [editBusy,setEditBusy]=useState(false);
  const [editError,setEditError]=useState('');
  const [fullTextKey,setFullTextKey]=useState('');
  const [fullText,setFullText]=useState('');
  const [fullTextRow,setFullTextRow]=useState(null);
  // A guest can see Edit; authorization is requested only after the click.
  const [authorizedEditingKey,setAuthorizedEditingKey]=useState('');
  const [fullTextError,setFullTextError]=useState('');
  const [fullTextLoading,setFullTextLoading]=useState(false);
  const searchId=useRef(0);
  const lastTextSearchAt=useRef(0);
  // Anchors the status/results block so a fresh search can scroll the
  // results into view instead of leaving the viewport on the search form.
  const resultsRef=useRef(null);
  const scrollPending=useRef(false);
  const [arrivalVersion,setArrivalVersion]=useState(0);
  const reduceMotion=useReducedMotion();
  // The results list is not rendered yet when a search resolves, so the page is
  // still too short to scroll; flag it and scroll once the new results are committed.
  function scrollToResults(){scrollPending.current=true;}
  // Every search owns an AbortController; a newer search, a reset or unmount
  // cancels the previous one so superseded requests stop instead of piling up.
  const abortRef=useRef(null);
  const beginRequest=()=>{
    abortRef.current?.abort();
    const controller=new AbortController();
    abortRef.current=controller;
    return controller;
  };
  useEffect(()=>()=>{abortRef.current?.abort();},[]);
  useEffect(()=>{
    if(!scrollPending.current)return;
    scrollPending.current=false;
    resultsRef.current?.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});
    // The search already owns the scroll. A brief accent cue confirms that
    // navigation landed at the result block without re-animating every card.
    setArrivalVersion(version=>version+1);
  },[results,status,error,reduceMotion]);
  const loadMoreInFlight=useRef(false);
  const matchedQueryRef=useRef('');
  const pageSize=DEFAULT_LIST_BATCH_SIZE;
  // LOC searches across every active, search-enabled public content tree.
  // The Scope registry is an internal query input, never a public search filter.
  const aggregateScopes=Boolean(scope?.aggregateChildren&&scopeId!=='loc');
  const scopesQuery=useAsyncResource({
    queryKey:managementMode?['management-search-scopes',account.email]:['loc-searchable-scopes'],
    queryFn:managementMode?()=>selectScopeRegistry({scopeKind:'scope'}):selectLocSearchScopes,
    enabled:scopeId==='loc'&&!aggregateScopes&&(!managementMode||managementAuthorized),
  });
  const availableScopes=useMemo(()=>{
    if(scopeId!=='loc')return [account.scopeDataFor(scopeId)||defaultScopeData(scopeId)].filter(Boolean);
    if(!managementMode)return scopesQuery.data||[];
    return (scopesQuery.data||[])
      .filter(item=>item.scope_kind==='scope'&&canManageSearchScope(account,item.scope_id))
      .map(item=>{
        const data=account.scopeDataFor(item.scope_id)||defaultScopeData(item.scope_id);
        return data?{...data,display_name:String(item.display_name||item.scope_id)}:null;
      }).filter(Boolean);
  },[scopeId,scopesQuery.data,managementMode,account.authorizer]);
  const targetScopes=useMemo(()=>scopeId==='loc'&&managementMode&&scopeFilter
    ?availableScopes.filter(item=>item.id===scopeFilter)
    :availableScopes,[scopeId,managementMode,scopeFilter,availableScopes]);
  // Public Search: Pattern-only suggestions; management text input: none.
  const patternScopeIds=useMemo(()=>targetScopes.map(item=>item.id),[targetScopes]);
  const patternSuggestions=useMemo(()=>
    managementMode?[]:blockNoteSuggestionItems('pattern',
      publicPatternSuggestions(patternScopeIds,query),query,36).map(item=>item.title),
    [managementMode,patternScopeIds,query]);

  const summaryScopeIds=targetScopes.map(item=>item.id);
  const scopeLabel=id=>{
    const item=scopeById.get(id);
    // A result may show its published source name, never an inventory of IDs.
    // Management pages can identify only the Scopes their user can manage.
    if(locPublicSearch){
      const label=String(item?.display_name||'').trim();
      return label&&label!==id?label:'';
    }
    return item?`${item.display_name||id}(${id})`:id;
  };
  // Keep LOC's per-Scope sections and style suggestions, then order the
  // loaded article pages by their publication date.
  const orderedResults=useMemo(()=>{
    const scopes=new Map(availableScopes.map((item,index)=>[item.id,index]));
    return results.map((row,index)=>({row,index})).sort((a,b)=>{
      const group=scopeId==='loc'
        ?(scopes.get(a.row.scopeId)??Infinity)-(scopes.get(b.row.scopeId)??Infinity):0;
      if(group)return group;
      const style=Number(Boolean(b.row.styleTagMatch))-Number(Boolean(a.row.styleTagMatch));
      if(style)return style;
      const left=String(a.row.date||'').slice(0,19);
      const right=String(b.row.date||'').slice(0,19);
      if(!left||!right)return left? -1:right?1:a.index-b.index;
      const date=left.localeCompare(right);
      return date?(articleSort==='desc'?-date:date):a.index-b.index;
    }).map(item=>item.row);
  },[results,scopeId,availableScopes,articleSort]);
  const advancedRef=useRef(null);
  const collectionLabel=scopeId==='loc'?UI_COPY.search.allContent:String(scope?.label||scopeId);

  async function loadGalaxyDetail(result){
    const scopeData=scopeById.get(result.scopeId);
    if(!scopeData)throw new Error(UI_COPY.search.fullTextNotFound);
    const id=result.editResourceId||result.resourceId;
    return selectGalaxyIdentity(scopeData,id,{includeHidden:canManageSearchScope(account,result.scopeId),dbId:result.dbId||'',federated:result.federated===true});
  }

  async function executeSearch(rawQuery,cursor=null,{append=false,browse=false,overrideOptions=null}={}){
    const q=String(rawQuery||'').trim();
    const options=append&&activeSearchOptionsRef.current
      ?activeSearchOptionsRef.current
      :(overrideOptions||{contentType,sourceFilter,startDate,endDate,scopeFilter:managementMode?scopeFilter:'',placeOnly,browse,sortDirection:articleSort});
    if(!q&&!options.browse)return;
    // Avoid sending rapid repeated full-text requests at all; pagination and
    // explicit article lists remain unaffected by search cooldown.
    if(!append&&!options.browse&&q){
      const now=Date.now();
      const remaining=3000-(now-lastTextSearchAt.current);
      if(lastTextSearchAt.current&&remaining>0){
        setError('搜尋操作太快，請於 '+Math.ceil(remaining/1000)+' 秒後重試');
        return;
      }
      lastTextSearchAt.current=now;
    }
    const searchScopes=scopeId==='loc'&&options.scopeFilter
      ?availableScopes.filter(item=>item.id===options.scopeFilter)
      :availableScopes;
    if(scopeId==='loc'&&options.scopeFilter&&!searchScopes.length){
      setError(t('uiExtra.searchUI.scopeUnavailable'));return;
    }
    const searchCollectionLabel=scopeId==='loc'&&options.scopeFilter
      ?scopeLabel(options.scopeFilter):collectionLabel;
    if(options.startDate&&options.endDate&&options.startDate>options.endDate){
      setError(t('uiExtra.searchUI.invalidDateRange'));return;
    }
    if(!append){activeSearchOptionsRef.current=options;setBrowseResults(options.browse);}

    const id=++searchId.current;
    const controller=beginRequest();
    const timeout=AbortSignal.timeout(25000);
    const signal=AbortSignal.any([controller.signal,timeout]);
    // A hung routing or hydration Promise may never settle on abort. Release
    // the visible loading state when the timeout actually fires.
    const onTimeout=()=>{
      if(id!==searchId.current||controller.signal.aborted)return;
      if(append){
        setLoadMoreError(UI_COPY.search.timeout);
        setLoadingMore(false);
        loadMoreInFlight.current=false;
      }else{
        setError(UI_COPY.search.timeout);
        setStatus('');
        scrollToResults();
      }
      controller.abort();
    };
    timeout.addEventListener('abort',onTimeout,{once:true});
    // A fresh search supersedes any in-flight style-keyword fetch for the same key.
    setError('');
    if(append){
      setLoadMoreError('');
      setLoadingMore(true);
    }else{
      // A fresh query must clear any pagination state left by the previous one.
      loadMoreInFlight.current=false;
      setLoadingMore(false);
      setLoadMoreError('');
      setEditingKey('');setEditDraft(null);
      setFullTextKey('');setFullText('');setFullTextRow(null);setFullTextError('');
      matchedQueryRef.current='';
      setHasMore(false);
      setNextCursor(null);
      setResults([]);
      setSelectedPlaceArticles([]);setBulkPreview(null);setBulkNotice('');
      setStatus('搜尋中請稍後');
    }
    try{
      // The category is a semantic database filter, not a literal
      // site. Fetch the same cached taxonomy before searching.
      const sourceTaxonomy=String(options.sourceFilter||'').startsWith('category:')
        ?await resourceCache.getOrLoad({
          queryKey:['statistics-source-taxonomy'],
          queryFn:selectSourceTaxonomy,
        })
        :null;
      if(id!==searchId.current)return;
      // Search is one request: return title and date only. Article details load on entry.
      const search=await searchGalaxyRows(searchScopes,q,{
        limit:pageSize,cursor,
        hiddenScopeIds:managementMode?searchScopes.map(item=>item.id):[],
        contentType:options.contentType,sourceFilter:options.sourceFilter,sourceTaxonomy,
        placeOnly:managementMode&&Boolean(options.placeOnly),
        startDate:options.startDate,endDate:options.endDate,browse:options.browse,
        managementOnly:managementMode,sortDirection:options.sortDirection,signal
      });
      if(id!==searchId.current)return;
      const searchRows=search.rows||[];
      if(id!==searchId.current)return;


      if(!append)matchedQueryRef.current=q;
      const converted=[];const seen=new Set();
      for(const {row,source} of searchRows){
        const result=toResult(row,source,scopeId,UI_COPY);
        if(!result||seen.has(result.key))continue;
        seen.add(result.key);converted.push(result);
      }
      const pageResults=prioritizeStyleTagResults(mergeSummaryResults(converted,UI_COPY));
      setResults(current=>append?mergeSummaryResults([...current,...pageResults],UI_COPY):pageResults);
      setHasMore(Boolean(search.hasMore));
      setNextCursor(search.nextCursor??null);
      const partial=(search.failures?.length)?t('uiExtra.searchUI.partialExtendedData'):'';
      if(!append){
        setStatus(!pageResults.length&&!search.hasMore
          ?search.failures?.length?UI_COPY.search.failed:UI_COPY.search.empty
          :options.browse?t('uiExtra.searchUI.browsingResults'):UI_COPY.format.searchResult({label:'「'+searchCollectionLabel+'」',query:q,hasMore:search.hasMore,partial}));
        scrollToResults();
      }
      if(wantsStyleTags&&!styleResult){
        // Append optional matches only while the original query and filters are current.
        void stylePromise.then(({rows})=>{
          if(signal.aborted||activeSearchOptionsRef.current!==options||!rows?.length)return;
          const additional=rows.map(({row,source})=>toResult(row,source,scopeId,UI_COPY)).filter(Boolean);
          if(!additional.length)return;
          setResults(current=>prioritizeStyleTagResults(mergeSummaryResults([...additional,...current],UI_COPY)));
          setStatus(UI_COPY.format.searchResult({
            label:'「'+searchCollectionLabel+'」',query:q,hasMore:search.hasMore,
            partial:search.failures?.length?t('uiExtra.searchUI.partialExtendedData'):''
          }));
        });
      }
    }catch(exception){
      if(id!==searchId.current||controller.signal.aborted)return;
      if(timeout.aborted){
        if(append)setLoadMoreError(UI_COPY.search.timeout);
        else{setError(UI_COPY.search.timeout);setStatus('');scrollToResults();}
        return;
      }
      // A database's own read timeout must also clear the loading state.
      if(isAbortError(exception)){
        if(append)setLoadMoreError(UI_COPY.search.timeout);
        else{setError(UI_COPY.search.timeout);setStatus('');scrollToResults();}
        return;
      }
      if(append){
        setLoadMoreError(featureDataErrorMessage(exception,UI_COPY));
      }else{
        setError(featureDataErrorMessage(exception,UI_COPY));
        setStatus(UI_COPY.search.failed);
        scrollToResults();
      }
    }finally{
      timeout.removeEventListener('abort',onTimeout);
      if(append&&id===searchId.current)setLoadingMore(false);
    }
  }

  async function loadNextSearch(){
    const q=matchedQueryRef.current||query.trim();
    if((!q&&!activeSearchOptionsRef.current?.browse)||!hasMore||loadMoreInFlight.current||nextCursor===null)return;
    loadMoreInFlight.current=true;
    try{
      const active=activeSearchOptionsRef.current;
      await executeSearch(q,nextCursor,{append:true,browse:active?.browse});
    }
    finally{loadMoreInFlight.current=false;}
  }
  function changeArticleSort(direction){
    if(direction===articleSort)return;
    setArticleSort(direction);
    const active=activeSearchOptionsRef.current;
    if(active){
      executeSearch(matchedQueryRef.current,null,{
        browse:Boolean(active.browse),overrideOptions:{...active,sortDirection:direction}
      });
    }
  }

  async function executeIdentity(rawIdentity){
    const identity=String(rawIdentity||'').trim();
    if(!identity)return;
    const id=++searchId.current;
    beginRequest();
    matchedQueryRef.current='';
    setError('');setLoadMoreError('');setHasMore(false);setNextCursor(null);setLoadingMore(false);
    setFullText('');setFullTextRow(null);setFullTextError('');setFullTextLoading(true);
    setStatus(UI_COPY.search.loadingRelation);
    try{
      let detail=null;
      let detailScope=scopeId;
      const identityScope=managementMode?String(searchParams?.get('scope')||'').trim():'';
      const detailScopes=identityScope?availableScopes.filter(scope=>scope.id===identityScope):targetScopes;
      for(const scopeData of detailScopes){
        detail=await selectGalaxyIdentity(scopeData,identity,{includeHidden:canManageSearchScope(account,scopeData.id)});
        if(detail){detailScope=scopeData.id;break;}
      }
      if(id!==searchId.current)return;
      if(!detail)throw new Error(UI_COPY.search.notFound);
      const result=toResult({...detail,resolved_links:detail.links||[]},detail.site||UI_COPY.search.displaySource,detailScope);
      setResults([result]);
      setFullTextKey(result.key);
      setFullText(workDisplayText(detail.content||''));
      setFullTextRow(null);
      setStatus('');
    }catch(exception){
      if(id!==searchId.current)return;
      setResults([]);setError(featureDataErrorMessage(exception,UI_COPY));setStatus(UI_COPY.search.relationFailed);
    }finally{
      if(id===searchId.current)setFullTextLoading(false);
    }
  }

  async function executeMediaIdentity(rawMediaId){
    const mediaId=String(rawMediaId||'').trim(),id=++searchId.current;
    beginRequest();
    setError('');setStatus('');setResults([]);setEditDraft(null);setEditingKey('');
    setHasMore(false);setNextCursor(null);setFullText('');setFullTextRow(null);
    try{
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId))throw new Error(t('uiExtra.searchUI.invalidMediaId'));
      const mediaScopeId=managementMode&&scopeId==='loc'?String(searchParams?.get('scope')||'').trim():scopeId;
      if(!managementMode||!mediaScopeId||!canManageSearchScope(account,mediaScopeId))throw new Error(t('uiExtra.searchUI.mediaManageDenied'));
      const scopeData=account.scopeDataFor(mediaScopeId)||defaultScopeData(mediaScopeId);
      if(!scopeData?.galaxyMedia)throw new Error(UI_COPY.search.notFound);
      const row=await selectPublicEditableRow(scopeData.galaxyMedia,'uid',mediaId,MEDIA_EDITOR_COLUMNS,{authenticated:true});
      if(id!==searchId.current)return;
      if(!row)throw new Error(UI_COPY.search.notFound);
      const item=toResult({...row,scope_id:mediaScopeId,__table:scopeData.galaxyMedia},'Galaxy Media',mediaScopeId);
      const {SearchEditDraft}=await import('./search-edit-draft');
      setResults([item]);setEditingKey(item.key);setEditDraft(SearchEditDraft.fromRow('media',row,item.title));
    }catch(exception){if(id===searchId.current)setError(String(exception?.message||exception||UI_COPY.search.editLoadFailed))}
  }

  useEffect(()=>{
    if(managementMode&&!managementAuthorized)return;
    if(scopeId==='loc'&&!scopesQuery.isSuccess)return;
    const identity=String(searchParams?.get('identity')||'').trim();
    const media=String(searchParams?.get('media')||'').trim();
    if(media){setQuery('');executeMediaIdentity(media);return;}
    const place=String(searchParams?.get('place')||'').trim();
    const fillPlace=String(searchParams?.get('fill_place')||place||'').trim();
    if(fillPlace)setBulkPlace(fillPlace);
    const value=String(searchParams?.get('q')||'').trim();
    if(identity){setQuery('');executeIdentity(identity);return;}
    const filters={
      contentType:String(searchParams?.get('type')||''),
      sourceFilter:String(searchParams?.get('source')||''),
      startDate:String(searchParams?.get('from')||''),
      endDate:String(searchParams?.get('to')||''),
      scopeFilter:managementMode?String(searchParams?.get('scope')||''):''
    };
    setContentType(filters.contentType);setSourceFilter(filters.sourceFilter);
    setStartDate(filters.startDate);setEndDate(filters.endDate);
    if(managementMode)setScopeFilter(filters.scopeFilter);
    const term=place||value;
    setPlaceOnly(Boolean(place));
    if(term){setQuery(term);executeSearch(term,null,{overrideOptions:{...filters,placeOnly:managementMode&&Boolean(place),browse:false}});}
  },[searchParams,scopeId,scopesQuery.isSuccess,scopesQuery.data,managementMode,managementAuthorized]);



  async function toggleFullText(result){
    if(fullTextKey===result.key){
      setFullTextKey('');
      setFullText('');
      setFullTextRow(null);
      setFullTextError('');
      return;
    }
    if(result.resourceType!=='galaxy'||!result.editableTable)return;
    setFullTextKey(result.key);
    setFullText('');
    setFullTextRow(null);
    setFullTextError('');
    setFullTextLoading(true);
    try{
      const fullRow=await loadGalaxyDetail(result);
      if(!fullRow)throw new Error(UI_COPY.search.fullTextNotFound);
      setFullText(workDisplayText(fullRow.content||''));
      setFullTextRow(fullRow);
    }catch(exception){
      setFullTextError(String(exception?.message||exception||UI_COPY.search.fullTextFailed));
    }finally{
      setFullTextLoading(false);
    }
  }

  async function startEditing(result){
    if(!adminListRequested&&!publicScopeEditing)return;
    setEditingKey(result.key);setEditError('');
    setEditDraft(null);
    try{
      // The public Search/正文 view never probes silver.loc just to show Edit.
      // Management Search already checks its entrance. Public readers are
      // verified on the actual Edit action, never on opening article text.
      {
        // The preference opens the interface, never grants write permission.
        // Verify the current Scope when the user actually enters its editor.
        const verified=await account.refresh({forceVerify:true});
        const grants=verified?.authorizer;
        if(!verified?.user||!(grants?.canManageScopeSync(result.scopeId)||
          grants?.canManageGlobalSync()||grants?.canManageGroupSync('loc')))
          throw new Error('請先登入具有此 Scope 編輯權限的帳號。');
        setAuthorizedEditingKey(result.key);
      }
      // A reading UID fetch intentionally omits editor-only attributes.
      // Query the complete, authorized editor projection only on Edit.
      const fullRow=await selectPublicEditableRow(
        result.editableTable,
        result.editableIdColumn,
        result.editResourceId||result.resourceId,
        result.resourceType==='galaxy'
          ?(result.scopeId==='local'
            ?'uid,title,content,createtime,location,UpdateTime,url,source_id,target_id,ref_id,site,media_link,able'
            :GALAXY_EDITOR_COLUMNS)
          :MEDIA_EDITOR_COLUMNS,
        {authenticated:result.resourceType==='galaxy'}
      );
      if(!fullRow)throw new Error(UI_COPY.search.editNotFound);
      const {SearchEditDraft}=await import('./search-edit-draft');
      editTargetRef.current=result;
      setEditDraft(SearchEditDraft.fromRow(result.resourceType,fullRow,result.title));
      if(managementMode)editDock?.begin(scopeId);
    }catch(exception){
      setEditingKey('');
      setAuthorizedEditingKey('');
      const message=String(exception?.message||exception||UI_COPY.search.editLoadFailed);
      setEditError(message);
      if(!managementMode)setFullTextError(message);
    }
  }
  async function saveEditing(result){
    if(!adminListRequested||authorizedEditingKey!==result?.key)return false;
    if(!editDraft||!result?.editableTable||!result.editableField||editBusy)return false;
    setEditBusy(true);setEditError('');
    try{
      const isGalaxy=result.resourceType==='galaxy';
      const {SearchEditDraft}=await import('./search-edit-draft');
      const {blocksToPlainText}=isGalaxy?await import('../../loc/blocknote-content.mjs'):{blocksToPlainText:null};
      const body=isGalaxy?await requireGalaxyContent(editDraft.bodyHtml??blocksToPlainText(editDraft.bodyBlocks)):'';
      const nextTitle=isGalaxy?resolveGalaxyTitle(editDraft.title,blocksToPlainText(editDraft.bodyHtml??editDraft.bodyBlocks)):SearchEditDraft.nullableText(editDraft.title);
      const titleChanged=editDraft.title!==editDraft.originalTitle;
      let contentPatch;
      if(isGalaxy){
        const rawEdits=Object.fromEntries(Object.entries(editDraft.attrs||{})
          .filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(editDraft.originalAttrs?.[key])));
        assertPlainGalaxyAttributes({...rawEdits,...(titleChanged?{title:editDraft.title}:{})});
        const attrs=SearchEditDraft.changedAttributes('galaxy',editDraft,t);
        assertPlainGalaxyAttributes({...attrs,...(titleChanged?{title:nextTitle}:{})});
        contentPatch={...(titleChanged?{title:nextTitle}:{}),content:body,UpdateTime:new Date().toISOString(),...attrs};
      }else{
        const attrs=SearchEditDraft.changedAttributes('media',editDraft,t);
        const plainAttrs=attrs;
        assertPlainGalaxyAttributes({...plainAttrs,...(titleChanged?{title:nextTitle}:{})});
        contentPatch={...(titleChanged?{title:nextTitle}:{}),...attrs};
        if(!Object.keys(contentPatch).length){
          if(!managementMode){setEditingKey('');setEditDraft(null);}
          return true;
        }
      }
      await updateRows(result.editableTable,contentPatch,{filters:[{column:result.editableIdColumn,operator:'eq',value:result.editResourceId||result.resourceId}]});
      setResults(current=>current.map(item=>{
        if(item.key!==result.key)return item;
        const updatedUrl=Object.hasOwn(contentPatch,'url')?contentPatch.url:item.editRow?.url;
        const links=!isGalaxy&&Object.hasOwn(contentPatch,'url')?uniqueExternalLinks(updatedUrl?[{id:'media-url',href:updatedUrl,label:UI_COPY.search.mediaLink}]:[]):item.links;
        return {...item,title:nextTitle||item.title,snippet:isGalaxy?'':item.snippet,links,
          editRow:{...(item.editRow||{}),title:nextTitle,...contentPatch}};
      }));
      if(isGalaxy&&fullTextKey===result.key){
        setFullText(body);
        setFullTextRow(current=>({...current,...contentPatch,uid:current?.uid||result.editResourceId||result.resourceId}));
      }
      if(managementMode){
        setEditDraft(current=>current?{
          ...current,originalTitle:nextTitle,
          ...(isGalaxy?{body,bodyHtml:body}:{}),
          originalAttrs:{...current.attrs}
        }:current);
      }else{
        setEditingKey('');setEditDraft(null);setAuthorizedEditingKey('');
      }
      setStatus('');
      return true;
    }catch(exception){
      const message=String(exception?.message||exception||UI_COPY.search.saveFailed);
      setEditError(message);
      if(editDock?.active)editDock.setNotice(message);
      return false;
    }
    finally{setEditBusy(false)}
  }
  async function deleteEditing(result){
    if(!adminListRequested||authorizedEditingKey!==result?.key)return;
    if(!result?.editableTable||!result?.editableIdColumn||!result?.editResourceId)return;
    setEditBusy(true);setEditError('');
    try{
      await deleteRows(result.editableTable,{filters:[{column:result.editableIdColumn,operator:'eq',value:result.editResourceId}]});
      setResults(current=>current.filter(item=>item.key!==result.key));
      if(fullTextKey===result.key){setFullTextKey('');setFullText('');setFullTextRow(null);}
      setEditingKey('');setEditDraft(null);setAuthorizedEditingKey('');
      setStatus(t('uiExtra.editBlocks.deleted'));
    }catch(exception){
      setEditError(String(exception?.message||exception||t('uiExtra.editBlocks.deleteFailed')));
    }finally{setEditBusy(false)}
  }

  function resetSearchState(){
    ++searchId.current;
    abortRef.current?.abort();
    loadMoreInFlight.current=false;
    setLoadingMore(false);
    matchedQueryRef.current='';
    activeSearchOptionsRef.current=null;
    setResults([]);setSelectedPlaceArticles([]);setBulkPreview(null);setBulkNotice('');setHasMore(false);setNextCursor(null);setBrowseResults(false);
    setLoadMoreError('');setError('');setStatus(UI_COPY.search.start);
  }
  function updateSearchFilter(setter,value){
    setter(value);resetSearchState();
  }
  async function browseSelectedType(){
    await executeSearch('',null,{browse:true});
  }
  function clearSearchFilters(){
    setQuery('');setPlaceOnly(false);setBulkPlace('');setContentType('');setSourceFilter('');setScopeFilter('');
    setStartDate('');setEndDate('');setAdvancedOpen(false);
    resetSearchState();
    // Management queries stay in the authorized workspace. Only a public
    // search reset changes the public URL.
    if(!managementMode)router.replace(featureNavigationHref(scopeId,'search'));
  }
  // Type is an exact advanced-filter selection. Never search the type name.
  const filterTypes=[
    ['',t('uiExtra.searchUI.allTypes')],
    ['galaxy','文章'],
    ['lyrics_work',t('uiExtra.searchUI.lyricsType')],
    ['text_work',t('uiExtra.searchUI.textType')]
  ];
  const sourceCategories=(sourceTaxonomyQuery.data?.categories||[])
    .filter(row=>row.enabled!==false);
  const sourceAliases=(sourceTaxonomyQuery.data?.aliases||[])
    .filter(row=>String(row.source_key||'').trim());
  const filterSources=[
    ['',t('uiExtra.searchUI.allSources')],
    ...sourceCategories.map(row=>['category:'+row.category_code,row.display_name||row.category_code]),
    ...(!sourceCategories.some(row=>row.category_code==='others')
      ?[['category:others','Others']]:[]),
    ...sourceAliases.map(row=>['source:'+row.source_key,row.source_key])
  ];
  // Deep links created before taxonomy-backed filters keep their raw source.
  if(sourceFilter&&!filterSources.some(([value])=>value===sourceFilter)){
    filterSources.push([sourceFilter,sourceFilter.startsWith('category:')
      ?sourceFilter.slice(9):sourceFilter.replace(/^source:/,'')]);
  }
  const chips=[
    scopeId==='loc'&&managementMode&&scopeFilter&&scopeLabel(scopeFilter),
    contentType&&filterTypes.find(([value])=>value===contentType)?.[1],
    sourceFilter&&filterSources.find(([value])=>value===sourceFilter)?.[1],
    startDate&&t('uiExtra.searchUI.startDate')+': '+startDate,
    endDate&&t('uiExtra.searchUI.endDate')+': '+endDate,
  ].filter(Boolean);
  function workspaceSearchHref(term,filters={}){
    const href=searchHref(scopeId,term,filters);
    if(!managementMode)return href;
    const normal=new URL(href);
    const manager=new URL(scopeHref(scopeId,'search/manage'));
    for(const [key,value] of normal.searchParams){
      if(key!=='scopeid')manager.searchParams.set(key,value);
    }
    if(bulkPlace.trim())manager.searchParams.set('fill_place',bulkPlace.trim());
    return manager.href;
  }
  function searchFromSuggestion(raw,overrides={}){
    const term=String(raw||'').trim();
    if(!term)return;
    const filters={
      contentType,sourceFilter,startDate,endDate,
      scopeFilter:managementMode?scopeFilter:'',placeOnly,...overrides
    };
    if(managementMode){
      setQuery(term);
      void executeSearch(term,null,{overrideOptions:{
        ...filters,browse:false,sortDirection:articleSort
      }});
      return;
    }
    const url=workspaceSearchHref(term,filters);
    const current=workspaceSearchHref(String(searchParams?.get('place')||searchParams?.get('q')||'').trim(),{
      contentType:searchParams?.get('type'),sourceFilter:searchParams?.get('source'),
      startDate:searchParams?.get('from'),endDate:searchParams?.get('to'),
      scopeFilter:managementMode?searchParams?.get('scope'):'',placeOnly:Boolean(searchParams?.get('place'))
    });
    if(url!==current||searchParams?.get('identity')){
      // Query-only changes must not remount Search and its Scope/Auth loaders.
      // Next.js integrates native History API updates with useSearchParams;
      // the existing URL-driven effect then runs the search exactly once.
      if(new URL(url).pathname===window.location.pathname)
        window.history.pushState(null,'',url);
      else router.push(url,{scroll:false});
      return;
    }
    // Next.js does not remount for an identical URL; repeated suggestions must still search.
    setQuery(term);
    void executeSearch(term,null,{overrideOptions:{...filters,browse:false,sortDirection:articleSort}});
  }
  function runSearch(event){
    event.preventDefault();
    if(managementMode){
      // No router.push: navigation re-enters the permission gate, remounts
      // SearchManagement, and loses the user's query before results arrive.
      void executeSearch(query,null,{overrideOptions:{
        contentType:'',sourceFilter:'',startDate,endDate,scopeFilter,
        placeOnly,browse:false,sortDirection:articleSort
      }});
      return;
    }
    searchFromSuggestion(query);
  }

  dockActions.current={
    save:()=>saveEditing(editTargetRef.current),
    discard:()=>{setEditingKey('');setEditDraft(null);setEditError('')},
    isDirty:()=>Boolean(editDraft&&(
      editDraft.title!==editDraft.originalTitle||
      editDraft.bodyHtml!==editDraft.body||
      JSON.stringify(editDraft.attrs)!==JSON.stringify(editDraft.originalAttrs)
    )),
    isBusy:()=>editBusy
  };
  useEffect(()=>{
    if(!managementMode||!editingKey||!editDraft||!editDock?.active)return undefined;
    return editDock.register({
      save:()=>dockActions.current.save(),
      discard:()=>dockActions.current.discard(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[managementMode,editingKey,Boolean(editDraft),editDock?.active,editDock?.register]);

  const selectedScope=selectedPlaceArticles[0]?.scopeId||'';
  const selectedSignature=selectedPlaceArticles.map(row=>row.scopeId+':'+row.uid).sort().join('|')+'|'+bulkPlace.trim();
  const validBulkPlace=bulkPlace.trim().length>0&&bulkPlace.trim().length<=200;
  const selectedPreview=bulkPreview?.signature===selectedSignature?bulkPreview.data:null;
  function togglePlaceArticle(row,checked){
    setBulkPreview(null);setBulkNotice('');
    setSelectedPlaceArticles(current=>{
      if(!checked)return current.filter(item=>item.uid!==row.resourceId||item.scopeId!==row.scopeId);
      if(current.length>=200||current.length&&current[0].scopeId!==row.scopeId)return current;
      if(current.some(item=>item.uid===row.resourceId&&item.scopeId===row.scopeId))return current;
      return [...current,{uid:row.resourceId,scopeId:row.scopeId,title:row.title}];
    });
  }
  async function saveSelectedPlaces(apply=false){
    if(!managementMode||bulkBusy||!selectedPlaceArticles.length||!validBulkPlace)return;
    if(apply&&(!selectedPreview||Number(selectedPreview.eligible)<1))return;
    if(apply&&!window.confirm('確認將 '+selectedPreview.eligible+' 篇文章的空白 location 補寫為「'+bulkPlace.trim()+'」？原有打卡紀錄不會覆蓋。'))return;
    const snapshot=selectedSignature;
    const target=selectedPlaceArticles.slice();
    setBulkBusy(true);setBulkNotice('');
    try{
      const {data,error}=await dbAuthClient.schema('silver').managedAction('batch_fill_galaxy_location',{
        p_scope_id:target[0].scopeId,p_uids:target.map(row=>row.uid),p_place:bulkPlace.trim(),
        p_apply:apply,p_expected_count:apply?Number(selectedPreview.eligible):null
      });
      if(error)throw Error(error.message||'批次補寫失敗');
      if(apply){
        await revalidateServerMetadata();
        await resourceCache.invalidate({queryKey:['loc-place-summary',target[0].scopeId]});
        const filled=new Set(target.map(row=>row.scopeId+':'+row.uid));
        setResults(current=>current.map(row=>filled.has(row.scopeId+':'+row.resourceId)&&!row.checkInPlace
          ?{...row,checkInPlace:bulkPlace.trim()}:row));
        setSelectedPlaceArticles([]);setBulkPreview(null);
        setBulkNotice('已補寫 '+Number(data?.count||0)+' 篇文章的 location，原有非空白地點未覆蓋。');
      }else{
        setBulkPreview({signature:snapshot,data});
        setBulkNotice('目前選取 '+Number(data?.selected||0)+' 篇，其中空白可補寫 '+Number(data?.eligible||0)+' 篇。');
      }
    }catch(error){setBulkPreview(null);setBulkNotice('批次操作失敗：'+String(error.message||error));}
    finally{setBulkBusy(false);}
  }

  if(managementMode&&!managementAuthorized)return <FeaturePage featureId="search">
    <section className="loc-card scope-feature-card">
      {account.loading||account.permissionLoading
        ?<p role="status">正在確認管理權限…</p>
        :!account.user
          ?<p>請先至設定首頁登入，才能使用管理搜尋。</p>
          :<p>目前帳號沒有這個 Scope 的管理搜尋權限。</p>}
    </section>
  </FeaturePage>;
  if(aggregateScopes){
    const overview=<ScopeGroupOverview
      scopeId={scopeId}
      featureId="search"
      title={t('uiExtra.searchUI.memberSearch')}
      description=""
    />;
    return legacyManagementRoute?overview:<FeaturePage featureId="search">{overview}</FeaturePage>;
  }

  // Suggested terms are curated examples, not unverified live popularity rankings.
  // Reuse URL-driven search so history, filters and the existing provider stay authoritative.
  const suggestedTerms=useMemo(()=>{
    const key=contentType==='lyrics_work'?'suggestionsLyrics'
      :contentType==='text_work'?'suggestionsText':'suggestionsAll';
    return String(t('uiExtra.searchUI.'+key)||'').split('\n')
      .map(line=>line.split('|')[0].trim()).filter(Boolean).slice(0,10);
  },[contentType,t]);
  function followSearchSuggestion(term,patch={}){
    const text=String(term||'').trim();
    if(!text)return;
    const next={
      contentType,sourceFilter,startDate,endDate,
      scopeFilter:managementMode?scopeFilter:'',placeOnly,...patch
    };
    if(managementMode){
      setQuery(text);
      void executeSearch(text,null,{overrideOptions:{
        ...next,browse:false,sortDirection:articleSort
      }});
      return;
    }
    const href=workspaceSearchHref(text,next);
    router.push(href,{scroll:false});
  }

  function applyDefaultTimeWindow(){
    const range=timeUnitBucket(localTodayKey(),defaultTimeUnit==='auto'?'day':defaultTimeUnit);
    if(!range)return;
    
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    resetSearchState();
  }
  const defaultTimeName=t('uiExtra.searchUI.defaultUnit'+(defaultTimeUnit==='auto'
    ?'Day':defaultTimeUnit[0].toUpperCase()+defaultTimeUnit.slice(1)));
  const searchInput=(id,placeholder)=><>
    <input id={id} type="search" autoComplete="off" value={query}
      className="loc-search-input" placeholder={placeholder}
      list={!managementMode?id+'-published-patterns':undefined}
      onChange={event=>{setQuery(event.target.value);setSearchPopularOpen(false);}}/>
    {!managementMode?<datalist id={id+'-published-patterns'}>
      {patternSuggestions.map(word=><option key={word} value={word}/>)}
    </datalist>:null}
  </>;
  const pageContent=<>
    {managementMode?<section className="scope-search-workspace" aria-label="管理搜尋">
      <h2>管理搜尋</h2>
      <SearchSummary scopeIds={summaryScopeIds}/>
      <form className="scope-search-form" onSubmit={runSearch}>
        <label htmlFor="scope-management-search-query">文章內文</label>
        {searchInput('scope-management-search-query','輸入要搜尋的文字')}
        <button type="submit" disabled={scopeId==='loc'&&!scopesQuery.isSuccess}>查詢文章</button>
        <button type="button" className="loc-button"
          disabled={scopeId==='loc'&&!scopesQuery.isSuccess}
          onClick={()=>executeSearch('',null,{browse:true,overrideOptions:{
            contentType:'',sourceFilter:'',startDate,endDate,
            scopeFilter,placeOnly:false,browse:true,sortDirection:articleSort
          }})}>瀏覽文章</button>
        <button type="button" className="loc-button" onClick={clearSearchFilters}>清除</button>
      </form>
      {scopeId==='loc'?<div className="scope-search-scope-filter">
        <label htmlFor="scope-management-search-scope">管理範圍</label>
        <select id="scope-management-search-scope" value={scopeFilter}
          disabled={!scopesQuery.isSuccess}
          onChange={event=>updateSearchFilter(setScopeFilter,event.target.value)}>
          <option value="">全部已授權 Scope</option>
          {availableScopes.map(item=><option key={item.id} value={item.id}>{scopeLabel(item.id)}</option>)}
        </select>
        {scopesQuery.isError?<span role="alert" className="scope-status scope-error">{t('uiExtra.searchUI.scopeUnavailable')}</span>:null}
      </div>:null}
      <div className="scope-search-place-mode" role="group" aria-label="文章管理查詢方式">
        <button type="button" className="loc-button" aria-pressed={!placeOnly}
          onClick={()=>updateSearchFilter(setPlaceOnly,false)}>查文章</button>
        <button type="button" className="loc-button" aria-pressed={placeOnly}
          onClick={()=>updateSearchFilter(setPlaceOnly,true)}>查打卡地點</button>
      </div>
      <div className="scope-search-filter-body scope-search-date-fields">
        <button type="button" className="loc-button" onClick={applyDefaultTimeWindow}>
          {t('uiExtra.searchUI.applyDefaultTimeWindow',{unit:defaultTimeName})}
        </button>
        <label htmlFor="scope-management-search-start">起始日期
          <input id="scope-management-search-start" type="date" value={startDate}
            onChange={event=>updateSearchFilter(setStartDate,event.target.value)}/></label>
        <label htmlFor="scope-management-search-end">結束日期
          <input id="scope-management-search-end" type="date" min={startDate||undefined} value={endDate}
            onChange={event=>updateSearchFilter(setEndDate,event.target.value)}/></label>
      </div>
    </section>:null}
    {!managementMode?<section className="scope-search-workspace" aria-label={t('uiExtra.searchUI.searchWorkspace')}>
      <form className="scope-search-form" onSubmit={runSearch}>
        {!managementMode?<label htmlFor="scope-search-query">{UI_COPY.search.textPromptLabel}</label>:null}
        {searchInput('scope-search-query','搜尋全文或公開關鍵詞')}
        <button type="submit" disabled={scopeId==='loc'&&!scopesQuery.isSuccess}>{UI_COPY.nav.search}</button>
        {managementMode?<button type="button" className="loc-button" disabled={scopeId==='loc'&&!scopesQuery.isSuccess}
          onClick={()=>{
            setPlaceOnly(false);
            executeSearch('',null,{browse:true,overrideOptions:{
              contentType,sourceFilter,startDate,endDate,scopeFilter:managementMode?scopeFilter:'',
              placeOnly:false,browse:true,sortDirection:articleSort
            }});
          }}>瀏覽文章列表（不需輸入關鍵詞）</button>:null}
        <button type="button" className="loc-button" onClick={clearSearchFilters}>{t('uiExtra.searchUI.clearAll')}</button>
      </form>
      <button type="button" className="loc-button scope-search-popular-toggle"
        aria-expanded={searchPopularOpen} aria-controls="scope-search-suggestions"
        onClick={()=>setSearchPopularOpen(open=>!open)}>
        {searchPopularOpen?'收起建議搜尋':'顯示建議搜尋'}
      </button>
      <div id="scope-search-suggestions" className="scope-search-suggestions"
        role="group" aria-label="建議搜尋前10項" hidden={!searchPopularOpen}>
        <span className="scope-status">建議搜尋（最多 10 項）</span>
        <div className="scope-search-active-filters">
          {suggestedTerms.map(term=><button key={term} type="button" className="loc-button"
            onClick={()=>{setQuery(term);setSearchPopularOpen(false);followSearchSuggestion(term);}}>{term}</button>)}
          {!suggestedTerms.length?<span className="scope-status">目前沒有已發布的搜尋建議。</span>:null}
        </div>
      </div>
      {!managementMode&&results.length>0&&matchedQueryRef.current?<div className="scope-search-suggestions" aria-label="延伸搜尋">
        <span className="scope-status">延伸搜尋（保留原本的時間與來源條件）</span>
        <div className="scope-search-active-filters">
          {contentType!=='text_work'?<button type="button" className="loc-button"
            onClick={()=>followSearchSuggestion(matchedQueryRef.current,{contentType:'text_work',placeOnly:false})}>搜尋文字作品</button>:null}
          <button type="button" className="loc-button"
            onClick={()=>{setAdvancedOpen(true);setAdvancedTab('time');}}>限定時間</button>
        </div>
      </div>:null}
      {managementMode?<div className="scope-search-place-mode" role="group" aria-label="搜尋範圍">
        <button type="button" className="loc-button" aria-pressed={!placeOnly}
          onClick={()=>{setPlaceOnly(false);resetSearchState();}}>全部內容</button>
        <button type="button" className="loc-button" aria-pressed={placeOnly}
          onClick={()=>{setPlaceOnly(true);resetSearchState();}}>只查打卡地點</button>
      </div>:null}
      {placeOnly?<p className="scope-status">僅搜尋文章的打卡地點；結果仍使用原有文章列表與分頁，不搜尋文章內文。</p>:null}
      {placeOnly&&managementMode?<div className="loc-search-next-step">
        <p className="scope-status">這裡顯示的是已有打卡地點的文章。如果要為尚未標註地點的文章批次補寫，請前往搜尋管理，搜尋文章後勾選。</p>
        <button type="button" className="loc-button" onClick={()=>{
          setPlaceOnly(true);
          setBulkPlace(query.trim());
          void executeSearch(query,null,{overrideOptions:{
            contentType:'',sourceFilter:'',startDate,endDate,scopeFilter,
            placeOnly:true,browse:false,sortDirection:articleSort
          }});
        }}>下一步：從文章列表批次補寫地點（需管理權限）</button>
      </div>:null}
      {scopeId==='loc'&&managementMode?<div className="scope-search-scope-filter">
        <label htmlFor="scope-search-scope">{t('uiExtra.searchUI.scopeFilter')}</label>
        <select id="scope-search-scope" value={scopeFilter}
          disabled={!scopesQuery.isSuccess}
          onChange={event=>{updateSearchFilter(setScopeFilter,event.target.value);}}>
          <option value="">{t('uiExtra.searchUI.allScopes')}</option>
          {availableScopes.map(item=><option key={item.id} value={item.id}>{scopeLabel(item.id)}</option>)}
        </select>
        {scopesQuery.isError?<span role="alert" className="scope-status scope-error">{t('uiExtra.searchUI.scopeUnavailable')}</span>:null}
      </div>:null}
      <div className="scope-search-advanced" ref={advancedRef}>
        <button type="button" className="scope-search-advanced-toggle" aria-expanded={advancedOpen} aria-controls="scope-search-filter-panel" onClick={()=>setAdvancedOpen(value=>!value)}>
          <span><strong>{t('uiExtra.searchUI.advancedFilters')}</strong>{!managementMode?<small>{t('uiExtra.searchUI.advancedHelp')}</small>:null}</span>
          <span aria-hidden="true">{advancedOpen?'▴':'▾'}</span>
        </button>
        <div className="scope-search-active-filters" aria-live="polite">
          {chips.length?chips.map((chip,index)=><span className="scope-search-chip" key={index}>{chip}</span>):!managementMode?<span className="scope-search-chip is-muted">{t('uiExtra.searchUI.noFilters')}</span>:null}
        </div>
        {advancedOpen?<div id="scope-search-filter-panel" className="scope-search-filter-panel">
          <div role="group" className="scope-search-filter-tabs" aria-label={t('uiExtra.searchUI.advancedFilters')}>
            {['type','source','time'].map(tab=><button type="button" key={tab} aria-pressed={advancedTab===tab} className={advancedTab===tab?'is-active':''} onClick={()=>setAdvancedTab(tab)}>{t('uiExtra.searchUI.filter'+tab[0].toUpperCase()+tab.slice(1))}</button>)}
          </div>
          {advancedTab==='type'?<div className="scope-search-filter-body">
            <label htmlFor="scope-search-content-type">{t('uiExtra.searchUI.filterType')}</label>
            <select id="scope-search-content-type" value={contentType} onChange={event=>updateSearchFilter(setContentType,event.target.value)}>
              {filterTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="loc-button" onClick={browseSelectedType}>{t('uiExtra.searchUI.browseType')}</button>
          </div>:null}
          {advancedTab==='source'?<div className="scope-search-filter-body">
            <label htmlFor="scope-search-source">{t('uiExtra.searchUI.filterSource')}</label>
            <select id="scope-search-source" value={sourceFilter}
              disabled={sourceTaxonomyQuery.isPending||sourceTaxonomyQuery.isError}
              onChange={event=>updateSearchFilter(setSourceFilter,event.target.value)}>
              <option value="">{t('uiExtra.searchUI.allSources')}</option>
              {filterSources.filter(([value])=>value.startsWith('category:')).length?<optgroup label="來源分類">
                {filterSources.filter(([value])=>value.startsWith('category:')).map(([value,label])=>
                  <option key={value} value={value}>{label}</option>)}
              </optgroup>:null}
              {filterSources.filter(([value])=>value.startsWith('source:')).length?<optgroup label="個別來源">
                {filterSources.filter(([value])=>value.startsWith('source:')).map(([value,label])=>
                  <option key={value} value={value}>{label}</option>)}
              </optgroup>:null}
              {filterSources.filter(([value])=>value&&!value.startsWith('category:')&&!value.startsWith('source:'))
                .map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
            <p className="scope-status">搜尋可透過定錨建議直接定位文章；未選定錨時使用全文搜尋。</p>
            {sourceTaxonomyQuery.isPending?<p className="scope-status" role="status">載入來源分類…</p>:null}
            {sourceTaxonomyQuery.isError?<p className="scope-status scope-error" role="alert">來源分類載入失敗。
              <button type="button" className="loc-button" onClick={()=>sourceTaxonomyQuery.refetch()}>重試</button>
            </p>:null}
          </div>:null}
          {advancedTab==='time'?<div className="scope-search-filter-body scope-search-date-fields">
            <button type="button" className="loc-button" onClick={applyDefaultTimeWindow}>
              {t('uiExtra.searchUI.applyDefaultTimeWindow',{unit:defaultTimeName})}
            </button>
            <label htmlFor="scope-search-start-date">{t('uiExtra.searchUI.startDate')}
              <input id="scope-search-start-date" type="date" value={startDate} onChange={event=>{updateSearchFilter(setStartDate,event.target.value);}}/></label>
            <label htmlFor="scope-search-end-date">{t('uiExtra.searchUI.endDate')}
              <input id="scope-search-end-date" type="date" min={startDate||undefined} value={endDate} onChange={event=>{updateSearchFilter(setEndDate,event.target.value);}}/></label>
          </div>:null}
        </div>:null}
      </div>
    {!managementMode?<SearchSummary scopeIds={summaryScopeIds}/>:null}
    {!managementMode?<section className="scope-search-reference-editor" aria-label="搜尋建議">
      <h2>搜尋建議</h2>
      <ScopeEditableBlocks
        scopeId={scopeId}
        page="search"
        orders={[1]}
        className="scope-search-reference-grid"
        slotClassName="scope-search-reference-block"
        editSlotClassName="scope-search-reference-block"
        headingLevel={2}
        allowEditing={false}
        allowDelete={false}
        allowInlineChildAdd
        explicitEditButton
        onSuggestionClick={term=>searchFromSuggestion(term)}
      />
    </section>:null}
    </section>:null}
    <div ref={resultsRef} className="scope-search-results">
    {arrivalVersion>0?<motion.span key={arrivalVersion} className="scope-search-arrival-indicator"
      aria-hidden="true" initial={reduceMotion?false:{opacity:0,scaleX:.25}}
      animate={reduceMotion?{opacity:0}:{opacity:[0,1,0],scaleX:[.25,1,1]}}
      transition={{duration:reduceMotion?0:.9,times:[0,.26,1],ease:'easeOut'}}/>:null}
    {status&&(!managementMode||status!==UI_COPY.search.start)?<p className="scope-status" role="status" aria-live="polite">{status==='搜尋中請稍後'?<ActivityMotion kind="hourglass"/>:null} {status}</p>:null}
    {!managementMode&&results.length>0&&!browseResults&&matchedQueryRef.current?<section className="scope-search-next-step"
      aria-label={t('uiExtra.searchUI.followupSearch')}>
      <p className="scope-status">{t('uiExtra.searchUI.followupSearch')}</p>
      <div className="scope-search-place-mode">
        <button type="button" className="loc-button" onClick={()=>{
          setAdvancedOpen(true);setAdvancedTab('time');
          advancedRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
        }}>{t('uiExtra.searchUI.filterTime')}</button>
      </div>
    </section>:null}
    {managementMode&&(results.length>0||selectedPlaceArticles.length>0||bulkPlace.trim())?<section className="loc-search-bulk-panel" aria-label="批次補寫文章打卡地點">
      <h3>從搜尋文章列表批次補寫地點</h3>
      <p className="scope-status">在下方文章旁勾選「補寫打卡地點」，一次最多 200 篇且限同一個 Scope；原本有 location 的文章無法勾選。不會改動文章內容。</p>
      <div className="loc-search-bulk-controls">
        <label>地點標籤<input type="text" maxLength={200} value={bulkPlace}
          onChange={event=>{setBulkPlace(event.target.value);setBulkPreview(null);setBulkNotice('');}}
          placeholder="例如：板橋車站" disabled={bulkBusy}/></label>
        <span className="scope-status" aria-live="polite">已勾選 {selectedPlaceArticles.length} 篇{selectedScope?' · '+scopeLabel(selectedScope):''}</span>
        <button type="button" className="loc-button" disabled={bulkBusy||!selectedPlaceArticles.length||!validBulkPlace}
          onClick={()=>saveSelectedPlaces(false)}>預覽批次補寫</button>
        <button type="button" className="loc-button primary" disabled={bulkBusy||!selectedPreview||Number(selectedPreview.eligible)<1}
          onClick={()=>saveSelectedPlaces(true)}>{bulkBusy?'寫入中…':'確認補寫 '+Number(selectedPreview?.eligible||0)+' 篇'}</button>
        <button type="button" className="loc-button" disabled={bulkBusy||!selectedPlaceArticles.length}
          onClick={()=>{setSelectedPlaceArticles([]);setBulkPreview(null);setBulkNotice('');}}>清除勾選</button>
      </div>
      {bulkNotice?<p className="scope-status" role="status">{bulkNotice}</p>:null}
    </section>:null}
    {results.length||hasMore?<div style={{display:'flex',justifyContent:'flex-end',marginBottom:'.5rem'}}>
      <ArticleSortSelect value={articleSort} onChange={changeArticleSort} disabled={Boolean(editingKey)}/>
    </div>:null}
    {error?<p className="scope-status scope-error">{error}</p>:null}
    {loadMoreError?<p role="alert" className="scope-status scope-error">{loadMoreError} <button type="button" className="loc-button" disabled={loadingMore} onClick={loadNextSearch}><UiText id="uiExtra.cultureView.reloadWorks"/></button></p>:null}
    <IncrementalList
      items={orderedResults}
      className={managementMode?'scope-list':'scope-list loc-public-article-list'}
      batchSize={pageSize}
      resetKey={matchedQueryRef.current+'|'+String(browseResults)+'|'+scopeFilter+'|'+articleSort}
      externalHasMore={hasMore}
      loading={loadingMore}
      error={error||loadMoreError}
      onLoadMore={loadNextSearch}
      renderItem={(row,index)=>{
        const rowScopeData=account.scopeDataFor(row.scopeId)||defaultScopeData(row.scopeId);
        const editableTable=row.editableTable||(
          row.resourceType==='galaxy'?rowScopeData?.galaxy:
          row.resourceType==='galaxy_media'?rowScopeData?.galaxyMedia:''
        );
        const editTarget={
          ...row,
          editableTable,
          editableIdColumn:row.editableIdColumn||(row.resourceType==='galaxy'?'uid':row.resourceType==='galaxy_media'?'uid':''),
          editResourceId:row.editResourceId||row.resourceId,
          editableField:row.editableField||(row.resourceType==='galaxy'?'content':row.resourceType==='galaxy_media'?'description':'')
        };
        // Page blocks have no Galaxy attributes. Article editing and typed
        // metadata are available only to authorized Scope managers; guest
        // search and article reading cannot reveal metadata controls.
        const canOfferEdit=Boolean(adminListRequested&&editTarget.resourceType==='galaxy'&&editTarget.editableTable&&
          editTarget.editableIdColumn&&editTarget.editResourceId);
        const editable=Boolean(
          (adminListRequested&&managementMode&&canManageSearchScope(account,row.scopeId)&&editTarget.resourceType&&editTarget.editableTable&&editTarget.editableIdColumn&&editTarget.editResourceId)
          ||canOfferEdit
        );
        const draft=editingKey===row.key?editDraft:null;
        const selectedDetail=fullTextKey===row.key&&!fullTextLoading?fullTextRow:null;
        const identityReader=Boolean(searchParams?.get('identity'))&&row.resourceType==='galaxy';
        const expandedReader=Boolean(selectedDetail)&&row.resourceType==='galaxy';
        const readerRow=selectedDetail||null;
        const tracePlace=readerRow?.trace_place||row.tracePlace;
        const locationName=String(readerRow?.location||row.locationName||'').trim();
        const readingLinks=readerRow?galaxyRelationLinks(row.scopeId,readerRow):row.relationLinks||[];
        const relatedMedia=readerRow?.related_media||row.relatedMedia||[];
        return <Fragment key={row.key}>
          {managementMode&&row.resourceType==='galaxy'&&canManageSearchScope(account,row.scopeId)?
            <label className="loc-search-bulk-article-choice">
              <input type="checkbox" checked={selectedPlaceArticles.some(item=>item.uid===row.resourceId&&item.scopeId===row.scopeId)}
                disabled={bulkBusy||Boolean(row.checkInPlace)||(Boolean(selectedScope)&&selectedScope!==row.scopeId)||selectedPlaceArticles.length>=200&&!selectedPlaceArticles.some(item=>item.uid===row.resourceId&&item.scopeId===row.scopeId)}
                onChange={event=>togglePlaceArticle(row,event.target.checked)}/>
              {row.checkInPlace?'已設定地點，無法補寫':'可補寫地點'}
            </label>:null}
          {scopeId==='loc'&&scopeLabel(row.scopeId)&&(index===0||orderedResults[index-1]?.scopeId!==row.scopeId)
            ?<h2 className="scope-search-scope-heading">{scopeLabel(row.scopeId)}</h2>:null}
        <Article
          key={row.key}
          editOnCardClick={false}
          managerMode={managementMode}
          uid={editTarget.editResourceId}
          title={!managementMode&&row.resourceType==='galaxy'&&row.list===false?'（使用者隱藏）':row.title}
          articleHref={row.resourceType==='galaxy'&&(managementMode||row.list!==false)
            ?(managementMode?scopeHref(scopeId,'search/manage')+'?identity='+encodeURIComponent(row.resourceId)+'&scope='+encodeURIComponent(row.scopeId):galaxyIdentityHref(row.scopeId,row.resourceId))
            :''}
          detailReading={identityReader||expandedReader}
          source={searchParams?.get('identity')?row.styleTagMatch?'':row.source:''}
          date={row.date}
          body={''}
          hidden={false}
          relationLinks={identityReader||expandedReader?readingLinks:[]}
          relatedMedia={identityReader||expandedReader?relatedMedia:[]}
          relatedTime={identityReader||expandedReader?readerRow?.related_time||row.relatedTime:null}
          relatedSpace={identityReader||expandedReader?readerRow?.related_space||row.relatedSpace:null}
          relatedStatistics={identityReader||expandedReader?readerRow?.related_statistics||row.relatedStatistics:null}
          articleScopeId={row.scopeId}
          articleDate={identityReader||expandedReader?readerRow?.article_day||readerRow?.date||row.articleDay||row.date:''}
          articleCreateTime={identityReader||expandedReader?readerRow?.createtime||row.createtime:row.createtime}
          tracePlace={identityReader||expandedReader?tracePlace:null}
          traceHref={tracePlace?featureNavigationHref(row.scopeId,'trace',{place:tracePlace.uid}):''}
          locationName={identityReader||expandedReader?locationName:''}
          links={identityReader||expandedReader?readerRow?.links||row.links||[]:[]}
          destinations={row.destinations}
          editable={editable}
          editing={editingKey===row.key}
          onEdit={uid=>startEditing({...editTarget,editResourceId:uid})}
          editorDraft={draft}
          onDraftChange={setEditDraft}
          onSave={()=>saveEditing(editTarget)}
          onDelete={()=>deleteEditing(editTarget)}
          onCancel={()=>{setEditingKey('');setEditDraft(null);setAuthorizedEditingKey('');setEditError('')}}
          editBusy={editBusy}
          editError={editError}
          showInlineEditorActions={!editDock?.active}
          showHidden={managementMode}
          attributeFields={managementMode&&editable?(row.resourceType==='galaxy'?GALAXY_ATTR_FIELDS:row.resourceType==='galaxy_media'?MEDIA_ATTR_FIELDS:null):null}
          mediaScopeId={editable&&row.resourceType==='galaxy'?row.scopeId:''}
          attributeTitle={row.resourceType==='galaxy_media'?t('uiExtra.searchUI.mediaAttributes'):t('uiExtra.searchUI.attributeTitle')}
          showBodyEditor={row.resourceType==='galaxy'}
          styleTag={row.styleTagMatch}
          styleTagKicker={row.styleTagMatch?<UiText id="uiExtra.searchUI.styleRecommendations"/>:null}
          styleIntroText={row.styleIntroText}
        >
          {managementMode&&editable&&editingKey!==row.key?<div className="scope-work-fulltext-row">
            {searchParams?.get('identity')&&row.resourceType==='galaxy'?<WorkFullText
              open={fullTextKey===row.key}
              loading={fullTextLoading&&fullTextKey===row.key}
              error={fullTextKey===row.key?fullTextError:''}
              content={fullTextKey===row.key?fullText:''}
              showToggle={false}
            />:null}
            <button type="button" className="loc-button scope-work-edit-button" onClick={()=>startEditing(editTarget)}>
              {row.resourceType==='galaxy'?'展開內文並編輯':'編輯媒體連結'}
            </button>
          </div>:!managementMode&&row.resourceType==='galaxy'&&row.list!==false&&editingKey!==row.key?<div className="scope-work-fulltext-row">
            <WorkFullText
              open={fullTextKey===row.key}
              loading={fullTextLoading&&fullTextKey===row.key}
              error={fullTextKey===row.key?fullTextError:''}
              content={fullTextKey===row.key?fullText:''}
              onToggle={()=>toggleFullText(row)}
              showToggle={!searchParams?.get('identity')}
            />
            {fullTextKey===row.key&&canOfferEdit?<button type="button" className="loc-button scope-work-edit-button"
              onClick={()=>startEditing(editTarget)}>
              <UiText id="uiExtra.editBlocks.edit"/>
            </button>:null}
          </div>:null}

        </Article>
        </Fragment>;
      }}
    />
    </div>
  </>;
  // The management workspace owns its Hero even when the user's management
  // list opt-in is off or permission verification is pending. Never mount
  // a second FeaturePage inside its existing page shell.
  if(legacyManagementRoute)return pageContent;
  // A user opting in from ordinary Search still needs a standalone page shell.
  if(managementMode)return <FeaturePage featureId="search">{pageContent}</FeaturePage>;
  return <FeaturePage featureId="search">
    <div className="scope-search-view-labels" role="group" aria-label={UI_COPY.features.search.title+' / '+UI_COPY.features.trace.detailsLabel}>
      <button type="button" aria-pressed={publicView==='search'}
        onClick={()=>setPublicView('search')}>{UI_COPY.features.search.title}</button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={publicView==='trace'}
        onClick={()=>setPublicView('trace')}>{UI_COPY.features.trace.detailsLabel}</button>
    </div>
    <div className="scope-search-view-panel" role="region"
      aria-label={publicView==='search'?UI_COPY.features.search.title:UI_COPY.features.trace.detailsLabel}>
      {publicView==='search'?pageContent:<TraceBlocks scopeId={scopeId}/>}
    </div>
  </FeaturePage>;
}

