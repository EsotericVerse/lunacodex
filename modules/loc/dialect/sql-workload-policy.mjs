// Shared SQL workload limits for every explicitly selected dialect. The
// chunk target limits each returned batch; the lane cap bounds simultaneous
// work without turning a large scan into either thousands of tiny requests
// or one unbounded result set.
export const SQL_WORKLOAD_POLICY=Object.freeze({
  chunkRows:10000,
  maxParallelChunks:4,
  nodePoolMax:12,
  workerRuntimeMaxConnections:8,
  workerRequestMaxConnections:4
});

export function planSqlChunks(totalRows,{
  chunkRows=SQL_WORKLOAD_POLICY.chunkRows,
  maxParallel=SQL_WORKLOAD_POLICY.maxParallelChunks
}={}){
  const total=Number(totalRows);
  if(!Number.isSafeInteger(total)||total<0||
    !Number.isSafeInteger(chunkRows)||chunkRows<1||
    !Number.isSafeInteger(maxParallel)||maxParallel<1)
    throw new TypeError('Invalid SQL workload plan');
  const chunks=[];
  for(let offset=0;offset<total;offset+=chunkRows)
    chunks.push({offset,limit:Math.min(chunkRows,total-offset)});
  return {totalRows:total,chunks,
    concurrency:Math.min(chunks.length,maxParallel)};
}
