import {MAX_MULTIPARA} from '../bounded-parallel.mjs';

// All anonymous Kysely readers in one browser runtime share the same budget.
// Limit burst fan-out without touching authenticated writes or adding retries.
export const MAX_PUBLIC_GATEWAY_READS=3;
export function createPublicReadBudget(max=MAX_PUBLIC_GATEWAY_READS){
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid public read concurrency');
  max=Math.min(max,MAX_MULTIPARA);
  let active=0;
  const waiting=[];
  const acquire=()=>{
    if(active<max){active++;return Promise.resolve();}
    return new Promise(resolve=>waiting.push(resolve));
  };
  const release=()=>{
    // Transfer an already-reserved slot instead of releasing it and racing
    // a newly arriving read against the first queued reader.
    const next=waiting.shift();
    if(next)next();
    else active--;
  };
  return async function withReadBudget(request){
    if(typeof request!=='function')throw new TypeError('A read task is required');
    await acquire();
    try{return await request();}
    finally{release();}
  };
}
export const withPublicReadBudget=createPublicReadBudget();
