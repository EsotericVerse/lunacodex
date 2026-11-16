// Execute independent reads in a small fixed-width pool, preserving input order.
// This caps a single JS runtime, not all browser tabs or Edge isolates.
export const MAX_MULTIPARA=10;
// Stop scheduling new work after an error and settle the already started lanes.
export async function mapBounded(items,limit,worker){
  if(!Number.isSafeInteger(limit)||limit<1)throw new RangeError('Invalid concurrency limit');
  const input=Array.from(items||[]),results=new Array(input.length);
  let next=0,failed=false,failure;
  const lane=async()=>{
    while(!failed){
      const index=next++;
      if(index>=input.length)return;
      try{results[index]=await worker(input[index],index);}
      catch(error){failed=true;failure=error;return;}
    }
  };
  await Promise.all(Array.from({length:Math.min(limit,MAX_MULTIPARA,input.length)},lane));
  if(failed)throw failure;
  return results;
}
