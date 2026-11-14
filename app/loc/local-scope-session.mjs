// One opt-in, expiring device-only routing lease. No timers, polls, cloud
// permissions or persistent access tokens live in this module.
export const LOCAL_SCOPE_LEASE_KEY='loc-device-local-core-until-v1';
export const LOCAL_SCOPE_LEASE_CHANGED='loc-local-core-lease-changed';
export const LOCAL_SCOPE_MINUTES=Object.freeze([15,30,60]);
export const LOCAL_SCOPE_MAX_MS=60*60*1000;
export function validLocalDeadline(raw,now=Date.now()){
  const deadline=Number(raw);
  return Number.isSafeInteger(deadline)&&deadline>now&&
    deadline<=now+LOCAL_SCOPE_MAX_MS?deadline:0;
}
export function hasExpiredLocalDeadline(now=Date.now()){
  if(typeof window==='undefined')return false;
  try{
    const raw=window.localStorage.getItem(LOCAL_SCOPE_LEASE_KEY);
    // An old or clock-skewed lease must NEVER silently re-enable cloud
    // requests on a device-local URL; return to the website instead.
    return raw!==null&&!validLocalDeadline(raw,now);
  }catch{return false;}
}
export function getLocalDeadline(){
  if(typeof window==='undefined')return 0;
  try{return validLocalDeadline(window.localStorage.getItem(LOCAL_SCOPE_LEASE_KEY));}
  catch{return 0;}
}
export function subscribeLocalDeadline(onChange){
  if(typeof window==='undefined')return()=>{};
  const changed=()=>onChange();
  const storage=event=>{
    if(event.key===LOCAL_SCOPE_LEASE_KEY)onChange();
  };
  window.addEventListener(LOCAL_SCOPE_LEASE_CHANGED,changed);
  window.addEventListener('storage',storage);
  return()=>{
    window.removeEventListener(LOCAL_SCOPE_LEASE_CHANGED,changed);
    window.removeEventListener('storage',storage);
  };
}
export function startLocalDeadline(minutes,now=Date.now()){
  if(!LOCAL_SCOPE_MINUTES.includes(minutes))
    throw new Error('本機模式只能選擇 15／30／60 分鐘');
  if(typeof window==='undefined')throw new Error('只能在裝置端切換本機模式');
  const until=now+minutes*60000;
  window.localStorage.setItem(LOCAL_SCOPE_LEASE_KEY,String(until));
  window.dispatchEvent(new Event(LOCAL_SCOPE_LEASE_CHANGED));
  return until;
}
export function stopLocalDeadline(){
  if(typeof window==='undefined')return;
  window.localStorage.removeItem(LOCAL_SCOPE_LEASE_KEY);
  window.dispatchEvent(new Event(LOCAL_SCOPE_LEASE_CHANGED));
}
export function formatLocalCountdown(deadline,now=Date.now()){
  const remaining=Math.max(0,Math.ceil((deadline-now)/1000));
  const hours=Math.floor(remaining/3600);
  const minutes=Math.floor((remaining%3600)/60);
  const seconds=remaining%60;
  return (hours?String(hours).padStart(2,'0')+':':'')+
    String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0');
}
