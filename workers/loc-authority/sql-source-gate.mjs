// LOC SQL connection gate: one source-level circuit breaker, across every
// target/project sharing the same host and port. No SQL discovery or retries.
export const SQL_PROBE_WINDOW_MS=60*60*1000;
export const SQL_PROBE_LIMIT=3;
export const SQL_PROBE_COOLDOWN_MS=5*60*1000;
const BAD=/^(AUTH_FAILED|TYPE_MISMATCH|CAPACITY|TIMEOUT|TRANSPORT|DATABASE_UNAVAILABLE)$/;

export async function sqlSourceKey(profile){
 const host=String(profile?.host||'').trim().toLowerCase();
 const port=Number(profile?.port);
 if(!host||!Number.isInteger(port)||port<1||port>65535)
  throw new Error('Invalid SQL connection source');
 const input=new TextEncoder().encode(host+':'+port);
 const hash=await crypto.subtle.digest('SHA-256',input);
 return 'sql-source:'+Array.from(new Uint8Array(hash),
  byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function reserveSqlProbe(previous,now,ticket){
 const old=previous&&typeof previous==='object'?previous:{};
 const within=Number.isFinite(old.windowStart)&&
  now-old.windowStart<SQL_PROBE_WINDOW_MS&&now>=old.windowStart;
 const windowStart=within?old.windowStart:now;
 const attempts=within?Number(old.attempts||0):0;
 const blockedUntil=Number(old.blockedUntil||0);
 if(blockedUntil>now)
  return {allowed:false,reason:'SOURCE_PAUSED',retryAt:blockedUntil,state:old};
 if(old.inFlight){
  // An expired unfinished probe is still an unknown SQL connection outcome.
  // Never send another login automatically: pause the shared source first.
  const lease=Number(old.leaseExpires||0);
  if(lease>now)
   return {allowed:false,reason:'SOURCE_BUSY',retryAt:lease,state:old};
  const paused={...old,inFlight:null,leaseExpires:0,
   blockedUntil:now+SQL_PROBE_COOLDOWN_MS,last_update:now,
   generation:Number(old.generation||0)+1};
  return {allowed:false,reason:'SOURCE_PAUSED',
   retryAt:paused.blockedUntil,state:paused,save:true};
 }
 if(attempts>=SQL_PROBE_LIMIT)
  return {allowed:false,reason:'PROBE_LIMIT',retryAt:windowStart+SQL_PROBE_WINDOW_MS,state:old};
 return {allowed:true,reason:'ALLOWED',retryAt:0,state:{
  windowStart,attempts:attempts+1,blockedUntil:0,
  generation:Number(old.generation||0),inFlight:ticket,
  leaseExpires:now+30000,last_update:now
 }};
}

export function finishSqlProbe(previous,ticket,result,now){
 const old=previous&&typeof previous==='object'?previous:{};
 if(!ticket||old.inFlight!==ticket)return {accepted:false,state:old};
 const success=result?.ok===true&&result?.typeVerified===true&&
  result?.credentialsVerified===true;
 const reason=success?'VERIFIED':
  BAD.test(String(result?.reason||''))?result.reason:'DATABASE_UNAVAILABLE';
 // A single rejected login or busy/failed connection pauses the entire
 // database source immediately. Not merely the user ID or LOC project.
 const blockedUntil=success?0:now+SQL_PROBE_COOLDOWN_MS;
 return {accepted:true,success,reason,state:{
  ...old,inFlight:null,leaseExpires:0,blockedUntil,last_update:now,
  generation:Number(old.generation||0)+(success?0:1)
 }};
}

export function sqlVerificationAllowed(source,target,revision,now){
 return Boolean(source&&target&&
  Number(source.blockedUntil||0)<=now&&
  !source.inFlight&&target.status==='verified'&&
  target.revision===revision&&
  target.generation===Number(source.generation||0));
}

export async function sqlTargetRevision(profile){
 // A credential or SQL Type edit invalidates validation immediately.
 // Never return this fingerprint to the browser or log it.
 const input=new TextEncoder().encode(JSON.stringify({
  engine:profile.engine,db_type:profile.db_type||'direct',
  project_id:profile.project_id||'',provider_oauth:profile.provider_oauth||'',
  host:profile.host,port:profile.port,
  database:profile.database,username:profile.username,
  password:profile.password,authentication:profile.authentication
 }));
 const hash=await crypto.subtle.digest('SHA-256',input);
 return Array.from(new Uint8Array(hash),
  byte=>byte.toString(16).padStart(2,'0')).join('');
}
