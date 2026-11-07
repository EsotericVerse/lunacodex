'use client';

import {dbAuthRelation,dbAuthClient} from './db-client.mjs';
import {isUnifiedAnchorScope} from './unified-anchor-compat.mjs';
import {selectAllRows,selectRows} from './db-query.mjs';
import {defaultScopeData,selectManagedScope} from './scope-data';
import {reanalyzeKeywordClass} from './keyword-reanalysis.mjs';
import {buildKeywordSearchPatterns} from './keyword-search-pattern.mjs';
import {createIndexedDateKeywordReader} from './keyword-article-reader.mjs';
import {keywordClassState,invalidateKeywordClass,completeKeywordClass} from './keyword-class-state.mjs';
import {keywordTreeCatalog} from './keyword-tree-report.mjs';
import {keywordClassDirectory} from './keyword-class-directory.mjs';

const KEYWORD_ANALYSIS_READ_PAGE_SIZE=1000;

const DEFAULT_KEYWORD_MIN_CHARS=32;
const DEFAULT_KEYWORD_MIN_DOCUMENTS=100;

function normalizeScopeId(value){
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw new Error('Scope ID 格式無效');
  return scope;
}

function normalizeKeywordMinChars(value){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=0?parsed:DEFAULT_KEYWORD_MIN_CHARS;
}
function normalizeKeywordMinDocuments(value){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=0?parsed:DEFAULT_KEYWORD_MIN_DOCUMENTS;
}
export function analysisCharacterCount(value){
  return Array.from(String(value??'').replace(/\s/gu,'')).length;
}
function reportBatchProgress(onProgress,phase,completed,total,percent,label,details={}){
  if(typeof onProgress!=='function')return;
  onProgress({
    phase,
    completed,
    total,
    percent:Math.max(0,Math.min(100,Math.round(percent))),
    label,
    ...details
  });
}

async function keywordEligibleCount(scope){
  // COUNT and scan must use the same authenticated visibility: public reads
  // omit owner-visible hidden articles and would report a misleading total.
  const {count,error}=await dbAuthRelation(scope.galaxy)
    .select('uid',{count:'exact',head:true}).eq('keyword','true');
  if(error||count===null||!Number.isSafeInteger(Number(count)))
    throw new Error(error?.message||'無法取得完整 Galaxy 統計總筆數');
  return Number(count);
}
export async function selectActiveKeywordClassName(scopeId=''){
  const scope=defaultScopeData(scopeId);
  if(!scope)return '';
  const {rows:config}=await selectRows(scope.config,{
    columns:'current_keyword_class_uid',
    filters:[{column:'id',operator:'eq',value:scope.id}],limit:1
  });
  const uid=String(config?.[0]?.current_keyword_class_uid||'');
  if(!uid)return '';
  const {rows}=await selectRows(scope.keywords,{
    columns:'uid,type,name',
    filters:[{column:'uid',operator:'eq',value:uid},{column:'type',operator:'eq',value:'class'}],limit:1
  });
  return String(rows?.[0]?.name||'');
}
// Only Classes that this caller can read are selectable. The existing
// active Class is the default when it appears in that authorized directory.
export async function selectAvailableKeywordClasses(scopeId){
  const id=normalizeScopeId(scopeId),scope=defaultScopeData(id);
  if(!scope)return {classes:[],currentClassUid:''};
  const [{readSharedKeywordClasses,dbAuthRelation},{rows}]=await Promise.all([
    import('./db-client.mjs'),
    selectRows(scope.config,{
      columns:'current_keyword_class_uid',
      filters:[{column:'id',operator:'eq',value:id}],limit:1
    })
  ]);
  // Guest: public/shared classes only. Owner: the existing authenticated
  // Keywords table's RLS (silver.can_manage_scope) permits the full tree.
  // Never expose private Class identities through a public/anonymous query.
  const shared=await readSharedKeywordClasses(id);
  let authorizedRows=[];
  try{
    const {data,error}=await dbAuthRelation(scope.keywords)
      .select('uid,type,name,lists')
      .in('type',['category','class']).limit(500);
    if(!error&&Array.isArray(data))authorizedRows=data;
  }catch{
    // Guest/RLS denial: only use Classes returned by the public shared reader.
  }
  return {classes:keywordClassDirectory(shared,authorizedRows,id),
    currentClassUid:String(rows?.[0]?.current_keyword_class_uid||'')};
}
async function scopeAndConfig(scopeId,{publicRead=false}={}){
  const id=normalizeScopeId(scopeId);
  // Public statistics only read the stored summary/config and public Galaxy attrs.
  // The writer still resolves the managed Scope with authenticated access.
  const scope=publicRead?defaultScopeData(id):await selectManagedScope(id);
  if(!scope)throw new Error('找不到 '+id+' Scope');
  const result=await selectAllRows(scope.config,{
    columns:'id,keyword_min_chars,keyword_min_documents,current_keyword_class_uid,keyword_class_share_enabled,keyword_meta,staticstime',
    filters:[{column:'id',operator:'eq',value:id}]
  });
  const config=result.rows?.[0]||null;
  if(!config)throw new Error('找不到 '+id+' 關鍵詞設定');
  return {scope,config,scopeId:id};
}
// Portable full reanalysis: all Galaxy content is read, but only Keyword Item
// uidlist columns are written. No old classification state is consulted.
export async function runKeywordAnalysisBatch(scopeId,{classUid:requestedClassUid='',onProgress}={}){
  const id=normalizeScopeId(scopeId),{scope,config}=await scopeAndConfig(id);
  const classUid=String(requestedClassUid||config.current_keyword_class_uid||'');
  if(!/^[0-9A-Za-z]{8}$/.test(classUid))throw new Error('尚未指定有效的 Keywords Class');
  // Keywords rules are private unless explicitly shared. Reanalysis always
  // reads with the authenticated Scope-owner client, never anonymous RLS.
  const treeRows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await dbAuthRelation(scope.keywords)
      .select('uid,type,name,desc,lists')
      .order('name',{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(error.message||'Keywords 規則讀取失敗');
    treeRows.push(...(data||[]));
    if((data||[]).length<500)break;
  }
  const catalog=keywordTreeCatalog(treeRows,classUid);
  const minChars=normalizeKeywordMinChars(config.keyword_min_chars);
  const minDocuments=normalizeKeywordMinDocuments(config.keyword_min_documents);
  const eligibleCount=await keywordEligibleCount(scope);
  // Mark only this Class stale; other Classes keep their completed results.
  const staleMeta=invalidateKeywordClass(config.keyword_meta,classUid);
  const {data:staled,error:staleError}=await dbAuthRelation(scope.config)
    .update({keyword_meta:staleMeta,staticstime:null})
    .eq('id',id).select('id');
  if(staleError||staled?.length!==1)
    throw new Error(staleError?.message||'無法標記 Class 重新分析狀態');
  clearKeywordAnalysisCache();
  const progress=event=>{
    const done=Number(event.completed)||0,total=Number(event.total)||0;
    const percent=event.phase==='reading'
      ?Math.min(60,3+Math.floor(57*done/Math.max(1,Number(eligibleCount)||done)))
      :event.phase==='writing'?60+Math.floor(39*done/Math.max(1,total)):100;
    reportBatchProgress(onProgress,event.phase,done,total,percent,
      event.phase==='reading'?'已重新判斷 '+done+' 篇文章':
      event.phase==='writing'?'已更新 '+done+' / '+total+' 筆 Keywords':'分析已完成');
  };
  // Galaxy.date is already indexed. All eligible LOC Galaxy dates were
  // checked against their Taipei publication-date components before this
  // cutover; the reader also validates every returned row before writing.
  // Within each day articles stay in createtime + UID order.
  const articleColumns='uid,date,createtime,content,keyword';
  const readArticles=createIndexedDateKeywordReader({
    readDatePage:async ({after,limit})=>{
      let query=dbAuthRelation(scope.galaxy)
        .select(articleColumns).eq('keyword','true')
        .not('date','is',null)
        .order('date',{ascending:true}).limit(limit);
      if(after!==null)query=query.gt('date',after);
      const {data,error}=await query;
      if(error)throw new Error(error.message||'Galaxy 日期索引分頁讀取失敗');
      return data||[];
    },
    readDatePeers:async ({date,maximumRows})=>{
      const {data,count,error}=await dbAuthRelation(scope.galaxy)
        .select(articleColumns,{count:'exact'}).eq('keyword','true')
        .eq('date',date).limit(maximumRows);
      if(error)throw new Error(error.message||'Galaxy 同日文章讀取失敗');
      return {rows:data||[],count};
    },
    readUndated:async ({maximumRows})=>{
      const {data,count,error}=await dbAuthRelation(scope.galaxy)
        .select(articleColumns,{count:'exact'}).eq('keyword','true')
        .is('date',null).limit(maximumRows);
      if(error)throw new Error(error.message||'Galaxy 無日期文章讀取失敗');
      return {rows:data||[],count};
    }
  });
  const {keywordUidListRecord}=await import('./keyword-tree.mjs');
  const typeByUid=new Map(treeRows.map(row=>[row.uid,row.type]));
  const result=await reanalyzeKeywordClass({
    classUid,treeRows,minChars,pageSize:KEYWORD_ANALYSIS_READ_PAGE_SIZE,expectedCount:eligibleCount,compactResults:isUnifiedAnchorScope(id),
    readPage:readArticles,
    writeNode:async ({uid,uid_lists})=>{
      const type=typeByUid.get(uid);
      if(!type)throw new Error('Keyword UID missing during classification write');
      // The large UID array now belongs only to loc_search_pattern; Anchor
      // retains the existing compact Item/Group count for compatibility.
      const stored=isUnifiedAnchorScope(id)?{total:uid_lists.total,uidlists:[]}
        :keywordUidListRecord(type,uid_lists);
      const {data,error}=await dbAuthRelation(scope.keywords).update({uid_lists:stored})
        .eq('uid',uid).select('uid');
      if(error||data?.length!==1)throw new Error('Keywords.uid_lists 儲存失敗：'+uid+' '+(error?.message||''));
    },
    writePatterns:async ({items})=>{
      const patterns=buildKeywordSearchPatterns(id,items);
      const {data,error}=await dbAuthClient.schema('silver').managedAction('sync_search_patterns',{
        p_scope_id:id,p_class_uid:classUid,p_patterns:patterns
      });
      if(error||data?.patterns!==patterns.length)
        throw new Error(error?.message||'關鍵詞搜尋對照表未能完整寫入');
    },
    finalize:async counts=>{
      // Per-Class completion is the only public-config state. Labels, hit counts
      // and matching details are read from Class-authorized tree RPCs instead.
      const meta={class_uid:classUid,matchedDocuments:counts.matchedDocuments,
        analyzedDocuments:counts.analyzedDocuments,itemMatches:counts.itemMatches,
        occurrences:counts.occurrences};
      const now=new Date().toISOString();
      const {data:latest,error:readError}=await dbAuthRelation(scope.config)
        .select('keyword_meta,current_keyword_class_uid').eq('id',id).limit(1);
      if(readError||latest?.length!==1)
        throw new Error(readError?.message||'無法讀取最新 Class 狀態');
      const saved=completeKeywordClass(latest[0].keyword_meta,classUid,meta,now);
      const {data,error}=await dbAuthRelation(scope.config)
        .update({
          keyword_meta:saved,
          staticstime:null,updated_at:now
        })
        .eq('id',id).select('id');
      if(error||data?.length!==1)throw new Error(error?.message||'Keywords 結果保存失敗');
    },onProgress:progress
  });
  clearKeywordAnalysisCache();
  return {...result,documentCount:result.analyzedDocuments,
    keywordDocumentCount:result.matchedDocuments,keywordMinChars:minChars,
    keywordMinDocuments:minDocuments,statisticsEnabled:result.matchedDocuments>minDocuments,
    skipped:false};
}
function emptyStored(config,extra={}){
  const minDocuments=normalizeKeywordMinDocuments(config?.keyword_min_documents);
  const globalCount=Math.max(0,Number(extra?.keywordDocumentCount)||0);
  return {
    documentCount:0,
    classifiedCount:0,
    unclassifiedCount:0,
    tieCount:0,
    classifications:[],
    runeTotals:[],
    runeRanking:[],
    groupTotals:[],
    unsupportedRules:[],
    keywordMinChars:normalizeKeywordMinChars(config?.keyword_min_chars),
    keywordMinDocuments:minDocuments,
    keywordDocumentCount:globalCount,
    statisticsEnabled:Boolean(config?.staticstime)&&globalCount>minDocuments,
    staticstime:config?.staticstime||'',
    keywordMeta:config?.keyword_meta||{},
    ...extra
  };
}
// Exact counts for the stored classification, reduced from row-level data. Used only
// when the database-side RPC (silver.read_rune66_summary) is not available.
// Exact UID-list results are summarized by PostgreSQL.
function aggregateSummaryRpcRows(rows){
  const result={eligible:0,groupDays:[],items:new Map()};
  for(const row of rows||[]){
    if(row.kind==='eligible')result.eligible=Number(row.document_count)||0;
    if(row.kind==='class_day')result.groupDays.push({
      group_uid:String(row.group_uid||''),day:String(row.day||'').slice(0,10),
      count:Number(row.document_count)||0
    });
    if(row.kind==='item')result.items.set(String(row.item_key||''),row);
  }
  return result;
}
function storedSummary(agg,config,globalCount=agg.eligible){
  const meta=config?.keyword_meta||{};
  const classes=meta.classes||{},items=meta.items||{};
  const totals=new Map(),classifications=[];
  for(const item of agg.groupDays){
    if(!classes[item.group_uid]||!item.count)continue;
    totals.set(item.group_uid,(totals.get(item.group_uid)||0)+item.count);
    classifications.push({
      key:'group-day:'+item.group_uid+':'+item.day,uid:'',date:item.day,
      classification_group:String(classes[item.group_uid]),
      group_uid:item.group_uid,count:item.count,status:'classified'
    });
  }
  const groupTotals=Object.entries(classes).map(([uid,name],index)=>({
    group_uid:uid,group:name,order:index,document_count:totals.get(uid)||0
  }));
  const runeTotals=Object.entries(items).map(([uid,label],index)=>({
    uid,label,order:index,count:Number(agg.items.get(uid)?.hit_count)||0,
    document_count:Number(agg.items.get(uid)?.document_count)||0
  }));
  const classifiedCount=classifications.reduce((n,row)=>n+row.count,0);
  const base=emptyStored(config,{keywordDocumentCount:globalCount});
  return {...base,documentCount:agg.eligible,classifiedCount,
    unclassifiedCount:Math.max(0,agg.eligible-classifiedCount),
    classifications:base.statisticsEnabled?classifications:[],
    runeTotals:base.statisticsEnabled?runeTotals:[],
    runeRanking:base.statisticsEnabled?[...runeTotals].sort((a,b)=>b.count-a.count||b.document_count-a.document_count||a.order-b.order):[],
    groupTotals:base.statisticsEnabled?groupTotals:[]
  };
}
export async function selectKeywordAnalysisSummary({scopeId,classUid='',startDate='',endDate='',
  sourceCategory='',sourceCategories=[],sourceAliases=[],sourceNames=null}={}){
  const id=normalizeScopeId(scopeId);
  const category=String(sourceCategory||'').trim().toLowerCase();
  const source=Array.isArray(sourceNames)&&sourceNames.length===1?String(sourceNames[0]):'';
  return (async()=>{
    const {config}=await scopeAndConfig(id,{publicRead:true});
    const selectedClass=String(classUid||config.current_keyword_class_uid||'');
    const state=keywordClassState(config,selectedClass);
    const {readKeywordTreeSummary,readKeywordTreeCatalog}=await import('./db-client.mjs');
    // A private Class must not expose even its completion timestamp through
    // the public statistics helper. The catalog RPC enforces Class sharing.
    const directory=await readKeywordTreeCatalog(id,{classUid:selectedClass});
    if(directory.class_uid!==selectedClass)
      return emptyStored({...config,staticstime:null,keyword_meta:{}});
    const scopedConfig={...config,staticstime:state?.completedAt||null,keyword_meta:state||{}};
    if(!state)return emptyStored(scopedConfig);
    if(category&&!source)
      throw new Error('關鍵詞來源分類需要指定原始來源名稱');
    const tree=keywordTreeCatalog(directory.rows,selectedClass);
    const {groups}=tree;
    const displayed={
      ...state,class_uid:selectedClass,class_name:tree.name,
      classes:Object.fromEntries(groups.map(group=>[group.uid,group.name])),
      items:Object.fromEntries(groups.flatMap(group=>group.items.map(item=>[item.uid,item.name])))
    };
    const rows=await readKeywordTreeSummary(id,{classUid:selectedClass,startDate,endDate,source});
    const agg=aggregateSummaryRpcRows(rows.filter(row=>row.kind!=='item_day'));
    return storedSummary(agg,{...scopedConfig,keyword_meta:displayed},agg.eligible);
  })();
}

// Stateless: Keyword / Galaxy data is never retained in a module-level cache.
export function clearKeywordAnalysisCache(){}
