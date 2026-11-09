import {canManageDelegation} from '../auth/delegation-contract.mjs';
import {locRolePrincipal} from '../../../zenstack/role-hierarchy.mjs';
// One verified LOC authorization decision per SQL request, regardless of dialect.
// Only the trusted gateway may bind claims. No database RPC and no DB Auth login.
const sessions=new WeakMap();
// Reuse a locally verified LOC delegation's permission snapshot for at most
// 30 seconds. The trusted gateway verifies the signed token on every request.
const PERMISSION_REUSE_MS=30_000;
const MAX_PERMISSION_SESSIONS=96;
const permissionSnapshots=new Map();
function reuseKey(state){
  const exp=Number(state.claims?.exp);
  if(!Number.isFinite(exp)||exp*1000<=Date.now())return null;
  const issuer=String(state.claims.iss||'');
  const sub=String(state.claims.sub||'');
  const sid=String(state.claims.sid||'');
  // The LOC-issued session ID is independent of the external OAuth adapter.
  if(sid)return JSON.stringify(['loc-session',issuer,sub,state.email,sid]);
  return JSON.stringify(['loc-token',issuer,sub,state.email,exp,
    String(state.claims.jti||'')]);
}
function cachedSnapshot(state){
  const key=reuseKey(state);
  if(!key)return {key:null,pending:null};
  const entry=permissionSnapshots.get(key);
  if(entry&&entry.until>Date.now())return {key,pending:entry.pending};
  if(entry)permissionSnapshots.delete(key);
  return {key,pending:null};
}
function rememberSnapshot(key,state,pending){
  if(!key)return;
  const until=Math.min(Date.now()+PERMISSION_REUSE_MS,Number(state.claims.exp)*1000);
  permissionSnapshots.set(key,{until,pending});
  // An expired promise never causes background work; it is removed on demand.
  while(permissionSnapshots.size>MAX_PERMISSION_SESSIONS)
    permissionSnapshots.delete(permissionSnapshots.keys().next().value);
  void pending.catch(()=>{
    if(permissionSnapshots.get(key)?.pending===pending)permissionSnapshots.delete(key);
  });
}
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER=/^[A-Za-z0-9_-]{1,128}$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC management permission denied'){
  throw Object.assign(new Error(message),{httpStatus:403});
}
export function bindLocAuthorization(db,{role='anon',claims={},snapshot=null,loadScopeTree=null}={}){
  if(!db||typeof db.selectFrom!=='function')throw new Error('Invalid Kysely transaction');
  if(role==='authenticated'&&(
    claims?.provider!=='loc'||claims?.me!==true||!USER.test(String(claims?.sub||''))||
    !EMAIL.test(String(claims?.email||'').trim().toLowerCase())))
    deny('Verified LOC delegation required');
  // External Scope DBs hold only their own tables. The trusted Gateway
  // may reuse a verified permission snapshot from the LOC control DB.
  if(loadScopeTree!==null&&typeof loadScopeTree!=='function')
    throw new TypeError('Trusted LOC Scope tree loader is required');
  sessions.set(db,{role,claims,email:String(claims?.email||'').trim().toLowerCase(),
    pending:snapshot?Promise.resolve(snapshot):null,loadScopeTree,scopeTreePromise:null});
}
// Hierarchy comes exclusively from the server-side control registry, never
// from a browser-supplied role or Group tree. Once per gateway transaction.
async function inheritedPrincipal(state){
  if(!state?.loadScopeTree||!Array.isArray(state.claims?.grants)||
     state.claims.grants.includes('global:manage')||
     !state.claims.grants.some(grant=>/^[a-z][a-z0-9]{0,14}:manage$/.test(grant)))
    return null;
  state.scopeTreePromise??=Promise.resolve().then(()=>state.loadScopeTree())
    .then(scopeTree=>locRolePrincipal(state.claims,{scopeTree}));
  return state.scopeTreePromise;
}
export async function locPermissions(db){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated')return {blocked:true,rows:[]};
  if(!state.pending){
    const {key,pending}=cachedSnapshot(state);
    if(pending){state.pending=pending;return pending;}
    state.pending=(async()=>{
    // Read this principal's LOC membership in ONE
    // parameterized SQL statement. No extra request or new permission cache.
    // The transaction carries a locally verified LOC identity; authorization
    // and revocation remain evaluated against the live LOC control database.
    const joined=await db.selectFrom('api.manage as m')
      .leftJoin('silver.loc as s','s.id','m.id')
      .select(['m.id','m.email','m.manage_role','m.active','m.galaxy_table',
        'm.anchor_table','s.birthday as birthday'])
      .where(db.fn('lower',['m.email']),'=',state.email)
      .where('m.manage_role','in',['admin','group','scope']).execute();
    // An explicit LOC-signed ancestor Group grant also authorizes its active
    // child scopes. Include their display metadata for the editor's role
    // preflight; the actual SQL write repeats the server-side permission gate.
    const hierarchy=await inheritedPrincipal(state);
    // Explicit signed Scope grants are authoritative even when the original
    // api.manage owner email belongs to someone else (a delegated editor).
    const exactIds=(state.claims.grants||[]).flatMap(value=>{
      const match=/^([a-z][a-z0-9]{0,14}):manage$/.exec(String(value));
      return match&&match[1]!=='global'?[match[1]]:[];
    });
    const alreadyJoined=new Set(joined.map(row=>row.id));
    const ids=[...new Set([...exactIds,...(hierarchy?.groupIds||[]),
      ...(hierarchy?.scopeIds||[])])].filter(id=>!alreadyJoined.has(id));
    let inherited=[];
    if(ids.length){
        const rows=await db.selectFrom('api.manage as m')
          .leftJoin('silver.loc as s','s.id','m.id')
          .select(['m.id','m.manage_role','m.active','m.galaxy_table',
            'm.anchor_table','s.birthday as birthday'])
          .where('m.id','in',ids).where('m.active','=',true)
          .where('m.manage_role','in',['group','scope']).execute();
        inherited=rows.filter(row=>exactIds.includes(row.id)||
          (row.manage_role==='group'?hierarchy?.groupIds.includes(row.id):
            hierarchy?.scopeIds.includes(row.id)))
          .map(row=>({...row,email:state.email}));
    }
    if(!joined.length&&!inherited.length)return {blocked:false,rows:[]};
    const authorized=new Map(inherited.map(row=>[row.id,row]));
    for(const row of joined)authorized.set(row.id,row);
    return {blocked:false,rows:[...authorized.values()]};
    })();
    rememberSnapshot(key,state,state.pending);
  }
  return state.pending;
}
export async function canManageLoc(db,type,id=''){
  const state=sessions.get(db);
  if(state?.role!=='authenticated')return false;
  const kind=String(type||'').toLowerCase(),scope=String(id||'').toLowerCase();
  if(canManageDelegation(state.claims,kind,scope))return true;
  if(!['scope','group'].includes(kind)||!SCOPE.test(scope))return false;
  const principal=await inheritedPrincipal(state);
  return Boolean(principal&&(kind==='group'
    ?principal.groupIds.includes(scope):principal.scopeIds.includes(scope)));
}

export async function locManageRows(db,type,id=null){
  const kind=String(type||'').toLowerCase(),scope=id==null?'':String(id).toLowerCase();
  if(!['self','global','group','scope'].includes(kind)||(
    ['group','scope'].includes(kind)&&!SCOPE.test(scope)))
    throw Object.assign(new Error('Invalid LOC management type or Scope'),{httpStatus:400});
  if(kind!=='self')return [{
    id:scope,email:null,role:kind,galaxy:null,anchor:null,birthday:null,
    allowed:await canManageLoc(db,kind,scope)
  }];
  // This read supplies display metadata only; it is not an authorization gate.
  const {blocked,rows}=await locPermissions(db);
  if(blocked)return [];
  const visible=rows.filter(r=>['admin','group','scope'].includes(r.manage_role));
  const mapped=[];
  for(const row of visible){
    const level=row.manage_role==='admin'?'global':row.manage_role;
    const allowed=await canManageLoc(db,level,row.id);
    if(allowed)mapped.push({id:row.id,email:row.email,role:row.manage_role,
      galaxy:row.galaxy_table,anchor:row.anchor_table,birthday:row.birthday,allowed});
  }
  return mapped;
}
