'use client';

import {keywordService} from './keyword-service-client.mjs';

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

export async function selectActiveKeywordClassName(scopeId=''){
  const info=await selectAvailableKeywordClasses(scopeId);
  const selected=info.classes?.find(row=>row.classUid===info.currentClassUid);
  return String(selected?.name||'');
}
export async function selectAvailableKeywordClasses(scopeId){
  return keywordService('classes',{scopeId:normalizeScopeId(scopeId)});
}
// Browser only asks the verified server to run the indexed word analysis.
export async function runKeywordAnalysisBatch(scopeId,{classUid:requestedClassUid='',onProgress}={}){
  const id=normalizeScopeId(scopeId);
  const classUid=String(requestedClassUid||'');
  if(!/^[0-9A-Za-z]{8}$/.test(classUid))
    throw new Error('尚未指定有效的 Keywords Class');
  reportBatchProgress(onProgress,'reading',0,0,0,'解析關鍵詞中請稍後');
  const result=await keywordService('analyze',{scopeId:id,classUid});
  reportBatchProgress(onProgress,'completed',
    Number(result?.analyzedDocuments)||0,
    Number(result?.analyzedDocuments)||0,100,'分析已完成');
  clearKeywordAnalysisCache();
  return {...result,documentCount:Number(result?.analyzedDocuments)||0,
    keywordDocumentCount:Number(result?.matchedDocuments)||0,skipped:false};
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
  const selectedClass=String(classUid||
    (await selectAvailableKeywordClasses(id)).currentClassUid||'');
  if(!selectedClass)return emptyStored({});
  const category=String(sourceCategory||'').trim().toLowerCase();
  const source=Array.isArray(sourceNames)&&sourceNames.length===1
    ?String(sourceNames[0]):'';
  if(category&&!source)throw new Error('關鍵詞來源分類需要指定原始來源名稱');
  const data=await keywordService('stats',{
    scopeId:id,classUid:selectedClass,startDate,endDate,source
  });
  if(!data||data.class_uid!==selectedClass)
    throw new Error('指定 Class 的詞級統計資料不完整');
  const state={class_uid:selectedClass,completedAt:String(data.completedAt||'')};
  const scopedConfig={
    keyword_min_chars:data.keywordMinChars,
    keyword_min_documents:data.keywordMinDocuments,
    staticstime:state.completedAt||null,
    keyword_meta:state
  };
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
  const groupNames=new Map(groups.map(group=>[group.uid,group.name]));
  const classifications=(Array.isArray(data.daily)?data.daily:[])
    .filter(row=>row.kind==='class_day'&&Number(row.document_count)>0)
    .map(row=>({
      key:'group-day:'+row.group_uid+':'+row.day,
      uid:'',date:String(row.day||''),
      classification_group:String(groupNames.get(row.group_uid)||''),
      group_uid:String(row.group_uid||''),
      count:Number(row.document_count)||0,status:'classified'
    }));
  const base=emptyStored(scopedConfig,{
    keywordDocumentCount:matched,
    keywordMeta:{...state,class_uid:selectedClass,
      class_name:String(data.class_name||''),
      classes:Object.fromEntries(groups.map(row=>[row.uid,row.name])),
      items:Object.fromEntries(items.map(row=>[row.uid,row.name]))}
  });
  return {...base,documentCount:matched,classifiedCount:matched,
    unclassifiedCount:0,classifications:base.statisticsEnabled?classifications:[],
    runeTotals:base.statisticsEnabled?runeTotals:[],
    runeRanking:base.statisticsEnabled?ranked:[],
    groupTotals:base.statisticsEnabled?groupTotals:[]};
}

// Stateless: Keyword / Galaxy data is never retained in a module-level cache.
export function clearKeywordAnalysisCache(){}
