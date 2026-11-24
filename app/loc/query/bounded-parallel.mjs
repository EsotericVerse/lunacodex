// Execute independent reads in a small fixed-width pool, preserving input order.
// This caps a single JS runtime, not all browser tabs or Edge isolates.
export const MAX_MULTIPARA=10;
// Stop scheduling new work after an error and settle the already started lanes.
export async function mapBounded(items,limit,worker,{onCheckpoint=null,signal=null,slowMs=650}={}){
  if(!Number.isSafeInteger(limit)||limit<1)throw new RangeError('Invalid concurrency limit');
  const input=Array.from(items||[]),results=new Array(input.length);
  let next=0,failed=false,failure;
  // Only existing independent units count as progress. Fast or single-unit
  // reads never create an intermediate presentation snapshot.
  let completed=0,shown=false,finished=false,timer=null;
  const started=Date.now(),threshold=Math.ceil(input.length*.4);
  const publish=()=>{
    if(finished||failed||shown||signal?.aborted||completed<threshold||completed>=input.length)return;
    shown=true;
    onCheckpoint?.(results.filter((_,index)=>Object.hasOwn(results,index)),{completed,total:input.length});
  };
  const checkpoint=()=>{
    if(!onCheckpoint||shown||finished||failed||signal?.aborted||completed<threshold||completed>=input.length)return;
    if(Date.now()-started>=slowMs){publish();return;}
    if(timer===null)timer=setTimeout(()=>{timer=null;publish();},Math.max(0,slowMs-(Date.now()-started)));
  };
  const lane=async()=>{
    while(!failed){
      const index=next++;
      if(index>=input.length)return;
      try{results[index]=await worker(input[index],index);completed++;checkpoint();}
      catch(error){failed=true;failure=error;return;}
    }
  };
  try{await Promise.all(Array.from({length:Math.min(limit,MAX_MULTIPARA,input.length)},lane));}
  finally{finished=true;if(timer!==null)clearTimeout(timer);}
  if(failed)throw failure;
  return results;
}
