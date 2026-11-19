import {MAX_MULTIPARA} from '../query/bounded-parallel.mjs';

// Reserve approximately 20% of this browser's bounded public-read capacity
// for transient demand. This is NOT 80% of the database provider's pool:
// other tabs, Cloudflare isolates and database clients have separate loads.
export const RESOURCE_UTILIZATION_TARGET=0.8;
export const MAX_PUBLIC_READS=3; // warm starting point, not a fixed quota
export const PUBLIC_READ_CEILING=Math.max(1,
  Math.floor(MAX_MULTIPARA*RESOURCE_UTILIZATION_TARGET));
const BUSY_STATUS=new Set([408,425,429,500,502,503,504]);
const cancelled=()=>{
  const error=new Error('Request cancelled');
  error.name='AbortError';
  return error;
};

// Demand-driven AIMD admission using real read outcomes; no polling, probes,
// provider-specific SQL, background timer, or new dependency.
export function createPublicReadBudget(max=PUBLIC_READ_CEILING,{
  initial=Math.min(MAX_PUBLIC_READS,max),now=()=>Date.now()
}={}){
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid public read concurrency');
  max=Math.min(max,MAX_MULTIPARA);
  if(!Number.isSafeInteger(initial)||initial<1)
    throw new RangeError('Invalid initial public read concurrency');
  let limit=Math.min(initial,max),active=0,meanMs=0,successes=0,cooldownUntil=0;
  const waiting=[];
  const drain=()=>{
    while(active<limit&&waiting.length){
      const next=waiting.shift();
      active++;
      next.resume();
    }
  };
  const acquire=signal=>{
    if(signal?.aborted)return Promise.reject(cancelled());
    if(active<limit&&!waiting.length){active++;return Promise.resolve();}
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{
        const index=waiting.indexOf(entry);
        if(index<0)return;
        waiting.splice(index,1);
        signal?.removeEventListener('abort',onAbort);
        reject(cancelled());
      };
      const entry={resume:()=>{
        signal?.removeEventListener('abort',onAbort);
        resolve();
      }};
      waiting.push(entry);
      signal?.addEventListener('abort',onAbort,{once:true});
      if(signal?.aborted)onAbort();
    });
  };
  const observe=(duration,response,error)=>{
    // User navigation/cancellation is not evidence of an overloaded server.
    if(error?.name==='AbortError')return;
    const elapsed=Math.max(0,Number(duration)||0);
    const previous=meanMs;
    meanMs=previous?previous*0.8+elapsed*0.2:elapsed;
    const status=Number(response?.status??error?.status??0);
    const congested=BUSY_STATUS.has(status)||error?.name==='TimeoutError';
    const slow=Boolean(previous)&&waiting.length>0&&
      elapsed>Math.max(2000,previous*2);
    if(congested||slow){
      limit=Math.max(1,Math.floor(limit*0.75));
      cooldownUntil=now()+Math.max(2000,Math.min(12000,elapsed*2));
      successes=0;
    }else if(waiting.length&&now()>=cooldownUntil&&
      elapsed<=Math.max(3000,previous*1.5)){
      successes++;
      // Incrementally open only when real demand exists and reads stay healthy.
      if(successes>=Math.max(3,limit*2)){
        limit=Math.min(max,limit+1);
        successes=0;
      }
    }else successes=0;
  };
  const withReadBudget=async(request,signal=null)=>{
    if(typeof request!=='function')throw new TypeError('A read task is required');
    await acquire(signal);
    const started=now();
    try{
      const response=await request();
      observe(now()-started,response,null);
      return response;
    }catch(error){
      observe(now()-started,null,error);
      throw error;
    }finally{
      active--;
      drain();
    }
  };
  // Local observed demand only; never misrepresent this as the provider pool.
  withReadBudget.snapshot=()=>Object.freeze({
    active,waiting:waiting.length,limit,ceiling:max,
    observedLatencyMs:Math.round(meanMs),resourceTarget:RESOURCE_UTILIZATION_TARGET
  });
  return withReadBudget;
}
export const withPublicReadBudget=createPublicReadBudget();
