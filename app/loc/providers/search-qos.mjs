// LOC Search QoS follows Auth: Karaul decides on abnormal traffic;
// the existing search request budget enforces 429 before SQL execution.
// Only explicit Galaxy.content text predicates are eligible. Other public
// reads, exact UID lookup, culture, trace and statistics are unaffected.
import {detectCountChangepoints} from '../karaul-count-changepoints.mjs';

const TEXT_OPS=new Set(['ilike','like','contains']);
const BUCKET_MS=5000;
const BUCKETS=16;
const MIN_SURGE=36;

function textPredicate(node){
  if(!node)return false;
  if(typeof node==='string')
    return /(?:^|[^a-z_])content\.(?:ilike|like|contains)\./i.test(node);
  if(typeof node!=='object')return false;
  if(Array.isArray(node.items))return node.items.some(textPredicate);
  return node.column==='content'&&TEXT_OPS.has(node.op||node.operator);
}
export function isTextSearchQuery(body){
  if(!body||typeof body!=='object'||
     body.kind!==undefined&&body.kind!=='query'||
     body.operation!==undefined&&body.operation!=='select'||
     !/_galaxy$/.test(String(body.table||'')))return false;
  return (Array.isArray(body.filters)&&body.filters.some(textPredicate))||
    (Array.isArray(body.or)&&body.or.some(textPredicate))||
    (Array.isArray(body.orFilters)&&body.orFilters.some(textPredicate))||false;
}

// Existing bounded per-isolate request budget remains the executor.
// Use the *same* optimized Karaul/PELT Poisson change-point path already
// used by LOC keyword discovery. Analyze completed buckets on request only:
// no timer, new SQL, new store, polling or extra keyword queries.
export function createSearchQos({now=()=>Date.now(),max=24,windowMs=60000,
  blockMs=120000,maxEntries=4096,detect=detectCountChangepoints}={}){
  const entries=new Map();
  return function check(key){
    const identity=String(key||'anonymous-unknown').slice(0,256);
    const time=now(),tick=Math.floor(time/BUCKET_MS);
    let state=entries.get(identity);
    if(!state||tick<state.tick||tick-state.tick>=BUCKETS)
      state={tick,counts:Array(BUCKETS).fill(0),times:[],blockedUntil:0};
    entries.delete(identity);
    entries.set(identity,state);
    if(entries.size>maxEntries)entries.delete(entries.keys().next().value);

    if(state.blockedUntil>time)
      return {allowed:false,blocked:true,retryAfterMs:state.blockedUntil-time};
    if(state.blockedUntil){
      state.times=[];
      state.counts.fill(0);
      state.tick=tick;
      state.blockedUntil=0;
    }
    if(tick>state.tick){
      const shift=tick-state.tick;
      state.counts.copyWithin(0,shift);
      state.counts.fill(0,BUCKETS-shift);
      state.tick=tick;
      const completed=state.counts.slice(0,-1);
      if(completed.reduce((a,b)=>a+b,0)>=MIN_SURGE){
        try{
          const point=detect(completed).at(-1);
          if(point>=4&&point<completed.length){
            const previous=completed.slice(0,point);
            const recent=completed.slice(point);
            const before=previous.reduce((a,b)=>a+b,0)/previous.length;
            const after=recent.reduce((a,b)=>a+b,0)/recent.length;
            if(after*recent.length>=MIN_SURGE&&after>=Math.max(12,before*4)){
              state.blockedUntil=time+blockMs;
              return {allowed:false,blocked:true,retryAfterMs:blockMs};
            }
          }
        }catch{
          // Analysis is advisory; existing request budget still applies.
        }
      }
    }
    state.counts[BUCKETS-1]++;
    state.times=state.times.filter(t=>time-t<windowMs);
    if(state.times.length>=max){
      const retryAfterMs=Math.max(1000,windowMs-(time-state.times[0]));
      return {allowed:false,blocked:false,retryAfterMs};
    }
    state.times.push(time);
    return {allowed:true,blocked:false,retryAfterMs:0};
  };
}
export const checkSearchQos=createSearchQos();
