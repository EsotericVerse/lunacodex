'use client';

import {dbAuthRelation,dbAuthClient} from './db-client.mjs';
import {isUnifiedAnchorScope} from './unified-anchor-compat.mjs';
import {selectAllRows,selectRows} from './db-query.mjs';
import {defaultScopeData,selectManagedScope} from './scope-data';
import {analyzeIncrementalKeywordPatterns} from './keyword-incremental.mjs';
import {splitKeywordPatternBatches} from './keyword-search-pattern.mjs';
import {createIndexedDateKeywordReader} from './keyword-article-reader.mjs';
import {keywordClassState,invalidateKeywordClass,completeKeywordClass} from './keyword-class-state.mjs';
import {keywordClassCatalog} from './keyword-tree.mjs';
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

async function keywordSourceCount(scope){
  // COUNT and scan must use the same authenticated visibility: public reads
  // omit owner-visible hidden articles and would report a misleading total.
  const {count,error}=await dbAuthRelation(scope.galaxy)
    .select('uid',{count:'exact',head:true});
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
// The Scope keeps ONE literal-word UID index. Article metadata is scanned
// without body text; only words with no prior scan or documents whose
// Galaxy.UpdateTime is newer than that word's previous scan read content.
// Anchor is ZModel hierarchy only: it no longer receives totals/UID lists.
export async function runKeywordAnalysisBatch(scopeId,{classUid:requestedClassUid='',onProgress}={}){
  const id=normalizeScopeId(scopeId),{scope,config}=await scopeAndConfig(id);
  const classUid=String(requestedClassUid||config.current_keyword_class_uid||'');
  if(!/^[0-9A-Za-z]{8}$/.test(classUid))throw new Error('尚未指定有效的 Keywords Class');
  const startedAt=new Date().toISOString();
  const treeRows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await dbAuthRelation(scope.keywords)
      .select('uid,type,name,desc,lists')
      .order('name',{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(error.message||'Keywords 規則讀取失敗');
    treeRows.push(...(data||[]));
    if((data||[]).length<500)break;
  }
  const {catalog}=keywordClassCatalog(treeRows,classUid);
  const minChars=normalizeKeywordMinChars(config.keyword_min_chars);
  const minDocuments=normalizeKeywordMinDocuments(config.keyword_min_documents);
  const expectedCount=await keywordSourceCount(scope);
  const existingPatterns=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await dbAuthRelation('silver.loc_search_pattern')
      .select('pattern,count,uid_list').eq('scopeid',id)
      .order('pattern',{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(error.message||'關鍵詞詞級索引讀取失敗');
    existingPatterns.push(...(data||[]));
    if((data||[]).length<500)break;
  }
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
      ?Math.min(60,3+Math.floor(57*done/Math.max(1,expectedCount))):
      event.phase==='writing'?60+Math.floor(39*done/Math.max(1,total)):100;
    reportBatchProgress(onProgress,event.phase,done,total,percent,
      event.phase==='reading'
        ?'檢查 '+done+' 篇文章（實際解析 '+(Number(event.parsed)||0)+' 篇）':
      event.phase==='writing'?'已更新 '+done+' / '+total+' 組詞級索引':'分析已完成');
  };
  // A metadata-only date reader preserves the established chronological,
  // tie-complete and article COUNT checks. No body text is transferred until
  // this incremental scan decides that an article actually needs parsing.
  const articleColumns='uid,date,createtime,UpdateTime,keyword';
  const readMetadataPage=createIndexedDateKeywordReader({
    readDatePage:async ({after,limit})=>{
      let q=dbAuthRelation(scope.galaxy).select(articleColumns)
        .not('date','is',null).order('date',{ascending:true}).limit(limit);
      if(after!==null)q=q.gt('date',after);
      const {data,error}=await q;
      if(error)throw new Error(error.message||'Galaxy metadata 分頁讀取失敗');
      return data||[];
    },
    readDatePeers:async ({date,maximumRows})=>{
      const {data,count,error}=await dbAuthRelation(scope.galaxy)
        .select(articleColumns,{count:'exact'}).eq('date',date).limit(maximumRows);
      if(error)throw new Error(error.message||'Galaxy 同日 metadata 讀取失敗');
      return {rows:data||[],count};
    },
    readUndated:async ({maximumRows})=>{
      const {data,count,error}=await dbAuthRelation(scope.galaxy)
        .select(articleColumns,{count:'exact'}).is('date',null).limit(maximumRows);
      if(error)throw new Error(error.message||'Galaxy 無日期 metadata 讀取失敗');
      return {rows:data||[],count};
    }
  });
  const result=await analyzeIncrementalKeywordPatterns({
    scopeId:id,classUid,treeRows,items:catalog,
    existingPatterns,patternScans:config.keyword_meta?.pattern_scans||{},
    minChars,pageSize:KEYWORD_ANALYSIS_READ_PAGE_SIZE,expectedCount,
    startedAt,readMetadataPage,
    readContent:async uids=>{
      if(!uids.length)return [];
      const {data,error}=await dbAuthRelation(scope.galaxy)
        .select('uid,content,keyword').in('uid',uids).limit(uids.length);
      if(error)throw new Error(error.message||'Galaxy 變動文章內文讀取失敗');
      return data||[];
    },
    writePatterns:async ({patterns})=>{
      const batches=splitKeywordPatternBatches(patterns);
      for(let i=0;i<batches.length;i++){
        const {data,error}=await dbAuthClient.schema('silver').managedAction('sync_search_patterns',{
          p_scope_id:id,p_class_uid:classUid,p_patterns:batches[i],
          p_final:i===batches.length-1
        });
        if(error||data?.patterns!==batches[i].length)
          throw new Error(error?.message||'關鍵詞詞級索引未能完整寫入');
        progress({phase:'writing',completed:i+1,total:batches.length});
      }
    },
    finalize:async counts=>{
      const now=new Date().toISOString();
      const {data:latest,error:readError}=await dbAuthRelation(scope.config)
        .select('keyword_meta').eq('id',id).limit(1);
      if(readError||latest?.length!==1)
        throw new Error(readError?.message||'無法讀取最新關鍵詞狀態');
      const meta={class_uid:classUid,matchedDocuments:counts.matchedDocuments,
        analyzedDocuments:counts.analyzedDocuments,parsedDocuments:counts.parsedDocuments,
        reusedDocuments:counts.reusedDocuments,itemMatches:counts.itemMatches,
        occurrences:counts.occurrences};
      const merged=completeKeywordClass(latest[0].keyword_meta,classUid,meta,now);
      const saved={...merged,pattern_scans:{
        ...(merged.pattern_scans||{}),...counts.patternScans
      }};
      const {data,error}=await dbAuthRelation(scope.config)
        .update({keyword_meta:saved,staticstime:null,updated_at:now})
        .eq('id',id).select('id');
      if(error||data?.length!==1)throw new Error(error?.message||'Keywords 狀態保存失敗');
    },
    onProgress:progress
  });
  clearKeywordAnalysisCache();
  return {...result,documentCount:result.analyzedDocuments,
    keywordDocumentCount:result.matchedDocuments,keywordMinChars:minChars,
    keywordMinDocuments:minDocuments,
    statisticsEnabled:result.matchedDocuments>minDocuments,skipped:false};
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
// Class/Group/Item statistics are projections of the one stored literal-word
// UID index. Anchor supplies the ZModel hierarchy, never stored hit numbers.
export async function selectKeywordAnalysisSummary({scopeId,classUid='',startDate='',endDate='',
  sourceCategory='',sourceCategories=[],sourceAliases=[],sourceNames=null}={}){
  const id=normalizeScopeId(scopeId);
  const {config}=await scopeAndConfig(id,{publicRead:true});
  const selectedClass=String(classUid||config.current_keyword_class_uid||'');
  const state=keywordClassState(config,selectedClass);
  const scopedConfig={...config,staticstime:state?.completedAt||null,
    keyword_meta:state||{}};
  if(!state)return emptyStored(scopedConfig);
  const category=String(sourceCategory||'').trim().toLowerCase();
  const source=Array.isArray(sourceNames)&&sourceNames.length===1
    ?String(sourceNames[0]):'';
  if(category&&!source)throw new Error('關鍵詞來源分類需要指定原始來源名稱');
  const {data,error}=await dbAuthClient.schema('silver').managedAction(
    'keyword_pattern_statistics',{
      p_scope_id:id,p_class_uid:selectedClass,
      p_start_date:startDate,p_end_date:endDate,p_source:source
    });
  if(error)throw error;
  if(!data||data.class_uid!==selectedClass)
    throw new Error('指定 Class 的詞級統計資料不完整');
  const groups=Array.isArray(data.groups)?data.groups:[];
  const items=Array.isArray(data.items)?data.items:[];
  const groupTotals=groups.map((row,index)=>({
    group_uid:row.uid,group:row.name,order:index,
    document_count:Number(row.document_count)||0,
    hit_count:Number(row.hit_count)||0
  }));
  const runeTotals=items.map((row,index)=>({
    uid:row.uid,label:row.name,order:index,
    count:Number(row.hit_count)||0,
    document_count:Number(row.document_count)||0
  }));
  const matched=Math.max(0,Number(data.document_count)||0);
  const ranked=[...runeTotals].sort((a,b)=>b.count-a.count||
    b.document_count-a.document_count||a.order-b.order);
  const base=emptyStored(scopedConfig,{
    keywordDocumentCount:matched,
    keywordMeta:{...state,class_uid:selectedClass,
      class_name:String(data.class_name||''),
      classes:Object.fromEntries(groups.map(row=>[row.uid,row.name])),
      items:Object.fromEntries(items.map(row=>[row.uid,row.name]))}
  });
  return {...base,documentCount:matched,classifiedCount:matched,
    unclassifiedCount:0,classifications:[],
    runeTotals:base.statisticsEnabled?runeTotals:[],
    runeRanking:base.statisticsEnabled?ranked:[],
    groupTotals:base.statisticsEnabled?groupTotals:[]};
}

// Stateless: Keyword / Galaxy data is never retained in a module-level cache.
export function clearKeywordAnalysisCache(){}
