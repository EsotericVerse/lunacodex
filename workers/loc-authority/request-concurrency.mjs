// Transport admission only: never revokes issuer JWKS, Sessions or OAuth keys.
// This protects a single Cloudflare Worker isolate against burst fan-out.
// Counters in this module are NOT shared across isolates; it is NOT a global
// security/blacklist authority. Global QoS needs independently approved shared
// coordination and must never be represented by this module.
import {detectChangepoints,PoissonCost} from 'karaul';

// Native Karaul Poisson/PELT over completed request-count buckets.
// Event-driven, bounded to one Worker isolate; Better Auth alone owns
// persistent account bans and Session revocation. No timers or new storage.
const KARAUL_COST=new PoissonCost();
const QOS_BUCKET_MS=5000;
const QOS_BUCKETS=16;
const QOS_MAX_SOURCES=1024;
const QOS_BLOCK_MS=30000;

export function createAuthKaraulQoS({now=()=>Date.now()}={}){
  const history=new Map();
  return {
    check(category,source){
      // Public issuer metadata and JWKS must not be disabled by traffic analysis.
      if(!source||category==='metadata')return 0;
      const key=category+':'+source,time=now();
      const tick=Math.floor(time/QOS_BUCKET_MS);
      let entry=history.get(key);
      if(!entry||tick<entry.tick||tick-entry.tick>=QOS_BUCKETS)
        entry={tick,counts:Array(QOS_BUCKETS).fill(0),blockedUntil:0};
      history.delete(key);
      history.set(key,entry);
      if(history.size>QOS_MAX_SOURCES)
        history.delete(history.keys().next().value);
      if(entry.blockedUntil>time)
        return Math.ceil((entry.blockedUntil-time)/1000);
      if(entry.blockedUntil){
        // Expired source quarantine recovers automatically on its next request.
        entry.counts.fill(0);
        entry.tick=tick;
        entry.blockedUntil=0;
      }
      if(tick>entry.tick){
        const shift=tick-entry.tick;
        entry.counts.copyWithin(0,shift);
        entry.counts.fill(0,QOS_BUCKETS-shift);
        entry.tick=tick;
        const completed=entry.counts.slice(0,-1);
        const volume=completed.reduce((sum,n)=>sum+n,0);
        // Only invoke the published PELT detector on substantial traffic
        // and when a bucket closes, never once per HTTP request.
        if(volume>=36){
          const changes=detectChangepoints(completed,KARAUL_COST);
          const point=changes.at(-1);
          if(point>=4&&point<=completed.length-2){
            const baseline=completed.slice(0,point);
            const surge=completed.slice(point);
            const prior=baseline.reduce((sum,n)=>sum+n,0)/baseline.length;
            const recent=surge.reduce((sum,n)=>sum+n,0);
            if(recent>=36&&recent/surge.length>=Math.max(12,prior*4)){
              entry.blockedUntil=time+QOS_BLOCK_MS;
              return Math.ceil(QOS_BLOCK_MS/1000);
            }
          }
        }
      }
      entry.counts[QOS_BUCKETS-1]++;
      return 0;
    }
  };
}

const DEFAULTS=Object.freeze({
  maxInFlight:128,
  perSource:Object.freeze({oauth:24,session:48,metadata:96,other:32})
});
export function requestClass(path=''){
  if(path==='/api/auth/jwks'||path==='/.well-known/jwks.json'||
    path.startsWith('/.well-known/'))return 'metadata';
  if(path==='/api/auth/get-session')return 'session';
  if(path.startsWith('/api/auth/oauth2/')||path==='/api/auth/sign-in/social'||
    path==='/api/auth/callback/google')return 'oauth';
  return 'other';
}
export function createAuthRequestConcurrencyGate(limits=DEFAULTS){
  const inflight=new Map();
  const karaul=createAuthKaraulQoS(limits.karaul);
  let active=0;
  const sourceCeilings={...DEFAULTS.perSource,...(limits.perSource||{})};
  const totalCeiling=limits.maxInFlight??DEFAULTS.maxInFlight;
  return {
    acquire(request){
      const path=new URL(request.url).pathname;
      const category=requestClass(path);
      // CF-Connecting-IP is supplied by Cloudflare, unlike arbitrary proxy headers.
      const source=request.headers.get('cf-connecting-ip')||'';
      const retryAfterSeconds=karaul.check(category,source);
      if(retryAfterSeconds)
        return {allowed:false,category,reason:'adaptive_qos',retryAfterSeconds};
      const id=source?category+':'+source:null;
      const count=id?(inflight.get(id)||0):0;
      if(active>=totalCeiling||
        (id&&count>=sourceCeilings[category])){
        return {allowed:false,category,retryAfterSeconds:2};
      }
      active+=1;
      if(id)inflight.set(id,count+1);
      let released=false;
      return {
        allowed:true,category,
        release(){
          if(released)return;
          released=true;
          active-=1;
          if(id){
            const next=(inflight.get(id)||0)-1;
            if(next>0)inflight.set(id,next);
            else inflight.delete(id);
          }
        }
      };
    },
    snapshot(){return {inflight:active,sourceKeys:inflight.size};}
  };
}
export const authRequestConcurrencyGate=createAuthRequestConcurrencyGate();
