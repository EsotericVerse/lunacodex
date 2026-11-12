'use client';

import {dbAuthRelation} from './db-client.mjs';

// The owner's explicit action starts the only scan. Never run during render,
// ordinary Search, Culture navigation or the existing Keyword reanalysis.
// Transport batches do not cap the total number of scanned articles.
const PAGE_SIZE=1000;
const ARTICLE_COLUMNS='uid,content,createtime,date';
const aborted=()=>Object.assign(new Error('已取消關鍵詞建議掃描'),{name:'AbortError'});

export async function suggestNewKeywords({galaxy,existingRows=[],onProgress=()=>{},signal}={}){
  if(!/^silver\.[a-z][a-z0-9_]*_galaxy$/.test(String(galaxy||'')))
    throw new Error('Galaxy Scope 資料表無效');
  if(signal?.aborted)throw aborted();
  const worker=new Worker(new URL('./keyword-discovery-worker.mjs',import.meta.url),{type:'module'});
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
    await send({type:'start',existingRows:existingRows.map(row=>({
      type:row.type,name:row.name,lists:row.type==='item'?row.lists:[]
    }))});
    let countQuery=dbAuthRelation(galaxy).select('uid',{count:'exact',head:true});
    if(signal&&typeof countQuery.abortSignal==='function')countQuery=countQuery.abortSignal(signal);
    const {count,error:countError}=await countQuery;
    if(signal?.aborted)throw aborted();
    if(countError||count===null||count===undefined||(count==null||!Number.isSafeInteger(Number(count))))
      throw new Error(countError?.message||'無法取得完整文章筆數');
    const total=Number(count);
    // Standard (date, uid) keyset paging retrieves every article once without
    // a second read of the same boundary date or growing OFFSET scans.
    let completed=0;
    const seen=new Set();
    const readPage=async build=>{
      let query=build(dbAuthRelation(galaxy));
      if(signal&&typeof query.abortSignal==='function')query=query.abortSignal(signal);
      const reply=await query;
      if(signal?.aborted)throw aborted();
      if(reply.error)throw new Error(reply.error.message||'無法讀取文章內文');
      return reply;
    };
    const consumePage=async page=>{
      for(let index=0;index<page.length;index+=PAGE_SIZE){
        if(signal?.aborted)throw aborted();
        const batch=page.slice(index,index+PAGE_SIZE);
        for(const row of batch){
          if(typeof row.uid!=='string'||seen.has(row.uid))
            throw new Error('文章掃描出現重複或無效 UID，未覆寫先前暫存');
          seen.add(row.uid);
        }
        const reply=await send({type:'batch',rows:batch});
        if(reply.type!=='progress')throw new Error('關鍵詞背景分析回應異常');
        completed+=batch.length;
        onProgress({completed,total,withContent:reply.withContent,lanes:1});
      }
    };
    onProgress({completed:0,total,lanes:1});
    // Drivers may serialize SQL DATE as midnight UTC / Taipei ISO timestamps.
    // Normalize the calendar day before validating or advancing the cursor.
    const normalizeDay=value=>{
      if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
      const raw=value instanceof Date?value.toISOString():value;
      if(typeof raw!=='string')return null;
      const match=raw.match(/^(\d{4}-\d{2}-\d{2})T(00:00:00(?:\.0+)?Z|00:00:00(?:\.0+)?\+00:00|00:00:00(?:\.0+)?\+08:00|16:00:00(?:\.0+)?Z)$/);
      if(!match)return null;
      if(raw.includes('16:00:00')){
        const instant=new Date(raw);
        return Number.isFinite(instant.getTime())?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant):null;
      }
      return match[1];
    };
    // One ordered keyset read per page: the final date of a page no longer
    // needs to be downloaded again through a separate same-day OFFSET scan.
    // SQL compares DATE and UID using its own ordering/collation.
    const quoted=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
    let afterDate=null,afterUid=null;
    for(;;){
      if(signal?.aborted)throw aborted();
      const {data}=await readPage(relation=>{
        let query=relation.select(ARTICLE_COLUMNS).not('date','is',null)
          .order('date',{ascending:true}).order('uid',{ascending:true})
          .limit(PAGE_SIZE);
        if(afterDate!==null)query=query.or(
          'date.gt.'+afterDate+',and(date.eq.'+afterDate+
          ',uid.gt.'+quoted(afterUid)+')');
        return query;
      });
      const page=Array.isArray(data)?data:[];
      if(!page.length)break;
      const normalized=page.map(row=>({...row,date:normalizeDay(row?.date)}));
      if(normalized.some((row,index)=>!row.date||typeof row.uid!=='string'||
        !row.uid||(afterDate!==null&&row.date<afterDate)||
        (index>0&&row.date<normalized[index-1].date)))
        throw new Error('Galaxy 日期／UID 游標資料不完整，未覆寫先前暫存');
      await consumePage(normalized);
      afterDate=normalized.at(-1).date;
      afterUid=normalized.at(-1).uid;
    }
    // Undated rows also use a bounded UID keyset instead of deep OFFSET.
    // Both scans are complete even when the transport returns a short page.
    let afterUndatedUid=null;
    for(;;){
      if(signal?.aborted)throw aborted();
      const {data}=await readPage(relation=>{
        let query=relation.select(ARTICLE_COLUMNS)
          .is('date',null).order('uid',{ascending:true}).limit(PAGE_SIZE);
        if(afterUndatedUid!==null)query=query.gt('uid',afterUndatedUid);
        return query;
      });
      const part=Array.isArray(data)?data:[];
      if(!part.length)break;
      if(part.some(row=>row?.date!=null||typeof row.uid!=='string'||!row.uid))
        throw new Error('Galaxy 未定日期游標資料不完整，未覆寫先前暫存');
      await consumePage(part);
      afterUndatedUid=part.at(-1).uid;
    }
    if(completed!==total)throw new Error('文章數量在掃描期間變動，未覆寫先前暫存');
    const done=await send({type:'finish'});
    if(done.type!=='finished'||!done.result)throw new Error('新關鍵詞結果無效');
    return done.result;
  }finally{
    worker.terminate();
  }
}
