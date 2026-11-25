// Shared SQL limits for explicitly selected dialects. `chunkRows` applies to
// raw row pages only; it never caps COUNT(*) or date-grouped aggregates.
export const SQL_WORKLOAD_POLICY=Object.freeze({
  chunkRows:10000,
  // Per-operation fan-out. There is no process-global query semaphore.
  maxParallelChunks:4,
  nodePoolMax:12,
  // One request-owned SQL client; Hyperdrive manages the shared origin pool
  // across requests, while separate Worker requests remain independent.
  workerRequestMaxConnections:1
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
