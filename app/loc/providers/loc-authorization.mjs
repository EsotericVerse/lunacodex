// One verified LOC authorization decision per SQL request, regardless of dialect.
// Only the trusted gateway may bind claims. No database RPC and no DB Auth login.
const sessions=new WeakMap();
// Reuse the existing Clerk OAuth session's verified permission snapshot for
// 30 seconds at most. This is lazy (no polling, Cron, or new credential).
// Every HTTP request still needs a verified, unexpired Clerk JWT.
const PERMISSION_REUSE_MS=30_000;
const MAX_PERMISSION_SESSIONS=96;
const permissionSnapshots=new Map();
function reuseKey(state){
  const exp=Number(state.claims?.exp);
  if(!Number.isFinite(exp)||exp*1000<=Date.now())return null;
  const issuer=String(state.claims.iss||'');
  const sub=String(state.claims.sub||'');
  const sid=String(state.claims.sid||'');
  // An interactive Clerk Session keeps the same signed sub + sid when the
  // short-lived JWT rotates. Reuse its *30-second* management snapshot instead
  // of SELECTing manage again for every fresh exp/jti.
  if(/^user_[A-Za-z0-9]+$/.test(sub)&&/^sess_[A-Za-z0-9]+$/.test(sid))
    return JSON.stringify(['clerk-session',issuer,sub,state.email,sid]);
  // MCP OAuth has a different audience and may have no session ID.
  // Keep its previous token-bound key; never share it with a browser Session.
  return JSON.stringify(['oauth-token',issuer,sub,state.email,exp,
    sid,String(state.claims.jti||'')]);
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
const USER=/^user_[A-Za-z0-9]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC management permission denied'){
  throw Object.assign(new Error(message),{httpStatus:403});
}
export function bindLocAuthorization(db,{role='anon',claims={},snapshot=null}={}){
  if(!db||typeof db.selectFrom!=='function')throw new Error('Invalid Kysely transaction');
  if(role==='authenticated'&&(
    claims?.provider!=='clerk'||!USER.test(String(claims?.sub||''))||
    !EMAIL.test(String(claims?.email||'').trim().toLowerCase())))
    deny('Verified Clerk identity required');
  // External Scope DBs hold only their own tables. The trusted Gateway
  // may reuse a verified permission snapshot from the LOC control DB.
  sessions.set(db,{role,claims,email:String(claims?.email||'').trim().toLowerCase(),
    pending:snapshot?Promise.resolve(snapshot):null});
}
export async function locPermissions(db){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated')return {blocked:true,rows:[]};
  if(!state.pending){
    const {key,pending}=cachedSnapshot(state);
    if(pending){state.pending=pending;return pending;}
    state.pending=(async()=>{
    // Read the blacklist and this principal's LOC membership in ONE
    // parameterized SQL statement. No extra request or new permission cache.
    // The transaction still carries verified Clerk claims; authorization
    // and revocation remain evaluated against the live LOC control database.
    const joined=await db.selectFrom('api.manage as m')
      .crossJoin('silver.loc as l')
      .leftJoin('silver.loc as s','s.id','m.id')
      .select(['m.id','m.email','m.manage_role','m.active','m.galaxy_table',
        'm.anchor_table','s.birthday as birthday','l.blacklist'])
      .where('l.id','=','loc')
      .where(db.fn('lower',['m.email']),'=',state.email)
      .where('m.manage_role','in',['admin','group','scope']).execute();
    if(!joined.length)return {blocked:false,rows:[]};
    let blacklist=joined[0].blacklist;
    if(typeof blacklist==='string'){
      try{blacklist=JSON.parse(blacklist)}catch{deny('Invalid LOC blacklist')}
    }
    if(!blacklist||typeof blacklist!=='object'||Array.isArray(blacklist)||
      blacklist.email!==undefined&&!Array.isArray(blacklist.email))
      deny('LOC blacklist configuration unavailable');
    if((blacklist.email||[]).some(item=>
      String(item?.email||'').trim().toLowerCase()===state.email))
      return {blocked:true,rows:[]};
    return {blocked:false,rows:joined.map(({blacklist:ignored,...row})=>row)};
    })();
    rememberSnapshot(key,state,state.pending);
  }
  return state.pending;
}
export async function canManageLoc(db,type,id=''){
  const kind=String(type||'').toLowerCase(),scope=String(id||'').toLowerCase();
  if(!['global','group','scope'].includes(kind)||
    (kind!=='global'&&!SCOPE.test(scope)))return false;
  const {blocked,rows}=await locPermissions(db);
  if(blocked)return false;
  if(rows.some(r=>r.id==='admin'&&r.manage_role==='admin'))return true;
  return rows.some(r=>(r.active===true||r.active===1)&&(
    kind==='group'&&r.id===scope&&r.manage_role==='group'||
    kind==='scope'&&(r.id===scope&&r.manage_role==='scope'||
      scope==='loc'&&r.id==='loc'&&r.manage_role==='group')
  ));
}
export async function locManageRows(db,type,id=null){
  const kind=String(type||'').toLowerCase(),scope=id==null?'':String(id).toLowerCase();
  if(!['self','global','group','scope'].includes(kind)||(
    ['group','scope'].includes(kind)&&!SCOPE.test(scope)))
    throw Object.assign(new Error('Invalid LOC management type or Scope'),{httpStatus:400});
  const {blocked,rows}=await locPermissions(db);
  if(kind==='self')return blocked?[]:rows.filter(r=>
    ['admin','group','scope'].includes(r.manage_role)&&
    (r.manage_role==='admin'||r.active===true||r.active===1))
    .map(r=>({id:r.id,email:r.email,role:r.manage_role,galaxy:r.galaxy_table,
      anchor:r.anchor_table,birthday:r.birthday,allowed:true}));
  return [{id:scope,email:null,role:kind,galaxy:null,anchor:null,birthday:null,
    allowed:!blocked&&await canManageLoc(db,kind,scope)}];
}
