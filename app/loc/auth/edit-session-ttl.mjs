// Browser-session edit guard. No credentials or content are stored.
export const EDIT_OPERATION_TTL_MS=5*60*1000;
export const EDIT_SESSION_TTL_MS=2*60*60*1000;
const KEY='loc-editor-session-v1';
const fresh=now=>({startedAt:now,lastActivityAt:now,locked:false});
function read(storage,now){
  try{
    const value=JSON.parse(storage?.getItem(KEY)||'null');
    if(value&&Number.isFinite(value.startedAt)&&Number.isFinite(value.lastActivityAt))
      return value;
  }catch{}
  return fresh(now);
}
function expired(value,now){
  return Boolean(value.locked)||now-value.startedAt>=EDIT_SESSION_TTL_MS||
    now<value.startedAt;
}
function store(storage,value){
  try{storage?.setItem(KEY,JSON.stringify(value));}catch{}
}
export function editorSessionStatus(storage,now=Date.now()){
  const current=read(storage,now);
  return {expired:expired(current,now),startedAt:current.startedAt,lastActivityAt:current.lastActivityAt};
}
export function touchEditorSession(storage,now=Date.now()){
  const value=read(storage,now);
  if(expired(value,now))return false;
  // The verified Session uses a fixed two-hour clock, not sliding TTL.
  // Checking a page or pressing a key must never rewrite its stored state.
  try{if(!storage?.getItem(KEY))store(storage,value);}catch{}
  return true;
}
export function assertEditorSession(storage,now=Date.now()){
  if(!touchEditorSession(storage,now)){
    // Leave the authenticated account intact; only the editor is locked.
    if(typeof window!=='undefined')window.dispatchEvent(new Event('loc-editor-session-expired'));
    throw new Error('編輯 Session 已超過 2 小時，請重新驗證編輯權限後再寫入。');
  }
  return true;
}
export function clearEditorSession(storage){
  try{storage?.removeItem(KEY);}catch{}
}

// The existing editor Session also carries the last *server-verified*
// management presentation snapshot. This is a browser UI hint ONLY:
// private reads and writes still authorize against LOC Auth / database.
// Never start another clock, overwrite the current Scope, or re-save on
// page navigation. The snapshot is recorded only after verification.
export function readEditorManagement(storage,now=Date.now()){
  let raw;
  try{raw=JSON.parse(storage?.getItem(KEY)||'null');}catch{return null;}
  if(!raw||expired(raw,now))return null;
  const data=raw.management;
  if(!data||typeof data!=='object'||!data.user||
    typeof data.user.id!=='string'||typeof data.user.email!=='string'||
    !Array.isArray(data.roles)||!Array.isArray(data.grants))return null;
  return data;
}
export function saveEditorManagement(storage,verified,now=Date.now()){
  const data=verified&&{
    user:{id:String(verified.user?.id||''),email:String(verified.user?.email||'')},
    roles:verified.roles,grants:verified.grants
  };
  if(!data?.user.id||!data.user.email||
     !Array.isArray(data.roles)||!Array.isArray(data.grants))return false;
  const existing=read(storage,now);
  // A newly verified identity may begin a new session after the previous
  // one expired. Ordinary page changes never enter this function.
  const current=expired(existing,now)?fresh(now):existing;
  store(storage,{...current,management:data});
  return true;
}
