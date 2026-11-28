'use client';

import {invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';
import {editorTransactionLease,assertEditorTransactionLease,
  isEditorTransactionCancelled} from '../db/editor-transaction-lifecycle.mjs';
import {queryKeywordClasses,queryKeywordStatistics,queryKeywordCatalog,
  queryKeywordDaily,queryKeywordWorkspace,queryKeywordAnalysisCompletion,
  queryKeywordSuggestions,queryKeywordLucusArticles}
  from '../actions/keywords/queries.mjs';
import {runKeywordAnalysisBatch,resetKeywordClass,saveKeywordItemAction,
  deleteKeywordItemAction,setKeywordClassShareAction}
  from '../actions/keywords/writes.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

// A lost Server Action response does not prove whether the current bounded
// analysis step committed its checkpoint. Keep its identity for a read-only
// receipt check; never automatically replay a non-idempotent analysis step.
export class KeywordAnalysisUnconfirmedError extends Error {
  constructor({scopeId,classUid,attemptId}){
    super('關鍵詞分析連線中斷，本次結果尚未確認。請使用「核對本次分析」查詢原始執行紀錄，勿直接重跑或清空。');
    this.name='KeywordAnalysisUnconfirmedError';
    this.scopeId=scopeId;
    this.classUid=classUid;
    this.attemptId=attemptId;
  }
}

const OPERATIONS=new Set(['analyze','analyzeStatus','reset','classes','catalog',
  'summary','stats','suggest','lucusSearch','saveItem','deleteItem',
  'setClassShare','workspace']);
const READS={
  analyzeStatus:queryKeywordAnalysisCompletion,
  classes:queryKeywordClasses,
  catalog:queryKeywordCatalog,
  summary:queryKeywordDaily,
  stats:queryKeywordStatistics,
  suggest:queryKeywordSuggestions,
  lucusSearch:queryKeywordLucusArticles,
  workspace:queryKeywordWorkspace
};
const WRITES={
  reset:resetKeywordClass,
  saveItem:saveKeywordItemAction,
  deleteItem:deleteKeywordItemAction,
  setClassShare:setKeywordClassShareAction
};

function assertSignal(signal){
  if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
}
function isBusinessRefusal(error){
  const status=Number(error?.httpStatus??error?.status);
  return status>=400&&status<500;
}
function committed(operation,scope,result){
  const write=['analyze','reset','saveItem','deleteItem','setClassShare'].includes(operation);
  if(write&&!(operation==='analyze'&&result?.incomplete===true)||
    operation==='analyzeStatus'&&result?.completed)
    invalidateScopedReadCache('silver.'+scopeTableName(scope,'lucus'));
  return result;
}

export async function keywordService(operation,args={},options={}){
  if(!OPERATIONS.has(operation))throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'').trim().toLowerCase();
  if(!SCOPE.test(scope))throw Error('Invalid Keyword Scope');
  const write=['analyze','reset','saveItem','deleteItem','setClassShare'].includes(operation);
  const lease=write?editorTransactionLease():null;
  assertEditorTransactionLease(lease);
  assertSignal(options?.signal);
  const attemptId=operation==='analyze'?crypto.randomUUID():'';
  const requestArgs=attemptId?{...args,attemptId}:args;
  const action=operation==='analyze'?runKeywordAnalysisBatch:
    WRITES[operation]||READS[operation];
  let result;
  try{
    result=await action(requestArgs);
    if(result?.__keywordError){
      const failure=new Error(result.__keywordError.message||'Keyword analysis rejected');
      failure.status=Number(result.__keywordError.status)||400;
      throw failure;
    }
  }catch(error){
    if(isEditorTransactionCancelled(lease))assertEditorTransactionLease(lease);
    if(operation!=='analyze'||isBusinessRefusal(error))throw error;
    // The action may have committed a checkpoint before a transport failure.
    // One receipt read confirms that exact step without replaying it.
    const receipt=await queryKeywordAnalysisCompletion({scopeId:scope,
      classUid:String(args.classUid||''),attemptId}).catch(()=>null);
    assertEditorTransactionLease(lease);
    if(receipt?.completed&&receipt.result){
      options?.onProgress?.({phase:'completed',
        completed:receipt.result.analyzedDocuments,
        total:receipt.result.analyzedDocuments,percent:100,
        label:'資料庫已確認分析完成'});
      return committed(operation,scope,receipt.result);
    }
    if(receipt?.resumable&&receipt.attemptMatched)
      return {incomplete:true,finalizePending:true,total:receipt.scanned,
        completed:receipt.scanned,parsed:receipt.parsed};
    throw new KeywordAnalysisUnconfirmedError({scopeId:scope,
      classUid:String(args.classUid||''),attemptId});
  }
  assertEditorTransactionLease(lease);
  assertSignal(options?.signal);
  if(operation==='analyze'&&result?.incomplete){
    options?.onProgress?.({phase:result.finalizePending?'finalizing':'checkpoint',
      total:result.total,completed:result.completed,parsed:result.parsed,
      percent:result.total?Math.min(99,Math.round(result.completed/result.total*100)):0,
      label:result.finalizePending?'尾段已存檔，正在完成統計':'本批分析已存檔，正在繼續'});
  }
  return committed(operation,scope,result);
}
