'use client';
import {lazy,Suspense} from 'react';
import FieldText from '../../i18n/FieldText';

import {UI_COPY} from '../../i18n/ui-copy';
import {useUiCopy,useUiSection} from '../../i18n/ui-locale';
import UiText,{useUiText} from '../../i18n/UiText';

import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import ActivityMotion from '../ActivityMotion';
import {LOC_MOTION} from '../motion-tokens.mjs';
import {searchPatternSuggestions,applyFeaturedSearchResults}
  from '../../loc/search/search-pattern-index.mjs';
import {useAsyncResource,useResourceCache} from '../../../packages/zenstack/client-queries';

import {dbAuthClient,dbPublicClient,deleteRows,transactionWrites} from '../../loc/db/db-client.mjs';
import {useAccount,readVerifiedManagementEntry} from '../../loc/auth/use-account';
import {ArticleSortSelect,FeaturePage,IncrementalList,WorkFullText} from '../ui';
import ScopeLink from '../ScopeLink';
import SearchSummary from '../../loc/search/Summary';
// Article cards/editing are requested only when results actually render.
const LazyArticle=lazy(()=>import('../Article'));
function Article(props){return <Suspense fallback={null}><LazyArticle {...props}/></Suspense>;}
import {useScopeRuntime} from '../use-scope-runtime';
import {useSearchManagerSwitch} from '../../loc/preferences/use-search-manager-switch';
import useDefaultTimeUnit from '../../loc/preferences/use-default-time-unit';
import {timeUnitBucket,localTodayKey} from '../../loc/preferences/default-time-unit.mjs';
import {useEditDock} from '../edit-dock';
import {scopeHref} from '../routing/scope-registry';
import {featureNavigationHref,galaxyIdentityHref,galaxyRelationLinks} from '../routing/feature-navigation';
import {featureDataErrorMessage} from '../feature-data-state';
import {parseSearchQuery} from '../../loc/search/query.mjs';
import {readGalaxyRecords,readLucusFeature,readPublicSearchPatternIndex}
  from '../../loc/model/feature-query-client.mjs';
import {scopeTableDescriptor} from '../../../packages/zenstack/scope-table-names.mjs';
import {queryGalaxyLocationBatchPreview} from '../../loc/actions/trace/management-queries.mjs';
import {locGlobalUid} from '../../../packages/zenstack/global-identity.mjs';
import {galaxyReadColumnsFor} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {galaxyAble} from '../../loc/model/galaxy-able.mjs';
import {searchGalaxyRows,selectGalaxyContent,selectGalaxyIdentity} from '../../loc/galaxy/galaxy-query';
import {readPublicSourceTaxonomy as selectSourceTaxonomy} from '../../loc/source/catalog-public.mjs';
import {defaultScopeData,selectLocSearchScopes,selectScopeRegistry,revalidateServerMetadata} from '../../loc/scope/scope-data';

import {WORK_FALLBACK_TITLE,workDisplayHeading,workDisplayText} from '../work-display-model';
import {requireGalaxyContent,resolveGalaxyTitle,assertPlainGalaxyAttributes} from '../../loc/content/content-policy';
import {DEFAULT_LIST_BATCH_SIZE} from '../../loc/db/db-contract.mjs';
import {applyFilters,isAbortError,selectRows} from '../../loc/db/db-query.mjs';
const LazyScopeGroupOverview=lazy(()=>import('../../loc/scope/ScopeGroupOverview'));
function ScopeGroupOverview(props){return <Suspense fallback={null}><LazyScopeGroupOverview {...props}/></Suspense>;}
const LazyScopeEditableBlocks=lazy(()=>import('../../loc/blocks/ScopeEditableBlocks'));
function ScopeEditableBlocks(props){return <Suspense fallback={null}><LazyScopeEditableBlocks {...props}/></Suspense>;}
// Explanatory Scope blocks are fetched only when their Search tab opens.
const LazyTraceBlocks=lazy(()=>import('./TraceBlocks'));
function TraceBlocks(props){return <Suspense fallback={null}><LazyTraceBlocks {...props}/></Suspense>;}


const EMPTY_SEARCH_PATTERN_INDEX=Object.freeze({patterns:[],featuredArticles:[]});

const GALAXY_EDITOR_COLUMNS=galaxyReadColumnsFor('GalaxyUidRead','GalaxyReadLucus')
  .concat(['UpdateTime','site_id']).filter((column,index,columns)=>columns.indexOf(column)===index).join(',');

const GALAXY_ATTR_ORDER=Object.freeze(galaxyReadColumnsFor('GalaxyUidRead','GalaxyReadLucus')
  .concat(['UpdateTime','site_id'])
  .filter((key,index,keys)=>keys.indexOf(key)===index));
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
  return Boolean(account.role==='admin'||account.canLocAccessSync?.('global')||ownScope||account.canLocAccessSync('scope',id)||account.canLocAccessSync('scope',normalized));
}

async function selectPublicEditableRow(table,idColumn,id,columns,{authenticated=false}={}){
  if(idColumn!=='uid'||!authenticated)throw Error('Authenticated UID required');
  const relation=String(table||'').split('.').at(-1);
  const galaxy=scopeTableDescriptor(relation);
  if(galaxy?.kind==='galaxy'&&galaxy.scope!=='local'){
    const {rows}=await readGalaxyRecords({scope:galaxy.scope,
      view:'detail',uids:[String(id)]},{editor:true});
    return rows[0]||null;
  }
  if(!['local_galaxy'].includes(relation))
    throw Error('Unsupported LOC editor relation');
  const {rows=[]}=await selectRows(table,{columns,
    filters:[{column:'uid',operator:'eq',value:String(id)}],
    limit:1,authenticated});
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
  // Results are Galaxy articles. Lucus data is only available via a
  // selected article's existing time/space/keyword/media relationships.
  const isGalaxy=Boolean(row.uid);
  const explicitTitle=workDisplayText(row.title||row.name||row.display_title||row.label||row.rune_name||row.song_id||row.id||'').trim();
  const fallbackTitle=WORK_FALLBACK_TITLE;
  const title=isGalaxy
    ?workDisplayHeading(row,{fallback:fallbackTitle,limit:80})
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
  const resourceType=isGalaxy?'galaxy':'';
  const resourceId=row.uid||'';
  const editableTable=resourceType?String(row.__table||''):'';
  const editableIdColumn=resourceType
    ?(resourceType==='galaxy'?'uid':'uid')
    :'';
  const editResourceId=resourceId;
  const editableField=resourceType==='galaxy'?'content':'';
  const isScopeCard=Boolean(row.scope_card);
  const href=isScopeCard?scopeHref(scope):
    isGalaxy&&row.extract!==true?'':(row.url||row.href||row.suno_url||'');
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
      :'result:'+scope+':'+dbId+':'+(identity||title)),
    links:isGalaxy&&row.extract!==true?[]:uniqueExternalLinks([...(href?[{id:resourceType||'primary',href,label:copy.search.externalLink}]:[]),...(Array.isArray(row.resolved_links)?row.resolved_links:[])]),
    destinations:[]
  };
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
  const href=featureNavigationHref(scopeId,'search',
    filters.management===true&&filters.placeOnly?{place:query}:{q:query});
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries({
    // User-facing text Search never accepts source/type/place selectors.
    type:filters.management===true?filters.contentType:null,
    source:filters.management===true?filters.sourceFilter:null,
    from:filters.startDate,to:filters.endDate,
    scope:filters.management===true?filters.scopeFilter:null
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
  // Explicit management route plus verified Scope grant controls editing.
  // The independent session-only switch never grants database access.
  const adminListRequested=Boolean(legacyManagementRoute);
  const {enabled:adminSearchRequested}=useSearchManagerSwitch();
  const [privateResultMode,setPrivateResultMode]=useState(false);
  const editDock=useEditDock();
  const publicScopeEditing=Boolean(editDock?.active&&editDock.scopeId===scopeId&&scopeId!=='loc');
  // Only existing editor/legacy routes load management grants. The Search
  // preference is not an editor role and cannot enable one.
  const account=useAccount({enabled:publicScopeEditing||legacyManagementRoute||
    Boolean(editDock?.active&&editDock.scopeId===scopeId)});
  const managementAuthorized=Boolean(adminListRequested&&account.user&&
    !account.loading&&!account.permissionLoading&&
    (scopeId==='loc'?(account.canLocAccessSync('group','loc')||account.scopes.length>0)
      :canManageSearchScope(account,scopeId)));
  const managementMode=Boolean(legacyManagementRoute&&managementAuthorized);
  const adminSearchActive=Boolean(adminSearchRequested&&!legacyManagementRoute);
  const privilegedSearch=managementMode;
  const locPublicSearch=scopeId==='loc'&&!privilegedSearch;
  const searchParams=useMemo(()=>new URLSearchParams(typeof window==='undefined'?'':window.location.search),[typeof window==='undefined'?'':window.location.search]);
    const resourceCache=useResourceCache();
  const [publicView,setPublicView]=useState('search');
  const [query,setQuery]=useState('');
  const [patternIndexState,setPatternIndexState]=useState({key:'',loading:false,patterns:[],featuredArticles:[],error:''});
  const patternIndexRef=useRef({key:'',loading:false,patterns:[],featuredArticles:[],error:''});
  const patternIndexRequestRef=useRef(null);
  const activePatternScopeKeyRef=useRef('');
  const [patternSuggestionsOpen,setPatternSuggestionsOpen]=useState(false);
  const [activePatternSuggestion,setActivePatternSuggestion]=useState(-1);
  const [searchPopularOpen,setSearchPopularOpen]=useState(false);
  const [placeOnly,setPlaceOnly]=useState(false);
  const [selectedPlaceArticles,setSelectedPlaceArticles]=useState([]);
  const [bulkPlace,setBulkPlace]=useState('');
  const [bulkPreview,setBulkPreview]=useState(null);
  const [bulkBusy,setBulkBusy]=useState(false);
  const [bulkNotice,setBulkNotice]=useState('');
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [advancedTab,setAdvancedTab]=useState('time');
  const [contentType,setContentType]=useState('');
  const [sourceFilter,setSourceFilter]=useState('');
  const sourceTaxonomyQuery=useAsyncResource({
    queryKey:['statistics-source-taxonomy'],
    queryFn:selectSourceTaxonomy,
    enabled:managementMode&&
      (advancedOpen&&advancedTab==='source'||sourceFilter.startsWith('category:')),
  });
  const [scopeFilter,setScopeFilter]=useState('');
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [browseResults,setBrowseResults]=useState(false);
  const activeSearchOptionsRef=useRef(null);
  const [results,setResults]=useState([]);
  const [articleSort,setArticleSort]=useState('desc');
  const [status,setStatus]=useState(UI_COPY.search.start);
  const [error,setError]=useState('');
  const [loadMoreError,setLoadMoreError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [nextCursor,setNextCursor]=useState(null);
  const [loadingMore,setLoadingMore]=useState(false);
  const [searchInFlight,setSearchInFlight]=useState(false);
  const [editingKey,setEditingKey]=useState('');
  const editTargetRef=useRef(null);
  const dockActions=useRef({save:null,discard:null});
  const [editDraft,setEditDraft]=useState(null);
  const [editBusy,setEditBusy]=useState(false);
  const [editError,setEditError]=useState('');
  const [readerResult,setReaderResult]=useState(null);
  const [fullTextKey,setFullTextKey]=useState('');
  const [fullText,setFullText]=useState('');
  const [fullTextRow,setFullTextRow]=useState(null);
  // A guest can see Edit; authorization is requested only after the click.
  const [authorizedEditingKey,setAuthorizedEditingKey]=useState('');
  const [fullTextError,setFullTextError]=useState('');
  const [fullTextLoading,setFullTextLoading]=useState(false);
  // An old detail request must never put a prior article back after selection.
  const detailEpoch=useRef(0);
  const searchId=useRef(0);
  const lastTextSearchAt=useRef(0);
  // Lucus the status/results block so a fresh search can scroll the
  // results into view instead of leaving the viewport on the search form.
  const resultsRef=useRef(null);
  const scrollPending=useRef(false);
  const [arrivalVersion,setArrivalVersion]=useState(0);
  const reduceMotion=useReducedMotion();
  useEffect(()=>{
    if(activePatternSuggestion<0||!patternSuggestionsOpen)return;
    document.getElementById('scope-search-query-pattern-option-'+activePatternSuggestion)?.scrollIntoView({block:'nearest'});
  },[activePatternSuggestion,patternSuggestionsOpen]);
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
  const publicResultsMode=!managementMode&&Boolean(
    searchParams?.get('q')||searchParams?.get('place')||browseResults||
    matchedQueryRef.current||results.length||fullTextKey||error||
    status&&status!==UI_COPY.search.start
  );
  const publicStatusIsActionable=Boolean(error)||status==='搜尋中請稍後'||status==='已取消搜尋。'||status==='已取消讀取文章。'||
    status===UI_COPY.search.empty||status===UI_COPY.search.failed||
    status===UI_COPY.search.relationFailed;
  const pageSize=DEFAULT_LIST_BATCH_SIZE;
  // LOC searches across every active, search-enabled public content tree.
  // The Scope registry is an internal query input, never a public search filter.
  const aggregateScopes=Boolean(scope?.aggregateChildren&&scopeId!=='loc');
  const scopesQuery=useAsyncResource({
    queryKey:privilegedSearch?['management-search-scopes',account.email]:['loc-searchable-scopes'],
    queryFn:privilegedSearch?()=>selectScopeRegistry({scopeKind:'scope'}):selectLocSearchScopes,
    enabled:scopeId==='loc'&&!aggregateScopes,
  });
  const availableScopes=useMemo(()=>{
    if(scopeId!=='loc')return [account.scopeDataFor(scopeId)||defaultScopeData(scopeId)].filter(Boolean);
    if(!privilegedSearch)return scopesQuery.data||[];
    return (scopesQuery.data||[])
      .filter(item=>item.scope_kind==='scope'&&canManageSearchScope(account,item.scope_id))
      .map(item=>{
        const data=account.scopeDataFor(item.scope_id)||defaultScopeData(item.scope_id);
        return data?{...data,display_name:String(item.display_name||item.scope_id)}:null;
      }).filter(Boolean);
  },[scopeId,scopesQuery.data,privilegedSearch,account.authorizer]);
  const scopeById=useMemo(()=>new Map(availableScopes.map(item=>[item.id,item])),[availableScopes]);
  const targetScopes=useMemo(()=>scopeId==='loc'&&managementMode&&scopeFilter
    ?availableScopes.filter(item=>item.id===scopeFilter)
    :availableScopes,[scopeId,managementMode,scopeFilter,availableScopes]);
  // Public Search: Pattern-only suggestions; management text input: none.
  const patternScopeIds=useMemo(()=>targetScopes.map(item=>item.id),[targetScopes]);
  const patternScopeKey=patternScopeIds.join('|');
  activePatternScopeKeyRef.current=patternScopeKey;
  const currentPatternIndex=!managementMode&&patternIndexState.key===patternScopeKey
    ?patternIndexState:EMPTY_SEARCH_PATTERN_INDEX;
  const patternSuggestions=useMemo(()=>managementMode?[]:
    searchPatternSuggestions(currentPatternIndex.patterns,query,36),
    [managementMode,currentPatternIndex.patterns,query]);

  function loadPublicPatternIndex(){
    if(managementMode||!patternScopeIds.length)return Promise.resolve(EMPTY_SEARCH_PATTERN_INDEX);
    const key=patternScopeKey,cached=patternIndexRef.current;
    if(cached.key===key&&!cached.loading&&!cached.error)return Promise.resolve(cached);
    if(patternIndexRequestRef.current?.key===key)return patternIndexRequestRef.current.promise;
    const loading={key,loading:true,patterns:[],featuredArticles:[],error:''};
    patternIndexRef.current=loading;setPatternIndexState(loading);
    const promise=readPublicSearchPatternIndex(patternScopeIds).then(data=>({
      key,loading:false,patterns:Array.isArray(data?.patterns)?data.patterns:[],
      featuredArticles:Array.isArray(data?.featuredArticles)?data.featuredArticles:[],error:''
    })).catch(()=>({key,loading:false,patterns:[],featuredArticles:[],error:'關鍵詞建議暫時無法載入。'})).then(result=>{
      if(activePatternScopeKeyRef.current===key){
        patternIndexRef.current=result;setPatternIndexState(result);
      }
      return result;
    }).finally(()=>{
      if(patternIndexRequestRef.current?.promise===promise)patternIndexRequestRef.current=null;
    });
    patternIndexRequestRef.current={key,promise};
    return promise;
  }

  const summaryScopeIds=targetScopes.map(item=>item.id);
  const scopeLabel=id=>{
    const item=scopeById.get(id);
    // A Scope search can only return its own Scope, so its name adds no context.
    if(scopeId!=='loc'&&String(id||'')===scopeId)return '';
    // LOC-wide Search can show a published display name without exposing IDs.
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
      const featured=Number(Boolean(b.row.featured))-Number(Boolean(a.row.featured));
      if(featured)return featured;
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
  // A Scope search already implies its single Scope. Only LOC-wide search
  // needs a collection label, and only it can optionally name a chosen Scope.
  const collectionLabel=scopeId==='loc'?UI_COPY.search.allContent:'';

  async function loadGalaxyDetail(result,signal=null){
    const scopeData=scopeById.get(result.scopeId);
    if(!scopeData)throw new Error(UI_COPY.search.fullTextNotFound);
    const id=result.editResourceId||result.resourceId;
    return selectGalaxyIdentity(scopeData,id,{includeHidden:canManageSearchScope(account,result.scopeId),dbId:result.dbId||'',federated:result.federated===true,signal});
  }

  async function executeSearch(rawQuery,cursor=null,{append=false,browse=false,overrideOptions=null}={}){
    const q=String(rawQuery||'').trim();
    const requested=append&&activeSearchOptionsRef.current
      ?activeSearchOptionsRef.current
      :(overrideOptions||{contentType,sourceFilter,startDate,endDate,
        scopeFilter:managementMode?scopeFilter:'',placeOnly,browse,sortDirection:articleSort});
    // Browser history / legacy deep links are not allowed to opt guest Search
    // into site, location, type or Scope-column searching.
    const options=managementMode?requested:
      (!requested.contentType&&!requested.sourceFilter&&!requested.placeOnly&&!requested.scopeFilter
        ?requested:{...requested,contentType:'',sourceFilter:'',placeOnly:false,scopeFilter:''});
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
    setSearchInFlight(true);
    // Request admission is already governed by the existing Karaul/PELT QoS.
    // A 25s client cutoff was interrupting legitimate long-range searches.
    const timeout=AbortSignal.timeout(60000);
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
      detailEpoch.current++;
      setFullTextLoading(false);
      setFullTextKey('');setFullText('');setFullTextRow(null);setFullTextError('');
      matchedQueryRef.current='';
      setHasMore(false);
      setNextCursor(null);
      setResults([]);
      setSelectedPlaceArticles([]);setBulkPreview(null);setBulkNotice('');
      setStatus('搜尋中請稍後');
    }
    try{
      // Public Search never performs a preference write or a private read.
      // Signed management actions remain available only on management routes.
      if(id!==searchId.current)return;
      const patternIndexPromise=!managementMode&&q&&!options.browse?loadPublicPatternIndex():Promise.resolve(EMPTY_SEARCH_PATTERN_INDEX);
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
      // A search-only manager grant must use signed, scoped Kysely instead of
      // bypassing visibility via the anonymous public SELECT transport.
      // Manager is presentation-only here; never call the private managed
      // action or bypass Scope grants to read search-disabled content.
      const searchRunner=searchGalaxyRows;
      const search=await searchRunner(searchScopes,q,{
        limit:pageSize,cursor,
        hiddenScopeIds:managementMode?searchScopes.map(item=>item.id):[],
        contentType:options.contentType,sourceFilter:options.sourceFilter,sourceTaxonomy,
        placeOnly:managementMode&&Boolean(options.placeOnly),
        startDate:options.startDate,endDate:options.endDate,browse:options.browse,
        managementOnly:managementMode,sortDirection:options.sortDirection,signal
      });
      if(id!==searchId.current)return;
      const patternIndex=await patternIndexPromise;
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
      const withFeaturedResults=applyFeaturedSearchResults(converted,patternIndex.patterns,patternIndex.featuredArticles,q,
        (row,source,rowScope)=>toResult(row,source,rowScope,UI_COPY));
      const pageResults=prioritizeStyleTagResults(mergeSummaryResults(withFeaturedResults,UI_COPY))
        .sort((left,right)=>Number(Boolean(right.featured))-Number(Boolean(left.featured)));
      // A new page replaces the previous 100 results; the cursor, not an
      // ever-growing browser array, carries the position through the search.
      setResults(pageResults.slice(0,pageSize));
      setPrivateResultMode(managementMode);
      setHasMore(Boolean(search.hasMore));
      setNextCursor(search.nextCursor??null);
      const partial=(search.failures?.length)?t('uiExtra.searchUI.partialExtendedData'):'';
      if(!append){
        setStatus(!pageResults.length&&!search.hasMore
          ?search.failures?.length?UI_COPY.search.failed:UI_COPY.search.empty
          :options.browse?t('uiExtra.searchUI.browsingResults'):UI_COPY.format.searchResult({
            label:searchCollectionLabel?'「'+searchCollectionLabel+'」':'',
            query:q,hasMore:search.hasMore,partial
          }));
        scrollToResults();
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
      if(id===searchId.current){
        setSearchInFlight(false);
        if(append)setLoadingMore(false);
        if(abortRef.current===controller)abortRef.current=null;
      }
    }
  }

  function cancelSearch(){
    const controller=abortRef.current;
    if(!controller||controller.signal.aborted)return;
    const wasLoadingMore=loadingMore;
    const wasReadingArticle=fullTextLoading;
    controller.abort();
    abortRef.current=null;
    searchId.current++;
    loadMoreInFlight.current=false;
    setSearchInFlight(false);
    setLoadingMore(false);
    setFullTextLoading(false);
    if(wasLoadingMore)setLoadMoreError('已取消載入更多文章。');
    else{
      setError('');
      setStatus(wasReadingArticle?'已取消讀取文章。':'已取消搜尋。');
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
    detailEpoch.current++;
    const identity=String(rawIdentity||'').trim();
    if(!identity)return;
    const id=++searchId.current;
    const controller=beginRequest();
    setSearchInFlight(true);
    matchedQueryRef.current='';
    setError('');setLoadMoreError('');setHasMore(false);setNextCursor(null);setLoadingMore(false);
    setResults([]);setReaderResult(null);setFullTextKey('');
    setFullText('');setFullTextRow(null);setFullTextError('');setFullTextLoading(true);
    setStatus(UI_COPY.search.loadingRelation);
    try{
      let detail=null;
      let detailScope=scopeId;
      const identityScope=managementMode?String(searchParams?.get('scope')||'').trim():'';
      const detailScopes=identityScope?availableScopes.filter(scope=>scope.id===identityScope):targetScopes;
      for(const scopeData of detailScopes){
        detail=await selectGalaxyIdentity(scopeData,identity,{
          includeHidden:canManageSearchScope(account,scopeData.id),signal:controller.signal
        });
        if(detail){detailScope=scopeData.id;break;}
      }
      if(id!==searchId.current)return;
      if(!detail)throw new Error(UI_COPY.search.notFound);
      const result=toResult({...detail,resolved_links:detail.links||[]},detail.site||UI_COPY.search.displaySource,detailScope);
      setResults([result]);
      setReaderResult(result);
      setFullTextKey(result.key);
      setFullText(workDisplayText(detail.content||''));
      setFullTextRow(detail);
      setStatus('');
    }catch(exception){
      if(id!==searchId.current)return;
      setResults([]);setError(featureDataErrorMessage(exception,UI_COPY));setStatus(UI_COPY.search.relationFailed);
    }finally{
      if(id===searchId.current){
        setFullTextLoading(false);
        setSearchInFlight(false);
        if(abortRef.current===controller)abortRef.current=null;
      }
    }
  }

  // Older ?media= links address Galaxy media works by their UID.
  async function executeMediaIdentity(rawMediaId){
    const id=String(rawMediaId||'').trim();
    if(!/^[A-Za-z0-9]{8}$/.test(id)){
      setError(t('uiExtra.searchUI.invalidMediaId'));return;
    }
    await executeIdentity(id);
  }

  useEffect(()=>{
    if(managementMode&&!managementAuthorized)return;
    if(scopeId==='loc'&&!scopesQuery.isSuccess)return;
    const identity=String(searchParams?.get('identity')||'').trim();
    const media=String(searchParams?.get('media')||'').trim();
    if(media){setQuery('');executeMediaIdentity(media);return;}
    const place=managementMode?String(searchParams?.get('place')||'').trim():'';
    const fillPlace=managementMode
      ?String(searchParams?.get('fill_place')||place||'').trim():'';
    if(fillPlace)setBulkPlace(fillPlace);
    const value=String(searchParams?.get('q')||'').trim();
    if(identity){setQuery('');executeIdentity(identity);return;}
    const filters={
      contentType:managementMode?String(searchParams?.get('type')||''):'',
      sourceFilter:managementMode?String(searchParams?.get('source')||''):'',
      startDate:String(searchParams?.get('from')||''),
      endDate:String(searchParams?.get('to')||''),
      scopeFilter:managementMode?String(searchParams?.get('scope')||''):''
    };
    setContentType(filters.contentType);setSourceFilter(filters.sourceFilter);
    setStartDate(filters.startDate);setEndDate(filters.endDate);
    if(managementMode)setScopeFilter(filters.scopeFilter);
    const term=place||value;
    setPlaceOnly(Boolean(place));
    if(term){setQuery(term);void executeSearch(term,null,{overrideOptions:{...filters,placeOnly:managementMode&&Boolean(place),browse:false,sortDirection:articleSort}});}
  },[searchParams,scopeId,scopesQuery.isSuccess,scopesQuery.data,managementMode,managementAuthorized]);



  async function toggleFullText(result){
    if(!managementMode&&fullTextKey===result.key&&!fullTextError)return;
    const request=++detailEpoch.current;
    if(managementMode&&fullTextKey===result.key){
      abortRef.current?.abort();abortRef.current=null;
      setSearchInFlight(false);
      setFullTextLoading(false);
      setFullTextKey('');
      setFullText('');
      setFullTextRow(null);
      setFullTextError('');
      return;
    }
    if(result.resourceType!=='galaxy'||!result.editableTable)return;
    const controller=beginRequest();
    setSearchInFlight(true);
    setReaderResult(result);
    setFullTextKey(result.key);
    setFullText('');
    setFullTextRow(null);
    setFullTextError('');
    setFullTextLoading(true);
    try{
      const fullRow=await loadGalaxyDetail(result,controller.signal);
      if(controller.signal.aborted||request!==detailEpoch.current)return;
      if(!fullRow)throw new Error(UI_COPY.search.fullTextNotFound);
      setFullText(workDisplayText(fullRow.content||''));
      setFullTextRow(fullRow);
      setReaderResult({...toResult(fullRow,fullRow.site||result.source,result.scopeId),key:result.key});
    }catch(exception){
      if(request===detailEpoch.current&&!controller.signal.aborted)
        setFullTextError(String(exception?.message||exception||UI_COPY.search.fullTextFailed));
    }finally{
      if(request===detailEpoch.current){
        setFullTextLoading(false);
        setSearchInFlight(false);
        if(abortRef.current===controller)abortRef.current=null;
      }
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
        // A still-valid, already verified editing Session is sufficient for
        // the UI; actual writes are reauthorized on the server. Recheck LOC
        // only when the existing Session projection is absent or expired.
        const verified=readVerifiedManagementEntry()||
          await account.refresh({forceVerify:true});
        const grants=verified?.authorizer;
        if(!verified?.user||!(grants?.canLocAccessSync('scope',result.scopeId)||
          grants?.canLocAccessSync('global')||grants?.canLocAccessSync('group','loc')))
          throw new Error('請先登入具有此 Scope 編輯權限的帳號。');
        setAuthorizedEditingKey(result.key);
      }
      // A reading UID fetch intentionally omits editor-only attributes.
      // Query the complete, authorized editor projection only on Edit.
      const fullRow=await selectPublicEditableRow(
        result.editableTable,
        result.editableIdColumn,
        result.editResourceId||result.resourceId,
        result.scopeId==='local'
          ?'uid,title,content,createtime,location,UpdateTime,url,source_id,target_id,ref_id,site,media_link,able'
          :GALAXY_EDITOR_COLUMNS,
        {authenticated:true}
      );
      if(!fullRow)throw new Error(UI_COPY.search.editNotFound);
      const typedRow=fullRow;
      if(!typedRow)throw new Error(UI_COPY.search.editNotFound);
      const {SearchEditDraft}=await import('./search-edit-draft');
      editTargetRef.current=result;
      setEditDraft(SearchEditDraft.fromRow(result.resourceType,typedRow,result.title));
      if(managementMode)editDock?.begin(scopeId);
    }catch(exception){
      setEditingKey('');
      setAuthorizedEditingKey('');
      const message=String(exception?.message||exception||UI_COPY.search.editLoadFailed);
      setEditError(message);
      if(!managementMode)setFullTextError(message);
    }
  }
  async function prepareSearchEditTransaction(result){
    if(!adminListRequested||authorizedEditingKey!==result?.key)
      throw Error('搜尋編輯未取得授權');
    if(!editDraft||!result?.editableTable||!result.editableField||editBusy)
      throw Error('搜尋編輯資料尚未就緒');
      const {SearchEditDraft}=await import('./search-edit-draft');
      const {blocksToPlainText}=await import('../../loc/editor/blocknote-content.mjs');
      const body=await requireGalaxyContent(editDraft.bodyHtml??blocksToPlainText(editDraft.bodyBlocks));
      const nextTitle=resolveGalaxyTitle(editDraft.title,blocksToPlainText(editDraft.bodyHtml??editDraft.bodyBlocks));
      const titleChanged=editDraft.title!==editDraft.originalTitle;
      const rawEdits=Object.fromEntries(Object.entries(editDraft.attrs||{})
        .filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(editDraft.originalAttrs?.[key])));
      assertPlainGalaxyAttributes({...rawEdits,...(titleChanged?{title:editDraft.title}:{})});
      const attrs=SearchEditDraft.changedAttributes('galaxy',editDraft,t);
      assertPlainGalaxyAttributes({...attrs,...(titleChanged?{title:nextTitle}:{})});
      const contentPatch={...(titleChanged?{title:nextTitle}:{}),content:body,
        UpdateTime:new Date().toISOString(),...attrs};
      return {
        operations:[{p_table:result.editableTable,p_operation:'update',
          p_values:contentPatch,
          p_filters:[{column:result.editableIdColumn,operator:'eq',
            value:result.editResourceId||result.resourceId}]}],
        afterCommit:()=>{
      setResults(current=>current.map(item=>{
        if(item.key!==result.key)return item;
        return {...item,title:nextTitle||item.title,snippet:'',
          editRow:{...(item.editRow||{}),title:nextTitle,...contentPatch}};
      }));
      if(fullTextKey===result.key){
        setFullText(body);
        setFullTextRow(current=>({...current,...contentPatch,uid:current?.uid||result.editResourceId||result.resourceId}));
      }
      if(managementMode){
        setEditDraft(current=>current?{
          ...current,originalTitle:nextTitle,
          body,bodyHtml:body,
          originalAttrs:{...current.attrs}
        }:current);
      }else{
        setEditingKey('');setEditDraft(null);setAuthorizedEditingKey('');
      }
      setStatus('');
        },
        onFailure:error=>setEditError(String(error?.message||error||UI_COPY.search.saveFailed))
      };
  }
  async function saveEditing(result){
    if(!adminListRequested||authorizedEditingKey!==result?.key)return false;
    if(!editDraft||!result?.editableTable||!result.editableField||editBusy)return false;
    setEditBusy(true);setEditError('');
    try{
      const plan=await prepareSearchEditTransaction(result);
      if(plan.operations.length)await transactionWrites(plan.operations);
      try{await plan.afterCommit?.();}
      catch{setEditError('資料已提交，但搜尋畫面更新失敗；請重新讀取。');}

      return true;
    }catch(exception){
      const message=String(exception?.message||exception||UI_COPY.search.saveFailed);
      setEditError(message);
      if(editDock?.active)editDock.setNotice(message);
      return false;
    }finally{setEditBusy(false);}
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
    ++detailEpoch.current;
    setReaderResult(null);setFullTextKey('');setFullText('');setFullTextRow(null);
    setFullTextError('');setFullTextLoading(false);
    ++searchId.current;
    abortRef.current?.abort();
    abortRef.current=null;
    setSearchInFlight(false);
    loadMoreInFlight.current=false;
    setLoadingMore(false);
    matchedQueryRef.current='';
    activeSearchOptionsRef.current=null;
    setResults([]);setPrivateResultMode(false);
    setSelectedPlaceArticles([]);setBulkPreview(null);setBulkNotice('');setHasMore(false);setNextCursor(null);setBrowseResults(false);
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
    if(!managementMode)window.location.replace(featureNavigationHref(scopeId,'search'));
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
    managementMode&&contentType&&filterTypes.find(([value])=>value===contentType)?.[1],
    managementMode&&sourceFilter&&filterSources.find(([value])=>value===sourceFilter)?.[1],
    startDate&&t('uiExtra.searchUI.startDate')+': '+startDate,
    endDate&&t('uiExtra.searchUI.endDate')+': '+endDate,
  ].filter(Boolean);
  function workspaceSearchHref(term,filters={}){
    const href=searchHref(scopeId,term,{...filters,management:managementMode});
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
    if(privilegedSearch){
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
      // Native history updates stay local; the current query is read directly.
      // the existing URL-driven effect then runs the search exactly once.
      const target=new URL(url,window.location.href);
      if(target.pathname===window.location.pathname)window.history.pushState(null,'',target.pathname+target.search+target.hash);
      else window.location.assign(target.href);
      return;
    }
    // Next.js does not remount for an identical URL; repeated suggestions must still search.
    setQuery(term);
    void executeSearch(term,null,{overrideOptions:{...filters,browse:false,sortDirection:articleSort}});
  }
  function runSearch(event){
    event.preventDefault();
    if(adminSearchActive){
      // Preserve the ordinary Search form and its own filters. This does not
      // open /search/manage or expose its editing/batch UI.
      void executeSearch(query,null,{overrideOptions:{
        contentType,sourceFilter,startDate,endDate,scopeFilter:'',
        placeOnly:false,browse:false,sortDirection:articleSort
      }});
      return;
    }
    if(managementMode){
      // Full navigation re-enters the permission gate, remounts
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
    prepareTransaction:()=>prepareSearchEditTransaction(editTargetRef.current),
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
      prepareTransaction:()=>dockActions.current.prepareTransaction(),
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
      if(!apply){
        const data=await queryGalaxyLocationBatchPreview({
          p_scope_id:target[0].scopeId,p_uids:target.map(row=>row.uid)
        });
        setBulkPreview({signature:snapshot,data});
        setBulkNotice('目前選取 '+Number(data?.selected||0)+' 篇，其中空白可補寫 '+Number(data?.eligible||0)+' 篇。');
      }else{
        const {data,error}=await dbAuthClient.schema('silver').managedAction('apply_galaxy_location_batch',{
          p_scope_id:target[0].scopeId,p_uids:target.map(row=>row.uid),
          p_place:bulkPlace.trim(),p_expected_count:Number(selectedPreview.eligible)
        });
        if(error)throw Error(error.message||'批次補寫失敗');
        await revalidateServerMetadata();
        await resourceCache.invalidate({queryKey:['loc-place-summary',target[0].scopeId]});
        const filled=new Set(target.map(row=>row.scopeId+':'+row.uid));
        setResults(current=>current.map(row=>filled.has(row.scopeId+':'+row.resourceId)&&!row.checkInPlace
          ?{...row,checkInPlace:bulkPlace.trim()}:row));
        setSelectedPlaceArticles([]);setBulkPreview(null);
        setBulkNotice('已補寫 '+Number(data?.count||0)+' 篇文章的 location，原有非空白地點未覆蓋。');
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
    if(privilegedSearch){
      setQuery(text);
      void executeSearch(text,null,{overrideOptions:{
        ...next,browse:false,sortDirection:articleSort
      }});
      return;
    }
    const href=workspaceSearchHref(text,next);
    window.location.assign(href);
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
  const searchInput=(id,placeholder)=>{
    const listId=id+'-pattern-suggestions';
    const open=!managementMode&&patternSuggestionsOpen&&Boolean(query.trim())&&Boolean(patternSuggestions.length||currentPatternIndex.loading||currentPatternIndex.error);
    const active=open&&activePatternSuggestion>=0&&activePatternSuggestion<patternSuggestions.length?id+'-pattern-option-'+activePatternSuggestion:undefined;
    const choosePattern=word=>{setQuery(word);setPatternSuggestionsOpen(false);setActivePatternSuggestion(-1);};
    const onPatternKeyDown=event=>{
      if(event.key==='Escape'){setPatternSuggestionsOpen(false);setActivePatternSuggestion(-1);return;}
      if(event.key==='ArrowDown'&&patternSuggestions.length){event.preventDefault();setPatternSuggestionsOpen(true);setActivePatternSuggestion(i=>Math.min(i+1,patternSuggestions.length-1));return;}
      if(event.key==='ArrowUp'&&patternSuggestions.length){event.preventDefault();setPatternSuggestionsOpen(true);setActivePatternSuggestion(i=>i<0?patternSuggestions.length-1:Math.max(i-1,0));return;}
      if(event.key==='Enter'&&patternSuggestionsOpen&&activePatternSuggestion>=0&&activePatternSuggestion<patternSuggestions.length){event.preventDefault();choosePattern(patternSuggestions[activePatternSuggestion]);}
    };
    return <div className="loc-search-autocomplete" onBlur={event=>{
      if(!event.currentTarget.contains(event.relatedTarget)){setPatternSuggestionsOpen(false);setActivePatternSuggestion(-1);}
    }}>
      <input id={id} type="search" autoComplete="off" value={query} className="loc-search-input" placeholder={placeholder}
        role={!managementMode?'combobox':undefined} aria-autocomplete={!managementMode?'list':undefined}
        aria-expanded={!managementMode?open:undefined} aria-controls={!managementMode&&open?listId:undefined}
        aria-activedescendant={!managementMode?active:undefined}
        onFocus={()=>{if(!managementMode){setPatternSuggestionsOpen(Boolean(query.trim()));if(!currentPatternIndex.error)void loadPublicPatternIndex();}}}
        onKeyDown={!managementMode?onPatternKeyDown:undefined}
        onChange={event=>{const value=event.target.value;setQuery(value);setSearchPopularOpen(false);setActivePatternSuggestion(-1);
          if(!managementMode){setPatternSuggestionsOpen(Boolean(value.trim()));if(value.trim()&&!currentPatternIndex.error)void loadPublicPatternIndex();}}}/>
      {!managementMode?<AnimatePresence initial={false}>{open?<motion.div key={id+'-patterns'} className="loc-search-pattern-popover"
        initial={reduceMotion?false:{opacity:0,y:-4}} animate={{opacity:1,y:0}}
        exit={reduceMotion?{opacity:0}:{opacity:0,y:-3}}
        transition={reduceMotion?{duration:0}:{duration:LOC_MOTION.fast,ease:'easeOut'}}>
        {currentPatternIndex.loading?<p className="loc-search-pattern-suggestion-status" role="status">載入關鍵詞建議…</p>:null}
        {currentPatternIndex.error?<div className="loc-search-pattern-suggestion-status"><span role="status">{currentPatternIndex.error}</span>
          <button type="button" className="loc-button" onClick={()=>void loadPublicPatternIndex()}>重試</button></div>:null}
        <ul id={listId} className="loc-search-pattern-suggestions" role="listbox" aria-label="關鍵詞建議">
          {patternSuggestions.map((word,index)=><motion.li layout key={word} id={id+'-pattern-option-'+index}
            role="option" aria-selected={activePatternSuggestion===index}
            className={activePatternSuggestion===index?'is-active':''}
            transition={reduceMotion?{duration:0}:{duration:.14}}
            onPointerDown={event=>event.preventDefault()} onClick={()=>choosePattern(word)}>{word}</motion.li>)}
        </ul>
        {!currentPatternIndex.loading&&!currentPatternIndex.error&&!patternSuggestions.length
          ?<p className="loc-search-pattern-suggestion-status" role="status">沒有相符的關鍵詞。</p>:null}
      </motion.div>:null}</AnimatePresence>:null}
    </div>;
  };
  function renderSearchArticle(row,index,exploration=false){
        const rowScopeData=account.scopeDataFor(row.scopeId)||defaultScopeData(row.scopeId);
        const editableTable=row.editableTable||(
          row.resourceType==='galaxy'?rowScopeData?.galaxy:
          ''
        );
        const editTarget={
          ...row,
          editableTable,
          editableIdColumn:row.editableIdColumn||(row.resourceType==='galaxy'?'uid':''),
          editResourceId:row.editResourceId||row.resourceId,
          editableField:row.editableField||(row.resourceType==='galaxy'?'content':'')
        };
        // Page blocks have no Galaxy attributes. Article editing and typed
        // metadata are available only to authorized Scope managers; guest
        // search and article reading cannot reveal metadata controls.
        const canOfferEdit=Boolean(!adminSearchActive&&adminListRequested&&editTarget.resourceType==='galaxy'&&editTarget.editableTable&&
          editTarget.editableIdColumn&&editTarget.editResourceId);
        const editable=Boolean(!adminSearchActive&&
          ((adminListRequested&&managementMode&&canManageSearchScope(account,row.scopeId)&&editTarget.resourceType&&editTarget.editableTable&&editTarget.editableIdColumn&&editTarget.editResourceId)
          ||canOfferEdit)
        );
        const draft=editingKey===row.key?editDraft:null;
        const selectedDetail=fullTextKey===row.key&&!fullTextLoading?fullTextRow:null;
        const identityReader=!exploration&&Boolean(searchParams?.get('identity'))&&row.resourceType==='galaxy';
        const expandedReader=Boolean(selectedDetail)&&row.resourceType==='galaxy';
        // Direct UID navigation already has the authorized Galaxy detail in
        // toResult.editRow; ordinary expanded reading uses fullTextRow.
        const readerRow=selectedDetail||(identityReader?row.editRow:null);
        const readingDetail=Boolean(readerRow&&row.resourceType==='galaxy'&&
          (identityReader||expandedReader));
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
          {!exploration&&scopeId==='loc'&&scopeLabel(row.scopeId)&&(index===0||orderedResults[index-1]?.scopeId!==row.scopeId)
            ?<h2 className="scope-search-scope-heading">{scopeLabel(row.scopeId)}</h2>:null}
        <Article
          key={row.key}
          editOnCardClick={false}
          managerMode={managementMode}
          uid={editTarget.editResourceId}
          title={!privateResultMode&&row.resourceType==='galaxy'&&row.list===false?'（使用者隱藏）':row.title}
          articleHref={!exploration&&row.resourceType==='galaxy'&&(managementMode||row.list!==false)
            ?(managementMode?scopeHref(scopeId,'search/manage')+'?identity='+encodeURIComponent(row.resourceId)+'&scope='+encodeURIComponent(row.scopeId):galaxyIdentityHref(row.scopeId,row.resourceId))
            :''}
          detailReading={readingDetail}
          source={searchParams?.get('identity')?row.styleTagMatch?'':row.source:''}
          date={row.date}
          body={''}
          hidden={false}
          relationLinks={readingDetail?readingLinks:[]}
          relatedMedia={readingDetail?relatedMedia:[]}
          relatedTime={readingDetail?readerRow?.related_time||row.relatedTime:null}
          relatedSpace={readingDetail?readerRow?.related_space||row.relatedSpace:null}
          relatedStatistics={readingDetail?readerRow?.related_statistics||row.relatedStatistics:null}
          articleScopeId={row.scopeId}
          articleDate={readingDetail?readerRow?.article_day||readerRow?.date||row.articleDay||row.date:''}
          articleCreateTime={readingDetail?readerRow?.createtime||row.createtime:row.createtime}
          tracePlace={readingDetail?tracePlace:null}
          traceHref={readingDetail&&tracePlace?featureNavigationHref(row.scopeId,'trace',{place:tracePlace.uid}):''}
          locationName={readingDetail?locationName:''}
          links={readingDetail?readerRow?.links||row.links||[]:[]}
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
          showHidden={privateResultMode}
          attributeFields={managementMode&&editable?GALAXY_ATTR_FIELDS:null}
          mediaScopeId={editable&&row.resourceType==='galaxy'?row.scopeId:''}
          attributeTitle={t('uiExtra.searchUI.attributeTitle')}
          showBodyEditor={row.resourceType==='galaxy'}
          styleTag={row.styleTagMatch||row.featured}
          styleTagKicker={row.featured?'特徵頁':row.styleTagMatch?<UiText id="uiExtra.searchUI.styleRecommendations"/>:null}
          styleIntroText={row.featured?'因「'+row.featuredPatternTitle+'」優先顯示':row.styleIntroText}
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
              showToggle={!exploration&&!searchParams?.get('identity')}
            />
            {fullTextKey===row.key&&canOfferEdit?<button type="button" className="loc-button scope-work-edit-button"
              onClick={()=>startEditing(editTarget)}>
              <UiText id="uiExtra.editBlocks.edit"/>
            </button>:null}
          </div>:null}

        </Article>
        </Fragment>;
  }
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
    {!managementMode?<section className="scope-search-workspace" data-search-stage={publicResultsMode?'results':'home'} aria-label={t('uiExtra.searchUI.searchWorkspace')}>
      <form className="scope-search-form" onSubmit={runSearch}>
        {!managementMode?<label htmlFor="scope-search-query">{UI_COPY.search.textPromptLabel}</label>:null}
        {searchInput('scope-search-query','搜尋文章標題或內容')}
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
      {!publicResultsMode?<button type="button" className="loc-button scope-search-popular-toggle"
        aria-expanded={searchPopularOpen} aria-controls="scope-search-suggestions"
        onClick={()=>setSearchPopularOpen(open=>!open)}>
        {searchPopularOpen?'收起建議搜尋':'顯示建議搜尋'}
      </button>:null}
      {!publicResultsMode?<div id="scope-search-suggestions" className="scope-search-suggestions"
        role="group" aria-label="建議搜尋前10項" hidden={!searchPopularOpen}>
        <span className="scope-status">建議搜尋（最多 10 項）</span>
        <div className="scope-search-active-filters">
          {suggestedTerms.map(term=><button key={term} type="button" className="loc-button"
            onClick={()=>{setQuery(term);setSearchPopularOpen(false);followSearchSuggestion(term);}}>{term}</button>)}
          {!suggestedTerms.length?<span className="scope-status">目前沒有已發布的搜尋建議。</span>:null}
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
      {publicResultsMode?null:<div className="scope-search-advanced" ref={advancedRef}>
        <button type="button" className="scope-search-advanced-toggle" aria-expanded={advancedOpen} aria-controls="scope-search-filter-panel" onClick={()=>setAdvancedOpen(value=>!value)}>
          <span><strong>{t('uiExtra.searchUI.advancedFilters')}</strong>{!managementMode?<small>{t('uiExtra.searchUI.advancedHelp')}</small>:null}</span>
          <span aria-hidden="true">{advancedOpen?'▴':'▾'}</span>
        </button>
        <div className="scope-search-active-filters" aria-live="polite">
          {chips.length?chips.map((chip,index)=><span className="scope-search-chip" key={index}>{chip}</span>):!managementMode?<span className="scope-search-chip is-muted">{t('uiExtra.searchUI.noFilters')}</span>:null}
        </div>
        {advancedOpen?<div id="scope-search-filter-panel" className="scope-search-filter-panel">
          <div role="group" className="scope-search-filter-tabs" aria-label={t('uiExtra.searchUI.advancedFilters')}>
            {(managementMode?['type','source','time']:['time']).map(tab=><button type="button" key={tab} aria-pressed={advancedTab===tab} className={advancedTab===tab?'is-active':''} onClick={()=>setAdvancedTab(tab)}>{t('uiExtra.searchUI.filter'+tab[0].toUpperCase()+tab.slice(1))}</button>)}
          </div>
          {managementMode&&advancedTab==='type'?<div className="scope-search-filter-body">
            <label htmlFor="scope-search-content-type">{t('uiExtra.searchUI.filterType')}</label>
            <select id="scope-search-content-type" value={contentType} onChange={event=>updateSearchFilter(setContentType,event.target.value)}>
              {filterTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="loc-button" onClick={browseSelectedType}>{t('uiExtra.searchUI.browseType')}</button>
          </div>:null}
          {managementMode&&advancedTab==='source'?<div className="scope-search-filter-body">
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
      </div>}
    {!publicResultsMode?<SearchSummary scopeIds={summaryScopeIds}/>:null}
    {!publicResultsMode?<section className="scope-search-reference-editor" aria-label="搜尋建議">
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
      transition={{duration:reduceMotion?0:LOC_MOTION.arrival,times:[0,.26,1],ease:'easeOut'}}/>:null}
    {status&&(!managementMode||status!==UI_COPY.search.start)&&
      (managementMode||!publicResultsMode||publicStatusIsActionable)?<p className="scope-status" role="status" aria-live="polite">{status==='搜尋中請稍後'||status===UI_COPY.search.loadingRelation?<ActivityMotion/>:
      error||status===UI_COPY.search.failed||status===UI_COPY.search.relationFailed?<ActivityMotion state="error"/>:
      status==='已取消搜尋。'||status==='已取消讀取文章。'?<ActivityMotion state="cancelled"/>:
      status===UI_COPY.search.empty?<ActivityMotion state="empty"/>:
      status===UI_COPY.search.start?null:results.length>0?<ActivityMotion state="success"/>:null} {status}
      {searchInFlight?<button type="button" className="loc-button" onClick={cancelSearch}>取消</button>:null}</p>:null}
    {!managementMode&&!publicResultsMode&&results.length>0&&!browseResults&&matchedQueryRef.current?<section className="scope-search-next-step"
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
    {searchInFlight&&loadingMore?<p className="scope-status" role="status" aria-live="polite">
      正在載入更多文章… <ActivityMotion/>
      <button type="button" className="loc-button" onClick={cancelSearch}>取消</button>
    </p>:null}
    {results.length||hasMore?<div style={{display:'flex',justifyContent:'flex-end',marginBottom:'.5rem'}}>
      <ArticleSortSelect value={articleSort} onChange={changeArticleSort} disabled={Boolean(editingKey)}/>
    </div>:null}
    {error?<p className="scope-status scope-error">{error}</p>:null}
    {loadMoreError?<p role="alert" className="scope-status scope-error">{loadMoreError} <button type="button" className="loc-button" disabled={loadingMore} onClick={loadNextSearch}><UiText id="uiExtra.cultureView.reloadWorks"/></button></p>:null}
    {managementMode&&status==='搜尋中請稍後'&&!results.length?<section className="loc-progressive-river-frame" aria-busy="true"><span>文章列表</span><div className="loc-progressive-river-axis" aria-hidden="true"/></section>:null}
    <div className={!managementMode&&(results.length||fullTextKey)?'loc-search-explorer':undefined}>
    <div className={!managementMode?'loc-search-explorer__results':undefined}>
    <IncrementalList
      items={orderedResults}
      className={managementMode?'scope-list':'scope-list loc-public-article-list'}
      batchSize={pageSize}
      resetKey={matchedQueryRef.current+'|'+String(browseResults)+'|'+scopeFilter+'|'+articleSort}
      externalHasMore={hasMore}
      loading={loadingMore}
      error={error||loadMoreError}
      onLoadMore={loadNextSearch}
      renderItem={(row,index)=>managementMode||row.resourceType!=='galaxy'
        ?renderSearchArticle(row,index):<button type="button" className={'loc-search-result-choice'+(row.featured?' is-featured':'')}
          disabled={row.list===false&&!privateResultMode}
          aria-pressed={fullTextKey===row.key}
          onClick={()=>void toggleFullText(row)}>
          {row.featured?<span className="loc-search-featured-badge">特徵頁 · {row.featuredPatternTitle}</span>:null}
          <strong>{row.list===false&&!privateResultMode?'（使用者隱藏）':row.title}</strong>
          <small>{[scopeId==='loc'?scopeLabel(row.scopeId):'',String(row.date||'').slice(0,10)].filter(Boolean).join(' · ')}</small>
        </button>}
    />
    </div>
    {!managementMode&&(results.length||fullTextKey)?<section className="loc-search-explorer__reader" aria-label="文章全文與關聯">
      {fullTextKey&&readerResult?<motion.div key={fullTextKey}
        initial={reduceMotion?false:{opacity:0,x:8}} animate={{opacity:1,x:0}}
        transition={{duration:reduceMotion?0:LOC_MOTION.feedback}}>
        {fullTextLoading?<p className="scope-status" role="status">正在讀取文章… <ActivityMotion kind="hourglass"/>
          {searchInFlight?<button type="button" className="loc-button" onClick={cancelSearch}>取消</button>:null}</p>:null}
        {renderSearchArticle(readerResult,0,true)}
        {fullTextError?<button type="button" className="loc-button" onClick={()=>void toggleFullText(readerResult)}>重新讀取文章</button>:null}
      </motion.div>:<p className="scope-status">選擇左側文章，閱讀全文及探索關聯。</p>}
    </section>:null}
    </div>
    </div>
  </>;
  // The management workspace owns its Hero even when the user's management
  // list opt-in is off or permission verification is pending. Never mount
  // a second FeaturePage inside its existing page shell.
  if(legacyManagementRoute)return pageContent;
  // A user opting in from ordinary Search still needs a standalone page shell.
  if(managementMode)return <FeaturePage featureId="search">{pageContent}</FeaturePage>;
  return <FeaturePage featureId="search">
    {!publicResultsMode||publicView==='trace'?<div className="scope-search-view-labels" role="group" aria-label={UI_COPY.features.search.title+' / '+UI_COPY.features.trace.detailsLabel}>
      <button type="button" aria-pressed={publicView==='search'}
        onClick={()=>setPublicView('search')}>{UI_COPY.features.search.title}</button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={publicView==='trace'}
        onClick={()=>setPublicView('trace')}>{UI_COPY.features.trace.detailsLabel}</button>
    </div>:null}
    <div className="scope-search-view-panel" role="region"
      aria-label={publicView==='search'?UI_COPY.features.search.title:UI_COPY.features.trace.detailsLabel}>
      {publicView==='search'?pageContent:<TraceBlocks scopeId={scopeId}/>}
    </div>
  </FeaturePage>;
}

