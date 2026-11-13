// Browser-only presentation of the ONE verified loc_access result.
// The server's ZModel/PolicyPlugin decides grants; the browser never creates
// additional permissions or re-reads api.manage. This is not a write authority.
import {locRolePrincipal,LOC_ROLE_LEVEL} from '../../zenstack/role-hierarchy.mjs';

let userId='';
let email='';
let entries=null;
let principal=null;
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const normalizeScope=value=>String(value||'').trim().toLowerCase();

export function clearAuthorization(){
  userId='';email='';entries=null;principal=null;
}

export function setAuthorization(user,permissions={}){
  clearAuthorization();
  const id=String(user?.id||'');
  const verifiedEmail=normalizeEmail(user?.email);
  if(!id||!verifiedEmail)throw new Error('無法取得已確認的登入身分。');
  const rows=Array.isArray(permissions.roles)?permissions.roles:[];
  const grants=Array.isArray(permissions.grants)?permissions.grants:[];
  const safeRows=rows.flatMap(row=>{
    const scopeid=normalizeScope(row?.id);
    const recordEmail=normalizeEmail(row?.email);
    const role=String(row?.role||'').trim().toLowerCase();
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scopeid)||recordEmail!==verifiedEmail||
       !['admin','group','scope'].includes(role))return [];
    return [Object.freeze({scopeid,email:recordEmail,role})];
  });
  if(grants.some(value=>typeof value!=='string')||grants.length&&!safeRows.length)
    throw new Error('LOC 管理權限與已驗證身分不一致。');
  const model=locRolePrincipal({provider:'loc',me:true,sub:id,grants});
  if(grants.length&&!model)throw new Error('LOC 權限主體無效。');
  userId=id;email=verifiedEmail;
  entries=Object.freeze(safeRows);
  principal=model;
  return entries;
}

export function readAuthorization(){
  return entries===null?null:{userId,email,entries};
}

// Exactly the same ZModel LocPrincipal hierarchy used by trusted loc_access.
// The UI only consumes the server-issued result; all SQL writes reauthorize.
export function canAuthorizeLocAccess(level,scopeId=''){
  const kind=String(level||'').toLowerCase();
  const scope=normalizeScope(scopeId);
  if(!principal||!['global','group','scope'].includes(kind))return false;
  if(principal.roleLevel>=LOC_ROLE_LEVEL.admin)return true;
  if(kind==='global')return false;
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))return false;
  return kind==='group'?principal.groupIds.includes(scope):
    principal.groupIds.includes(scope)||principal.scopeIds.includes(scope);
}

export function createScopeAuthorizer(user){
  const current=readAuthorization();
  if(!principal||!current||current.userId!==String(user?.id||'')||
    current.email!==normalizeEmail(user?.email))return null;
  return Object.freeze({
    email:current.email,
    role:principal.role,
    scopeIds:principal.scopeIds,
    groupIds:principal.groupIds,
    canLocAccessSync:canAuthorizeLocAccess
  });
}

export function assertAuthorizationForTable(table){
  // This is an early UI rejection only. LOC business writes always enforce
  // loc_access + ZModel policy on the trusted server.
  const name=String(table||'').trim().toLowerCase();
  if(name==='silver.local'||name.startsWith('silver.local_'))throw new Error('Local Scope 尚未啟用。');
  if(name==='silver.loc_anchor'){
    if(canAuthorizeLocAccess('global'))return;
    throw new Error('LOC 來源詞庫僅限系統管理員編輯。');
  }
  if(name==='api.manage'){
    if(canAuthorizeLocAccess('global'))return;
    throw new Error('目前登入帳號沒有全域管理權限。');
  }
  if(!name.startsWith('silver.'))throw new Error('未知的資料寫入目標。');
  const suffix=name.slice(7);
  if(suffix==='manage')throw new Error('舊管理路由已停用。');
  const scopeid=suffix==='runes'||suffix.startsWith('runes_')?'lrunes':suffix.split('_')[0];
  if(canAuthorizeLocAccess(scopeid==='loc'?'group':'scope',scopeid))return;
  throw new Error('目前登入帳號沒有此 Scope 的寫入權限。');
}
