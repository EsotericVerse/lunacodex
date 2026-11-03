// One verified LOC authorization decision per SQL request, regardless of dialect.
// Only the trusted gateway may bind claims. No database RPC and no DB Auth login.
const sessions=new WeakMap();
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
  if(!state.pending)state.pending=(async()=>{
    // Both reads are Kysely-native. The source of truth is the active
    // registry and blacklist, not an old silver.manage() stored function.
    const config=await db.selectFrom('silver.loc').select('blacklist')
      .where('id','=','loc').executeTakeFirst();
    let blacklist=config?.blacklist;
    if(typeof blacklist==='string'){
      try{blacklist=JSON.parse(blacklist)}catch{deny('Invalid LOC blacklist')}
    }
    if(!blacklist||typeof blacklist!=='object'||Array.isArray(blacklist)||
      blacklist.email!==undefined&&!Array.isArray(blacklist.email))
      deny('LOC blacklist configuration unavailable');
    if((blacklist.email||[]).some(item=>
      String(item?.email||'').trim().toLowerCase()===state.email))
      return {blocked:true,rows:[]};
    const rows=await db.selectFrom('silver.manage')
      .select(['id','email','manage_role','active','galaxy_table','anchor_table','birthday'])
      .where(db.fn('lower',['email']),'=',state.email).execute();
    return {blocked:false,rows};
  })();
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
