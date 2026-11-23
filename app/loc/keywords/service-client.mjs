// Fixed-purpose Keyword operations on the existing LOC Pages application.
// Better Auth Session and api.manage ZModel rights are verified once by the
// destination API, then again only inside the protected write transaction.
// Do not preflight /api/loc-permissions and duplicate both network checks.
import {invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

// A missing terminal frame does not prove either success or failure. Keep the
// exact operation identity so an operator can read its committed SQL receipt
// again without replaying the non-idempotent analysis.
export class KeywordAnalysisUnconfirmedError extends Error {
  constructor({scopeId,classUid,attemptId}){
    super('關鍵詞分析連線中斷，本次結果尚未確認。請使用「核對本次分析」查詢原始執行紀錄，勿直接重跑或清空。');
    this.name='KeywordAnalysisUnconfirmedError';
    this.scopeId=scopeId;
    this.classUid=classUid;
    this.attemptId=attemptId;
  }
}


export async function keywordService(operation,args={},options={}){
  if(!['analyze','analyzeStatus','reset','classes','catalog','summary','stats','suggest',
      'anchorSearch','saveItem','deleteItem','setClassShare','workspace'].includes(operation))
    throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'');
  if(!SCOPE.test(scope))
    throw Error('Invalid Keyword Scope');
  const write=['analyze','reset','saveItem','deleteItem','setClassShare'].includes(operation);
  const committed=result=>{
    // /api/keywords writes Item/Group count snapshots directly.
    // Incomplete checkpoints never contain article UID postings.
    const confirmedWrite=write&&!(operation==='analyze'&&result?.incomplete===true);
    if(confirmedWrite||(operation==='analyzeStatus'&&result?.completed))
      invalidateScopedReadCache('silver.'+scope+'_anchor');
    return result;
  };
  const readSignal=options?.signal||null;
  const stream=operation==='analyze'&&typeof options?.onProgress==='function';
  // A completion receipt is committed with the Item count transaction, so a
  // severed HTTP stream can be checked without rerunning authorized writes.
  const attemptId=stream?crypto.randomUUID():null;
  const requestArgs=attemptId?{...args,attemptId}:args;
  let response;
  try{
    response=await fetch('/api/keywords',{
    method:'POST',credentials:'include',cache:'no-store',
    headers:{'content-type':'application/json',
      ...(stream?{accept:'application/x-ndjson'}:{})},
    body:JSON.stringify({operation,args:requestArgs}),
    // Caller-supplied cancellation is for read-only tab/era transitions.
    // It must never abort an authorized keyword write in progress.
    signal:!write&&readSignal
      ?AbortSignal.any([readSignal,AbortSignal.timeout(25000)])
      // The old 180-second client timer could terminate a long authorized
      // analysis while the server was still writing. Live stream frames
      // now establish liveness instead of a fixed whole-request cutoff.
      :operation==='analyze'?undefined:AbortSignal.timeout(write?180000:25000)
    });
  }catch(error){
    // The server may have committed after a lost HTTP connection. Preserve
    // the attempt so the user can check the SQL receipt; never replay a write.
    if(stream)throw new KeywordAnalysisUnconfirmedError({
      scopeId:scope,classUid:String(args.classUid||''),attemptId
    });
    throw error;
  }
  if(!response.ok){
    const payload=await response.json().catch(()=>null);
    if(stream&&response.status>=500)
      throw new KeywordAnalysisUnconfirmedError({
        scopeId:scope,classUid:String(args.classUid||''),attemptId
      });
    const failure=Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
    failure.status=response.status;
    failure.code=String(payload?.code||'');
    throw failure;
  }
  if(stream){
    if(!response.body)throw new KeywordAnalysisUnconfirmedError({
      scopeId:scope,classUid:String(args.classUid||''),attemptId
    });
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let pending='',complete=false,result,readFailure=null;
    const consume=line=>{
      if(!line.trim())return;
      let event;
      try{event=JSON.parse(line);}catch{throw Error('關鍵詞分析進度格式無效');}
      if(event?.kind==='progress')options.onProgress(event.data);
      else if(event?.kind==='heartbeat')return;
      else if(event?.kind==='result'){complete=true;result=event.data;}
      else if(event?.kind==='error'){
        const failure=Error(event.data?.error||'關鍵詞分析失敗（HTTP '+(event.data?.status||503)+'）');
        failure.keywordServerError=true;
        failure.status=Number(event.data?.status)||503;
        throw failure;
      }
      else throw Error('未知的關鍵詞分析進度事件');
    };
    try{
      for(;;){
        const {done,value}=await reader.read();
        pending+=decoder.decode(value||new Uint8Array(),{stream:!done});
        for(let newline;(newline=pending.indexOf('\n'))>=0;){
          consume(pending.slice(0,newline));pending=pending.slice(newline+1);
        }
        if(done)break;
      }
      if(pending.trim())consume(pending);
    }catch(error){readFailure=error;}
    finally{reader.releaseLock();}
    if(!complete){
      // ONE read-only confirmation request; no polling and no automatic
      // retry of a non-idempotent Keyword analysis transaction.
      const receipt=await keywordService('analyzeStatus',{
        scopeId:scope,classUid:String(args.classUid||''),attemptId
      }).catch(()=>null);
      if(receipt?.completed&&receipt.result){
        options.onProgress({phase:'completed',completed:receipt.result.analyzedDocuments,
          total:receipt.result.analyzedDocuments,percent:100,
          label:'資料庫已確認分析完成'});
        return committed(receipt.result);
      }
      // The exact tail request committed only its counters and returned:
      // no final SQL transaction was started. Its matching receipt makes
      // a new FINALIZE-only request safe without rescanning any article.
      if(receipt?.resumable&&receipt.attemptMatched){
        options.onProgress({phase:'finalizing',completed:receipt.scanned,
          total:receipt.scanned,percent:99,
          label:'最後一段已存檔，正在接續最終統計'});
        return {incomplete:true,finalizePending:true,
          total:receipt.scanned,completed:receipt.scanned,
          parsed:receipt.parsed};
      }
      // Explicit server failures are real errors. Unexpected EOF/network
      // errors remain *unconfirmed*, so preserve the attempt for user-driven
      // status checks rather than discarding its identity.
      // Only an explicit, non-transient business refusal is terminal.
      // A server/transport 5xx can race with a committed transaction.
      if(readFailure?.keywordServerError&&readFailure.status<500)throw readFailure;
      throw new KeywordAnalysisUnconfirmedError({
        scopeId:scope,classUid:String(args.classUid||''),attemptId
      });
    }
    return committed(result);
  }
  const payload=await response.json().catch(()=>null);
  return committed(payload?.data);
}
