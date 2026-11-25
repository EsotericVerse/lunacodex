import {mapBounded} from './bounded-parallel.mjs';
import {planSqlChunks,SQL_WORKLOAD_POLICY}
  from '../../../modules/loc/dialect/sql-workload-policy.mjs';

function aborted(signal){
  if(signal?.aborted){
    if(signal.reason)throw signal.reason;
    const error=new Error('Aborted');
    error.name='AbortError';
    throw error;
  }
}
let activeWork=0;
const waitingWork=[];
function grantWork(waiter){
  if(waiter.signal&&waiter.onAbort)
    waiter.signal.removeEventListener('abort',waiter.onAbort);
  activeWork++;
  let released=false;
  waiter.resolve(()=>{
    if(released)return;
    released=true;
    activeWork--;
    while(waitingWork.length){
      const next=waitingWork.shift();
      if(next.signal?.aborted){
        next.reject(next.signal.reason||Object.assign(new Error('Aborted'),
          {name:'AbortError'}));
        continue;
      }
      grantWork(next);
      break;
    }
  });
}
async function withAdaptiveSqlLane(task,signal){
  aborted(signal);
  let release;
  if(activeWork<SQL_WORKLOAD_POLICY.maxParallelChunks){
    activeWork++;
    let done=false;
    release=()=>{
      if(done)return;
      done=true;
      activeWork--;
      while(waitingWork.length){
        const next=waitingWork.shift();
        if(next.signal?.aborted){
          next.reject(next.signal.reason||Object.assign(new Error('Aborted'),
            {name:'AbortError'}));
          continue;
        }
        grantWork(next);
        break;
      }
    };
  }else{
    release=await new Promise((resolve,reject)=>{
      const waiter={resolve,reject,signal,onAbort:null};
      if(signal){
        waiter.onAbort=()=>{
          const index=waitingWork.indexOf(waiter);
          if(index>=0)waitingWork.splice(index,1);
          reject(signal.reason||Object.assign(new Error('Aborted'),
            {name:'AbortError'}));
        };
        signal.addEventListener('abort',waiter.onAbort,{once:true});
      }
      waitingWork.push(waiter);
      if(signal?.aborted)waiter.onAbort?.();
    });
  }
  try{aborted(signal);return await task();}
  finally{release();}
}

/**
 * Count one already-scoped workload, fetch at most 10,000 rows per page, and
 * let callers reduce each page before its raw rows are released. Ordering is
 * supplied by each feature query; use its indexed `createtime` where present.
 * Small direct lookups should stay direct and should not call this helper.
 */
export async function readAdaptiveSqlPages({
  countRows,fetchPage,consumePage,signal=null,
  chunkRows=SQL_WORKLOAD_POLICY.chunkRows,
  maxParallel=SQL_WORKLOAD_POLICY.maxParallelChunks
}){
  if(typeof countRows!=='function'||typeof fetchPage!=='function'||
    typeof consumePage!=='function')
    throw new TypeError('Adaptive SQL read requires count, page and reducer functions');
  aborted(signal);
  const total=Number(await withAdaptiveSqlLane(countRows,signal));
  if(!Number.isSafeInteger(total)||total<0)
    throw new Error('SQL workload COUNT returned an invalid row count');
  const plan=planSqlChunks(total,{chunkRows,maxParallel});
  if(!plan.chunks.length)return total;
  const run=async({offset,limit},index)=>{
    aborted(signal);
    const rows=await withAdaptiveSqlLane(()=>
      fetchPage({offset,limit,orderBy:'createtime'}),signal);
    if(!Array.isArray(rows)||rows.length>limit)
      throw new Error('SQL workload page exceeded its bounded row count');
    aborted(signal);
    await consumePage(rows,{offset,index,totalRows:total});
    return rows.length;
  };
  if(plan.concurrency<=1){
    for(let index=0;index<plan.chunks.length;index++)
      await run(plan.chunks[index],index);
  }else{
    await mapBounded(plan.chunks,run,{signal});
  }
  return total;
}
