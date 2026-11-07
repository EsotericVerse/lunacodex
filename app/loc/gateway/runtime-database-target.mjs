// Independent SQL Gateway: resolve the database chosen by the verified LOC
// subject. Only Authority-issued signed db_target claims can select a profile.
// The connection URL is returned over a server-to-server authenticated channel.
import {normalizeLiveTarget,runtimeTargetId} from '../providers/live-database-target.mjs';

const AUTHORITY='https://auth.lo3rwang.cc';
const SERVICE_SECRET=/^[A-Za-z0-9_-]{43,128}$/;
const cache=new Map();
export async function resolveRuntimeDatabase(claims,signedDelegation,{
 origin=AUTHORITY,serviceKey='',fetchImpl=globalThis.fetch,
 now=Date.now()
}={}){
 const id=runtimeTargetId(claims);
 if(!id)return null;
 if(typeof claims?.sub!=='string'||!/^loc_[A-Za-z0-9_-]{32,80}$/.test(claims.sub)||
   typeof signedDelegation!=='string'||signedDelegation.split('.').length!==3)
  throw Object.assign(new Error('Signed LOC account selection required'),{httpStatus:403});
 if(!SERVICE_SECRET.test(String(serviceKey||'')))
  throw Object.assign(new Error('LOC SQL Gateway service credential is not provisioned'),{httpStatus:503});
 const key=claims.sub+':'+id;
 const previous=cache.get(key);
 if(previous&&previous.expires>now)return previous.value;
 const endpoint=new URL(origin);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
  endpoint.search||endpoint.hash||!['','/'].includes(endpoint.pathname))
  throw Object.assign(new Error('LOC SQL Authority origin is invalid'),{httpStatus:503});
 const response=await fetchImpl(endpoint.origin+'/v1/sql/runtime-profile',{
  method:'POST',redirect:'error',cache:'no-store',
  headers:{authorization:'Bearer '+signedDelegation,
    'x-loc-sql-service-key':serviceKey,'content-type':'application/json'},
  body:JSON.stringify({id}),signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw Object.assign(
  new Error(response.status===403?'Selected LOC database no longer authorized':
    'LOC SQL profile service unavailable'),
  {httpStatus:response.status===401||response.status===403?403:503});
 let body;
 try{body=await response.json();}catch{
  throw Object.assign(new Error('LOC SQL profile response invalid'),{httpStatus:503});
 }
 if(body?.id!==id)throw Object.assign(
   new Error('LOC SQL profile mismatch'),{httpStatus:503});
 const value=normalizeLiveTarget(id,body.profile);
 // Different selections always have distinct keys, so switching is immediate.
 // Brief cache avoids repeating the Authority RTT on a multi-query page.
 cache.set(key,{value,expires:now+5000});
 while(cache.size>32)cache.delete(cache.keys().next().value);
 return value;
}
