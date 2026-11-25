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
  const total=Number(await countRows());
  if(!Number.isSafeInteger(total)||total<0)
    throw new Error('SQL workload COUNT returned an invalid row count');
  const plan=planSqlChunks(total,{chunkRows,maxParallel});
  if(!plan.chunks.length)return total;
  const run=async({offset,limit},index)=>{
    aborted(signal);
    const rows=await fetchPage({offset,limit,orderBy:'createtime'});
    if(!Array.isArray(rows)||rows.length>limit)
      throw new Error('SQL workload page exceeded its bounded row count');
    aborted(signal);
    await consumePage(rows,{offset,index,totalRows:total});
    return rows.length;
  };
  // Bound fan-out per read operation. Never share a module-level semaphore
  // between unrelated Worker requests: a stuck feature must not queue others.
  await mapBounded(plan.chunks,plan.concurrency,run,{signal});
  return total;
}
