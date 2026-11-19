import {MAX_MULTIPARA} from '../query/bounded-parallel.mjs';

// This is only the browser's anonymous public-read admission, NEVER a quota
// for Auth, protected writes, another tab, or the database provider's pool.
// All public work borrows the same free slots; no work class owns a percentage.
export const MAX_PUBLIC_READS=3; // Existing warm start, not a reserved lane.
const TRANSIENT_STATUS=new Set([408,425,429,500,502,503,504]);
const PRIORITY=Object.freeze({aggregate:0,normal:1,interactive:2});
const cancelled=()=>Object.assign(new Error('Request cancelled'),{name:'AbortError'});

// Work class affects only WAITING order, not resources already running.
// If an older read has been passed repeatedly, it takes the next free slot.
// Use actual completion/failure feedback to adjust admission; no probes,
// SQL/vendor metrics, polling, timers, per-class quotas, or extra dependency.
export function createPublicReadBudget(max=MAX_MULTIPARA,{
  initial=Math.min(MAX_PUBLIC_READS,max),now=()=>Date.now()
}={}){
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid public read concurrency');
  max=Math.min(max,MAX_MULTIPARA);
  if(!Number.isSafeInteger(initial)||initial<1)
    throw new RangeError('Invalid initial public read concurrency');
  let capacity=Math.min(initial,max),active=0,served=0;
  let latencyMs=0,healthyWithDemand=0,holdUntil=0;
  const waiting=[];
  const takeNext=()=>{
    // Bound overtaking by completed admissions, independent of wall time.
    const oldest=waiting[0];
    if(served-oldest.since>=Math.max(3,capacity*2))return waiting.shift();
    let index=0;
    for(let i=1;i<waiting.length;i++){
      if(waiting[i].tier>waiting[index].tier)index=i;
    }
    return waiting.splice(index,1)[0];
  };
  const drain=()=>{
    while(active<capacity&&waiting.length){
      const next=takeNext();
      active++;served++;
      next.resume();
    }
  };
  const acquire=(signal,kind)=>{
    if(signal?.aborted)return Promise.reject(cancelled());
    if(active<capacity&&!waiting.length){active++;served++;return Promise.resolve();}
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{
        const index=waiting.indexOf(entry);
        if(index<0)return;
        waiting.splice(index,1);
        signal?.removeEventListener('abort',onAbort);
        reject(cancelled());
      };
      const entry={tier:PRIORITY[kind]??PRIORITY.normal,since:served,
        resume:()=>{
          signal?.removeEventListener('abort',onAbort);
          resolve();
        }};
      waiting.push(entry);
      signal?.addEventListener('abort',onAbort,{once:true});
      if(signal?.aborted)onAbort();
      else drain();
    });
  };
  const observe=(duration,response,error)=>{
    // Navigation cancellation is not a signal of database contention.
    if(error?.name==='AbortError')return;
    const elapsed=Math.max(0,Number(duration)||0);
    const previous=latencyMs;
    latencyMs=previous?previous*0.8+elapsed*0.2:elapsed;
    const status=Number(response?.status??error?.status??0);
    const congestion=TRANSIENT_STATUS.has(status)||error?.name==='TimeoutError';
    const slowdown=Boolean(previous)&&waiting.length>0&&
      elapsed>Math.max(2500,previous*2);
    if(congestion||slowdown){
      // Give back ONE slot, not an invented share of CPU / Auth / SQL.
      capacity=Math.max(1,capacity-1);
      holdUntil=now()+Math.min(12000,Math.max(1500,elapsed));
      healthyWithDemand=0;
    }else if(waiting.length&&now()>=holdUntil){
      healthyWithDemand++;
      // Increase only while there is real waiting demand and successful work.
      if(healthyWithDemand>=capacity){
        capacity=Math.min(max,capacity+1);
        healthyWithDemand=0;
      }
    }else healthyWithDemand=0;
  };
  const withBudget=async(request,signal=null,{kind='normal'}={})=>{
    if(typeof request!=='function')throw new TypeError('A read task is required');
    await acquire(signal,kind);
    const started=now();
    try{
      if(signal?.aborted)throw cancelled();
      const result=await request();
      observe(now()-started,result,null);
      return result;
    }catch(error){
      observe(now()-started,null,error);
      throw error;
    }finally{
      active--;
      drain();
    }
  };
  withBudget.snapshot=()=>Object.freeze({
    active,waiting:waiting.length,capacity,ceiling:max,
    observedLatencyMs:Math.round(latencyMs)
  });
  return withBudget;
}
export const withPublicReadBudget=createPublicReadBudget();
