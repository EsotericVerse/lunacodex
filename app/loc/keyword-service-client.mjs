// Fixed-purpose Keyword operations on the existing LOC Pages application.
// Better Auth Session and api.manage ZModel rights are verified once by the
// destination API, then again only inside the protected write transaction.
// Do not preflight /api/loc-permissions and duplicate both network checks.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;

export async function keywordService(operation,args={},options={}){
  if(!['analyze','analyzeStatus','reset','classes','catalog','summary','stats','suggest',
      'anchorSearch','saveItem','deleteItem','syncLibrary'].includes(operation))
    throw Error('Unsupported Keyword operation');
  if(!args||typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Keyword request');
  const scope=String(args.scopeId||'');
  if(!SCOPE.test(scope))
    throw Error('Invalid Keyword Scope');
  const write=['analyze','reset','saveItem','deleteItem','syncLibrary'].includes(operation);
  const readSignal=options?.signal||null;
  const stream=operation==='analyze'&&typeof options?.onProgress==='function';
  // A completion receipt is committed with the Pattern transaction, so a
  // severed HTTP stream can be checked without rerunning authorized writes.
  const attemptId=stream?crypto.randomUUID():null;
  const requestArgs=attemptId?{...args,attemptId}:args;
  const response=await fetch('/api/keywords',{
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
  if(!response.ok){
    const payload=await response.json().catch(()=>null);
    throw Error(payload?.error||'詞級資料讀取失敗（HTTP '+response.status+'）');
  }
  if(stream){
    if(!response.body)throw Error('關鍵詞分析進度串流無法讀取');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let pending='',complete=false,result,readFailure=null;
    const consume=line=>{
      if(!line.trim())return;
      let event;
      try{event=JSON.parse(line);}catch{throw Error('關鍵詞分析進度格式無效');}
      if(event?.kind==='progress')options.onProgress(event.data);
      else if(event?.kind==='heartbeat')return;
      else if(event?.kind==='result'){complete=true;result=event.data;}
      else if(event?.kind==='error')
        throw Error(event.data?.error||'關鍵詞分析失敗（HTTP '+(event.data?.status||503)+'）');
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
        return receipt.result;
      }
      if(readFailure)throw readFailure;
      throw Error('關鍵詞分析連線中斷，資料庫尚未確認本次完成；請先核對完成狀態，不要直接重複執行');
    }
    return result;
  }
  const payload=await response.json().catch(()=>null);
  return payload?.data;
}
