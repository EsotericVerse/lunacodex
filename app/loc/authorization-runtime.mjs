// Browser-runtime authorization gate. Only the verified LOC owner may edit.
// This is a UX preflight, not a substitute for the server's RLS/RPC checks.
let userId='';
let email='';
let entries=null;

const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const normalizeScope=value=>String(value||'').trim().toLowerCase();

export function clearAuthorization(){
  userId='';
  email='';
  entries=null;
}

export function setAuthorization(user,rows=[]){
  clearAuthorization();
  const id=String(user?.id||'');
  const verifiedEmail=normalizeEmail(user?.email);
  if(!id||!verifiedEmail)throw new Error('無法取得已確認的登入身分。');
  const next=(Array.isArray(rows)?rows:[]).flatMap(row=>{
    const scopeid=normalizeScope(row?.scopeid||row?.id);
    const recordEmail=normalizeEmail(row?.email);
    const role=String(row?.role||'').trim().toLowerCase();
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scopeid)||recordEmail!==verifiedEmail||!['admin','group','scope'].includes(role))return [];
    return [Object.freeze({scopeid,email:recordEmail,role})];
  });
  userId=id;
  email=verifiedEmail;
  entries=Object.freeze(next);
  return entries;
}

export function readAuthorization(){
  return entries===null?null:{userId,email,entries};
}

export function canAuthorizeScope(scopeid){
  const scope=normalizeScope(scopeid);
  return Boolean(email&&entries?.some(row=>row.email===email&&(
    row.role==='admin'||((row.role==='scope'||row.role==='group')&&row.scopeid===scope)
  )));
}

export function canAuthorizeGroup(groupId){
  const group=normalizeScope(groupId);
  return Boolean(email&&entries?.some(row=>row.email===email&&(
    row.role==='admin'||(row.role==='group'&&row.scopeid===group)
  )));
}

export function canAuthorizeGlobal(){
  return Boolean(email&&entries?.some(row=>row.email===email&&row.role==='admin'));
}

export function createScopeAuthorizer(user){
  const current=readAuthorization();
  if(!current||current.userId!==String(user?.id||'')||
    current.email!==normalizeEmail(user?.email))return null;
  const scopes=[...new Set(current.entries.filter(row=>row.role==='scope').map(row=>row.scopeid))].sort();
  const groups=[...new Set(current.entries.filter(row=>row.role==='group').map(row=>row.scopeid))].sort();
  const admin=canAuthorizeGlobal();
  return Object.freeze({
    email:current.email,
    role:admin?'admin':(groups.length?'group':(scopes.length?'scope':'')),
    scopeIds:Object.freeze(scopes),
    groupIds:Object.freeze(groups),
    canManageGroupSync:canAuthorizeGroup,
    canManageGlobalSync:canAuthorizeGlobal,
    canManageScopeSync:canAuthorizeScope
  });
}

export function assertAuthorizationForTable(table){
  // Local Scope is not provisioned and must never bypass authorization.
  const name=String(table||'').trim().toLowerCase();
  if(name==='silver.local'||name.startsWith('silver.local_'))throw new Error('Local Scope 尚未啟用。');
  if(name==='api.manage'){
    if(canAuthorizeGlobal())return;
    throw new Error('目前登入帳號沒有全域管理權限。');
  }
  if(!name.startsWith('silver.'))throw new Error('未知的資料寫入目標。');
  const suffix=name.slice(7);
  if(suffix==='manage')throw new Error('舊管理路由已停用。');
  // Rune reference tables are managed by the LunaRunes scope.
  const scopeid=suffix==='runes'||suffix.startsWith('runes_')?'lrunes':suffix.split('_')[0];
  if(scopeid==='loc'?canAuthorizeGroup('loc'):canAuthorizeScope(scopeid))return;
  throw new Error('目前登入帳號沒有此 Scope 的寫入權限。');
}
