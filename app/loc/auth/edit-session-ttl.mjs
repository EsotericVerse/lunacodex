// Browser-session edit guard. No credentials or content are stored.
export const EDIT_OPERATION_TTL_MS=5*60*1000;
export const EDIT_IDLE_TTL_MS=30*60*1000;
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
  return Boolean(value.locked)||now-value.lastActivityAt>=EDIT_IDLE_TTL_MS||
    now-value.startedAt>=EDIT_SESSION_TTL_MS||now<value.lastActivityAt;
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
  if(expired(value,now)){
    store(storage,{...value,locked:true});
    return false;
  }
  store(storage,{...value,lastActivityAt:now});
  return true;
}
export function assertEditorSession(storage,now=Date.now()){
  if(!touchEditorSession(storage,now)){
    // Leave the authenticated account intact; only the editor is locked.
    if(typeof window!=='undefined')window.dispatchEvent(new Event('loc-editor-session-expired'));
    throw new Error('編輯 Session 已閒置超過 30 分鐘或超過 2 小時，請重新驗證編輯權限後再寫入。');
  }
  return true;
}
export function clearEditorSession(storage){
  try{storage?.removeItem(KEY);}catch{}
}
