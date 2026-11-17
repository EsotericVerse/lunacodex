// Tab-scoped, non-authorizing snapshot of a previously server-verified LOC role.
// This is for display and diagnostics only; it must never construct grants,
// createScopeAuthorizer(), or bypass an editor-entry/server write verification.
export const BROWSER_PERMISSION_KEY='loc-browser-permissions-v1';
const STATUS_KEY='loc-browser-permission-status-v1';
const roles=new Set(['admin','group','scope']);
const idPattern=/^[a-z][a-z0-9]{0,14}$/;

export function rememberBrowserPermissions(storage,user,entries,now=Date.now()){
  const userId=String(user?.id||'').trim();
  if(!userId||!Array.isArray(entries))return false;
  const scopes=entries.flatMap(entry=>{
    const scopeId=String(entry?.scopeid||'').trim().toLowerCase();
    const role=String(entry?.role||'').trim().toLowerCase();
    return idPattern.test(scopeId)&&roles.has(role)?[{scopeId,role}]:[];
  });
  try{
    storage?.setItem(BROWSER_PERMISSION_KEY,JSON.stringify({userId,scopes,verifiedAt:now}));
    storage?.setItem(STATUS_KEY,'verified');
    return true;
  }catch{return false;}
}

export function readBrowserPermissions(storage,userId=''){
  try{
    const snapshot=JSON.parse(storage?.getItem(BROWSER_PERMISSION_KEY)||'null');
    if(!snapshot||!Array.isArray(snapshot.scopes)||
       !Number.isFinite(snapshot.verifiedAt))return null;
    if(userId&&snapshot.userId!==String(userId))return null;
    if(snapshot.scopes.some(row=>!idPattern.test(row?.scopeId)||!roles.has(row?.role)))return null;
    return {userId:snapshot.userId,scopes:snapshot.scopes,
      verifiedAt:snapshot.verifiedAt,status:storage?.getItem(STATUS_KEY)||'unverified'};
  }catch{return null;}
}

export function markBrowserPermissionUnavailable(storage){
  // A transient 503/429 is not a revocation. Retain the last UI-only
  // snapshot, but never treat it as a currently verified authority.
  try{storage?.setItem(STATUS_KEY,'unavailable');}catch{}
}

export function clearBrowserPermissions(storage){
  try{
    storage?.removeItem(BROWSER_PERMISSION_KEY);
    storage?.removeItem(STATUS_KEY);
  }catch{}
}
