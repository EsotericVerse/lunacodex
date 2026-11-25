import {SQL_WORKLOAD_POLICY} from '../../../modules/loc/dialect/sql-workload-policy.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const DAY_MS=86400000;
function dayNumber(value){
  if(typeof value!=='string'||!DAY.test(value))
    throw new TypeError('Invalid SQL date range');
  const number=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(number)||new Date(number).toISOString().slice(0,10)!==value)
    throw new TypeError('Invalid SQL date range');
  return number;
}
const dayString=number=>new Date(number).toISOString().slice(0,10);

// Narrow aggregate ranges stay one database query. Wider ranges split on
// indexed calendar dates; each chunk returns grouped rows rather than raw
// article pages. The helper only schedules work and never receives SQL input.
export function planDateRangeAggregates(start,end,{
  thresholdDays=31,maxParallel=SQL_WORKLOAD_POLICY.maxParallelChunks
}={}){
  const first=dayNumber(start),last=dayNumber(end);
  if(last<first)throw new TypeError('Invalid SQL date range');
  if(!Number.isSafeInteger(thresholdDays)||thresholdDays<1||
    !Number.isSafeInteger(maxParallel)||maxParallel<1)
    throw new TypeError('Invalid date aggregate workload policy');
  const chunks=[];
  if((last-first)/DAY_MS+1<=thresholdDays){
    chunks.push({start,end});
  }else{
    let cursor=first;
    while(cursor<=last){
      const d=new Date(cursor);
      const monthEnd=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0);
      const boundary=Math.min(last,monthEnd);
      chunks.push({start:dayString(cursor),end:dayString(boundary)});
      cursor=boundary+DAY_MS;
    }
  }
  return {chunks,concurrency:Math.min(chunks.length,maxParallel)};
}

// Process in bounded waves. Promise.allSettled ensures a rejected chunk does
// not close the request-owned Kysely pool while sibling queries are still
// using it. After each successful wave, only the caller's reduced result is
// retained; raw grouped rows can be released before the next wave starts.
export async function readDateRangeAggregates({start,end,query,consume,
  signal=null,maxParallel=SQL_WORKLOAD_POLICY.maxParallelChunks}){
  if(typeof query!=='function'||typeof consume!=='function')
    throw new TypeError('Date aggregation requires query and consume functions');
  const plan=planDateRangeAggregates(start,end,{maxParallel});
  for(let offset=0;offset<plan.chunks.length;offset+=plan.concurrency){
    if(signal?.aborted)throw signal.reason||Object.assign(new Error('Aborted'),
      {name:'AbortError'});
    const wave=plan.chunks.slice(offset,offset+plan.concurrency);
    const settled=await Promise.allSettled(wave.map(chunk=>query(chunk)));
    const failed=settled.find(result=>result.status==='rejected');
    if(failed)throw failed.reason;
    if(signal?.aborted)throw signal.reason||Object.assign(new Error('Aborted'),
      {name:'AbortError'});
    for(let index=0;index<settled.length;index++)
      await consume(settled[index].value,wave[index]);
  }
  return plan.chunks.length;
}
