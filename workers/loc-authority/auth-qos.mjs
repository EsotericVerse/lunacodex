// LOC Auth QoS policy: Karaul detects change points and chooses the budget.
// Better Auth's upstream rateLimit.customRules performs counting and HTTP 429.
// Neither a second limiter nor an identity/Session blacklist is created.
import {detectChangepoints,PoissonCost} from 'karaul';

// Existing LOC Auth budgets are centralized here rather than spread across
// Better Auth core options and the OAuth Provider's own configuration.
// Paths are those normalized by Better Auth (without /api/auth).
const BASE=Object.freeze({window:60,max:120});
const ENDPOINTS=Object.freeze({
  '/oauth2/token':40,
  '/oauth2/authorize':60,
  '/oauth2/introspect':100,
  '/oauth2/revoke':30,
  '/oauth2/register':5,
  '/oauth2/client/rotate-keys':5,
  '/oauth2/userinfo':120
});

const BUCKET_MS=5000;
const BUCKET_COUNT=16;
const MAX_SOURCES=1024;
const SURGE_REQUESTS=36;
const TEMPORARY_WINDOW=30;
const poisson=new PoissonCost();

export function createAuthKaraulRateRules({now=()=>Date.now(),detect=detectChangepoints}={}){
  // Shared across requests in one Worker isolate; no timers or persistence.
  const histories=new Map();

  function budget(request,native){
    const path=new URL(request.url).pathname.replace(/^\/api\/auth(?=\/)/,'');
    const preset=ENDPOINTS[path];
    const normal=preset===undefined?native:{window:BASE.window,max:preset};
    const source=request.headers.get('cf-connecting-ip');
    if(!source)return normal;

    // Changes in /get-session must not quarantine unrelated OAuth endpoints.
    const key=source+':'+path;
    const time=now();
    const tick=Math.floor(time/BUCKET_MS);
    let entry=histories.get(key);
    if(!entry||tick<entry.tick||tick-entry.tick>=BUCKET_COUNT)
      entry={tick,counts:Array(BUCKET_COUNT).fill(0),until:0};
    histories.delete(key);
    histories.set(key,entry);
    if(histories.size>MAX_SOURCES)histories.delete(histories.keys().next().value);

    if(entry.until>time)return {window:TEMPORARY_WINDOW,max:1};
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
              entry.until=time+TEMPORARY_WINDOW*1000;
              return {window:TEMPORARY_WINDOW,max:1};
            }
          }
        }catch{
          // If analytics fails, Better Auth's normal rate limit still applies.
        }
      }
    }
    entry.counts[BUCKET_COUNT-1]++;
    return normal;
  }

  // Native customRules first-match: exact public JWKS exemption, then catch
  // every nested Auth endpoint in one Karaul policy (Better Auth's '*'
  // matches only one path segment; '**' covers nested OAuth client routes). The native limiter still owns
  // storage, route evaluation and 429 responses.
  return {'/jwks':false,'/**':budget};
}

export const authKaraulRatePolicy=Object.freeze({
  enabled:true,
  ...BASE,
  customRules:createAuthKaraulRateRules()
});
