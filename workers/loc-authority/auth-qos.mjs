// LOC Auth request-rate policy. Better Auth owns enforcement, storage and 429s.
// Karaul provides Poisson/PELT signals, not a competing authentication system.
// Pattern follows Better Auth 1.7's native rateLimit.customRules contract.
import {detectChangepoints,PoissonCost} from 'karaul';

const BUCKET_MS=5000;
const BUCKET_COUNT=16;
const MAX_SOURCES=1024;
const SURGE_REQUESTS=36;
const TEMPORARY_WINDOW=30;
const poisson=new PoissonCost();

// One per Worker isolate: createLocAuth() itself is request-scoped.
// Keep these counters bounded and event-driven; no scheduled polling or DB.
export function createAuthKaraulRateRules({now=()=>Date.now(),detect=detectChangepoints}={}){
  const histories=new Map();
  function rule(request,normal){
    const source=request.headers.get('cf-connecting-ip');
    if(!source)return normal;

    const key=source;
    const tick=Math.floor(now()/BUCKET_MS);
    let entry=histories.get(key);
    if(!entry||tick<entry.tick||tick-entry.tick>=BUCKET_COUNT){
      entry={tick,counts:Array(BUCKET_COUNT).fill(0),until:0};
    }
    histories.delete(key);
    histories.set(key,entry);
    if(histories.size>MAX_SOURCES)histories.delete(histories.keys().next().value);

    if(entry.until>now())return {window:TEMPORARY_WINDOW,max:1};
    if(entry.until){
      entry.counts.fill(0);
      entry.tick=tick;
      entry.until=0;
    }

    if(tick>entry.tick){
      const shift=tick-entry.tick;
      entry.counts.copyWithin(0,shift);
      entry.counts.fill(0,BUCKET_COUNT-shift);
      entry.tick=tick;
      const completed=entry.counts.slice(0,-1);
      const total=completed.reduce((a,b)=>a+b,0);
      if(total>=SURGE_REQUESTS){
        try{
          const boundaries=detect(completed,poisson);
          const change=boundaries.at(-1);
          if(change>=4&&change<completed.length-1){
            const baseline=completed.slice(0,change);
            const tail=completed.slice(change);
            const before=baseline.reduce((a,b)=>a+b,0)/baseline.length;
            const after=tail.reduce((a,b)=>a+b,0)/tail.length;
            if(after*tail.length>=SURGE_REQUESTS&&after>=Math.max(12,before*4)){
              entry.until=now()+TEMPORARY_WINDOW*1000;
              return {window:TEMPORARY_WINDOW,max:1};
            }
          }
        }catch{
          // Analytic failures must not interrupt login or token issuance.
        }
      }
    }
    entry.counts[BUCKET_COUNT-1]++;
    return normal;
  }
  // Better Auth matches these paths after removing its /api/auth basePath.
  // Do not throttle issuer metadata, JWKS, consent or Google callbacks here.
  return {
    '/oauth2/*':rule,
    '/sign-in/social':rule,
    '/jwks':false
  };
}

export const authKaraulRateRules=createAuthKaraulRateRules();
