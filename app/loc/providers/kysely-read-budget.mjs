import {MAX_MULTIPARA} from '../bounded-parallel.mjs';

// All anonymous Kysely readers in one browser runtime share the same budget.
// Limit burst fan-out without touching authenticated writes or adding retries.
export const MAX_PUBLIC_GATEWAY_READS=3;
export function createPublicReadBudget(max=MAX_PUBLIC_GATEWAY_READS){
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid public read concurrency');
  max=Math.min(max,MAX_MULTIPARA);
  let active=0;
  const waiting=[];
  const cancelled=()=>{
    const error=new Error('Request cancelled');
    error.name='AbortError';
    return error;
  };
  const acquire=signal=>{
    if(signal?.aborted)return Promise.reject(cancelled());
    if(active<max){active++;return Promise.resolve();}
    return new Promise((resolve,reject)=>{
      const entry={resume:()=>{
        signal?.removeEventListener('abort',onAbort);
        resolve();
      }};
      const onAbort=()=>{
        const index=waiting.indexOf(entry);
        if(index<0)return;
        waiting.splice(index,1);
        signal?.removeEventListener('abort',onAbort);
        reject(cancelled());
      };
      waiting.push(entry);
      signal?.addEventListener('abort',onAbort,{once:true});
      // An abort between the initial check and listener registration must
      // still remove this waiter without reserving a slot.
      if(signal?.aborted)onAbort();
    });
  };
  const release=()=>{
    // Transfer an already-reserved slot instead of releasing it and racing
    // a newly arriving read against the first queued reader.
    const next=waiting.shift();
    if(next)next.resume();
    else active--;
  };
  return async function withReadBudget(request,signal=null){
    if(typeof request!=='function')throw new TypeError('A read task is required');
    await acquire(signal);
    try{return await request();}
    finally{release();}
  };
}
export const withPublicReadBudget=createPublicReadBudget();
