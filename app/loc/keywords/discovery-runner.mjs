'use client';

import {dbAuthRelation} from '../db/db-client.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {KeywordDiscoveryQueue} from './discovery-queue.mjs';
import {classSkipArticleWords} from './class-exceptions.mjs';
import * as z from 'zod';

// The owner's explicit action starts the only scan. Never run during render,
// ordinary Search, Culture navigation or the existing Keyword reanalysis.
// Single bounded FIFO: SQL page size adapts to payload bytes. The Worker
// receives bounded slices, and only one next-page fetch may be in flight.
const WORKER_PROGRESS=z.looseObject({
  type:z.literal('progress'),
  read:z.number().int().nonnegative(),
  withContent:z.number().int().nonnegative()
});
const ARTICLE_COLUMNS=galaxyReadColumns('GalaxyUidRead')
  .filter(column=>['uid','title','content','createtime','date'].includes(column));
const aborted=()=>Object.assign(new Error('已取消關鍵詞建議掃描'),{name:'AbortError'});
// A scan reads dozens of pages in sequence; one transient network blip must
// not discard everything already read. Only the caller's own cancellation
// (tagged AbortError by `aborted()` above, always rechecked before this
// throws) skips retry. A fetch timeout surfaces as TimeoutError, not
// AbortError, so it is retried like any other transient failure.
const RETRYABLE_STATUS=new Set([408,425,429,500,502,503,504]);
export const isRetryableReadError=error=>{
  if(error?.name==='AbortError')return false;
  const status=Number(error?.status);
  if(Number.isFinite(status))return RETRYABLE_STATUS.has(status);
  return true; // No HTTP status: a network-level or timeout failure.
};
export async function readPageWithRetry(run,signal,{attempts=4,baseDelayMs=500,onRetry}={}){
  for(let attempt=0;;attempt++){
    try{return await run();}
    catch(error){
      if(signal?.aborted)throw aborted();
      if(!isRetryableReadError(error)||attempt>=attempts-1)throw error;
      onRetry?.(error,attempt+1);
      await new Promise(resolve=>setTimeout(resolve,baseDelayMs*2**attempt));
      if(signal?.aborted)throw aborted();
    }
  }
}

export async function suggestNewKeywords({galaxy,existingRows=[],classUid='',onProgress=()=>{},signal}={}){
  if(!/^silver\.[a-z][a-z0-9_]*_galaxy$/.test(String(galaxy||'')))
    throw new Error('Galaxy Scope 資料表無效');
  if(signal?.aborted)throw aborted();
  const worker=new Worker(new URL('./discovery-worker.mjs',import.meta.url),{type:'module'});
  const readController=new AbortController();
  const readSignal=signal?AbortSignal.any([signal,readController.signal]):readController.signal;
  const send=data=>new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(aborted());return;}
    const onAbort=()=>reject(aborted());
    const cleanup=()=>{
      signal?.removeEventListener('abort',onAbort);
      worker.onmessage=null;
      worker.onerror=null;
    };
    worker.onmessage=event=>{
      cleanup();
      const message=event.data||{};
      if(message.type==='error')reject(new Error(message.error||'關鍵詞分析失敗'));
      else resolve(message);
    };
    worker.onerror=event=>{
      cleanup();
      reject(new Error(event?.message||'無法執行關鍵詞背景分析'));
    };
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.postMessage(data);
  });
  try{
    const classRow=existingRows.find(row=>row.type==='class'&&row.uid===classUid);
    const exceptionWords=classRow?classSkipArticleWords(classRow.attr||{}):[];
    await send({type:'start',exceptionWords,existingRows:existingRows.map(row=>({
      type:row.type,name:row.name,lists:row.type==='item'?row.lists:[]
    }))});
    let countQuery=dbAuthRelation(galaxy).select('uid',{count:'exact',head:true});
    if(typeof countQuery.abortSignal==='function')countQuery=countQuery.abortSignal(readSignal);
    const {count,error:countError}=await countQuery;
    if(signal?.aborted)throw aborted();
    if(countError||count===null||count===undefined||(count==null||!Number.isSafeInteger(Number(count))))
      throw new Error(countError?.message||'無法取得完整文章筆數');
    const total=Number(count);
    // Standard (date, uid) keyset paging retrieves every article once without
    // a second read of the same boundary date or growing OFFSET scans.
    let completed=0;
    const seen=new Set();
    const queue=new KeywordDiscoveryQueue();
    // Promise rejections must be observed immediately, including cancellation.
    const settled=promise=>promise.then(value=>({value}),error=>({error}));
    const readPage=(build,requested)=>{
      // A timed-out or overloaded page must not be retried at the same size.
      // Preserve the same cursor and projection while reducing only this
      // attempt's transport window. The next successful page still informs
      // the ordinary byte-based adaptive queue; no rows are skipped.
      let effective=requested;
      return readPageWithRetry(async()=>{
        let query=build(dbAuthRelation(galaxy),effective);
        if(typeof query.abortSignal==='function')query=query.abortSignal(readSignal);
        const reply=await query;
        if(readSignal.aborted)throw aborted();
        if(reply.error)throw reply.error;
        return {...reply,requested:effective};
      },readSignal,{onRetry:()=>{
        effective=Math.max(1,Math.floor(effective*0.65));
      }});
    };
    const consumePage=async (page,requested,nextPage)=>{
      queue.accept(page,requested);
      let lookahead=null;
      while(queue.remaining){
        if(signal?.aborted)throw aborted();
        const batch=queue.take();
        for(const row of batch){
          if(typeof row.uid!=='string'||seen.has(row.uid))
            throw new Error('文章掃描出現重複或無效 UID，未覆寫先前暫存');
          seen.add(row.uid);
        }
        // Refill the SINGLE queue when it is almost drained, never when
        // already full. At most one network lookahead runs during Worker CPU.
        if(!lookahead&&queue.nearEmpty&&typeof nextPage==='function')
          lookahead=settled(nextPage(queue.readLimit));
        const reply=await send({type:'batch',rows:batch});
        if(!WORKER_PROGRESS.safeParse(reply).success)
          throw new Error('關鍵詞背景分析回應異常');
        completed+=batch.length;
        onProgress({completed,total,withContent:reply.withContent,
          lanes:1,batchSize:requested,nextPageSize:queue.readLimit});
      }
      return lookahead;
    };
    onProgress({completed:0,total,lanes:1});
    // Drivers may serialize SQL DATE as midnight UTC / Taipei ISO timestamps.
    // Normalize the calendar day before validating or advancing the cursor.
    // A DATE serialized as Taipei midnight (16:00Z) needs formatting.
    // Reuse one formatter for all rows instead of constructing it per article.
    const taipeiDayFormat=new Intl.DateTimeFormat('sv-SE',{
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
    });
    const normalizeDay=value=>{
      if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
      const raw=value instanceof Date?value.toISOString():value;
      if(typeof raw!=='string')return null;
      const match=raw.match(/^(\d{4}-\d{2}-\d{2})T(00:00:00(?:\.0+)?Z|00:00:00(?:\.0+)?\+00:00|00:00:00(?:\.0+)?\+08:00|16:00:00(?:\.0+)?Z)$/);
      if(!match)return null;
      if(raw.includes('16:00:00')){
        const instant=new Date(raw);
        return Number.isFinite(instant.getTime())?taipeiDayFormat.format(instant):null;
      }
      return match[1];
    };
    // One ordered keyset read per page: the final date of a page no longer
    // needs to be downloaded again through a separate same-day OFFSET scan.
    // SQL compares DATE and UID using its own ordering/collation.
    const quoted=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
    // A single lookahead read overlaps network with Worker CPU without
    // increasing database concurrency, storing all rows, or skipping pages.
    // Settle rejections immediately so Worker failures cannot leave an
    // unhandled pending request; finally aborts the active read.
    const datedPage=(afterDate,afterUid,limit)=>readPage((relation,pageRows)=>{
      let query=relation.select(ARTICLE_COLUMNS).not('date','is',null)
        .order('date',{ascending:true}).order('uid',{ascending:true})
        .limit(pageRows);
      if(afterDate!==null){
        // The OR cursor alone caused Postgres to scan/filter all earlier dates
        // (43k rows on a late 2026 page). This redundant AND lower bound is
        // logically implied by the cursor, but uses the existing DATE index.
        // Keep the strict date/UID OR so no rows are skipped or duplicated.
        query=query.gte('date',afterDate).or(
          'date.gt.'+afterDate+',and(date.eq.'+afterDate+
          ',uid.gt.'+quoted(afterUid)+')');
      }
      return query;
    },limit);
    let previousDate=null;
    let datedPending=settled(datedPage(null,null,queue.readLimit));
    for(;;){
      if(signal?.aborted)throw aborted();
      const completedRead=await datedPending;
      if(completedRead.error)throw completedRead.error;
      const {data,requested}=completedRead.value;
      const page=Array.isArray(data)?data:[];
      if(!page.length)break;
      const normalized=page.map(row=>({...row,date:normalizeDay(row?.date)}));
      if(normalized.some((row,index)=>!row.date||typeof row.uid!=='string'||
        !row.uid||(previousDate!==null&&row.date<previousDate)||
        (index>0&&row.date<normalized[index-1].date)))
        throw new Error('Galaxy 日期／UID 游標資料不完整，未覆寫先前暫存');
      const last=normalized.at(-1);
      datedPending=await consumePage(normalized,requested,
        limit=>datedPage(last.date,last.uid,limit))||
        settled(datedPage(last.date,last.uid,queue.readLimit));
      previousDate=last.date;
    }
    // Undated rows also use a bounded UID keyset instead of deep OFFSET.
    // Both scans are complete even when the transport returns a short page.
    const undatedPage=(afterUid,limit)=>readPage((relation,pageRows)=>{
      let query=relation.select(ARTICLE_COLUMNS)
        .is('date',null).order('uid',{ascending:true}).limit(pageRows);
      if(afterUid!==null)query=query.gt('uid',afterUid);
      return query;
    },limit);
    let undatedPending=settled(undatedPage(null,queue.readLimit));
    for(;;){
      if(signal?.aborted)throw aborted();
      const completedRead=await undatedPending;
      if(completedRead.error)throw completedRead.error;
      const {data,requested}=completedRead.value;
      const part=Array.isArray(data)?data:[];
      if(!part.length)break;
      if(part.some(row=>row?.date!=null||typeof row.uid!=='string'||!row.uid))
        throw new Error('Galaxy 未定日期游標資料不完整，未覆寫先前暫存');
      undatedPending=await consumePage(part,requested,
        limit=>undatedPage(part.at(-1).uid,limit))||
        settled(undatedPage(part.at(-1).uid,queue.readLimit));
    }
    if(completed!==total)throw new Error('文章數量在掃描期間變動，未覆寫先前暫存');
    const done=await send({type:'finish'});
    if(done.type!=='finished'||!done.result)throw new Error('新關鍵詞結果無效');
    return done.result;
  }finally{
    readController.abort();
    worker.terminate();
  }
}
