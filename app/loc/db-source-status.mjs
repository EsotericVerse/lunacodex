const DEFAULT_STATE=Object.freeze({
  primaryLabel:'主要資料庫連線',
  backupLabel:'',
  activeSource:'primary',
  degraded:false,
  unavailable:false,
  failingResources:[],
  unavailableResources:[],
  primaryError:'',
  fallbackSince:null
});

let labels={primaryLabel:DEFAULT_STATE.primaryLabel,backupLabel:DEFAULT_STATE.backupLabel};
const failures=new Map();
// Resources where the backup read also failed after the primary read failed.
// Tracked separately so "primary degraded, backup covering" can be told apart
// from "primary and backup both failed" instead of both reporting as 'backup'.
const backupFailures=new Map();
const listeners=new Set();
let manualReadLabel='';

// Footer indicates whether a data source is reachable, not whether every
// individual SQL query is permitted or correctly shaped.
export function isDatabaseConnectivityFailure(error){
  const code=String(error?.code||error?.cause?.code||'');
  const status=Number(error?.status||error?.cause?.status||0);
  if(['SEARCH_RATE_LIMIT','SEARCH_TIMEOUT'].includes(code)||status===429)return false;
  if(status>=400&&status<500)return false;
  if(code.startsWith('08')||code==='53300')return true;
  if(error?.name==='TimeoutError'||error?.cause?.name==='TimeoutError')return true;
  if([502,503,504].includes(status))return true;
  return status===0&&(error instanceof TypeError||
    /networkerror|failed to fetch|fetch failed|econn|socket|timed? out|disconnect|network unavailable/i.test(String(error?.message||'')));
}

function snapshot(){
  const failingResources=[...failures.keys()].sort();
  const unavailableResources=failingResources.filter(key=>backupFailures.has(key));
  const first=[...failures.values()][0]||null;
  const hasBackup=Boolean(labels.backupLabel);
  const degraded=Boolean(manualReadLabel||(hasBackup&&failingResources.length));
  const unavailable=Boolean(unavailableResources.length||(!hasBackup&&failingResources.length));
  return Object.freeze({
    ...labels,
    backupLabel:manualReadLabel||labels.backupLabel,
    activeSource:unavailable?'unavailable':(degraded?'backup':'primary'),
    degraded,
    unavailable,
    failingResources,
    unavailableResources,
    primaryError:first?.message||'',
    fallbackSince:first?.since||null
  });
}
let current=snapshot();
function emit(){
  current=snapshot();
  for(const listener of listeners)listener();
}

export function configureDbSourceLabels(primaryLabel='主要資料庫連線',backupLabel=''){
  labels={
    primaryLabel:String(primaryLabel||'主要資料庫連線'),
    backupLabel:String(backupLabel??'')
  };
  emit();
}
export function setManualReadSource(label=''){
  const next=String(label||'').trim();
  if(manualReadLabel===next)return;
  manualReadLabel=next;
  emit();
}

export function markPrimaryReadFailed(resource,error){
  const key=String(resource||'public-read');
  const existing=failures.get(key);
  failures.set(key,{
    message:String(error?.message||error||'Primary public read failed'),
    since:existing?.since||new Date().toISOString()
  });
  emit();
}
export function markPrimaryReadSucceeded(resource){
  // This is a source-wide connectivity indicator. A successful primary
  // SELECT disproves a stale "whole source unavailable" state even if it
  // was recorded while reading a different table.
  if(!failures.size&&!backupFailures.size)return;
  failures.clear();
  backupFailures.clear();
  emit();
}
export function markBackupReadFailed(resource,error){
  const key=String(resource||'public-read');
  const existing=backupFailures.get(key);
  backupFailures.set(key,{
    message:String(error?.message||error||'Backup public read failed'),
    since:existing?.since||new Date().toISOString()
  });
  emit();
}
export function markBackupReadSucceeded(resource){
  const key=String(resource||'public-read');
  if(!backupFailures.delete(key))return;
  emit();
}
export function getDbSourceStatus(){return current;}
export function subscribeDbSourceStatus(listener){
  listeners.add(listener);
  return()=>listeners.delete(listener);
}
