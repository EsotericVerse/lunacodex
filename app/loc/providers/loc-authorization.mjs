// LOC business authorization. Auth establishes identity; api.manage decides
// write rights in a separate business database lookup. The trusted backend
// binds only grants resolved from that table, never browser role assertions.
const sessions=new WeakMap();
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC management permission denied'){
  throw Object.assign(new Error(message),{httpStatus:403});
}
export function bindLocAuthorization(db,{role='anon',claims={},engine='postgres'}={}){
  if(!db||typeof db.selectFrom!=='function')throw new Error('Invalid Kysely transaction');
  if(role==='authenticated'&&(
    claims?.provider!=='loc'||claims?.me!==true||!SUBJECT.test(String(claims?.sub||''))||
    !EMAIL.test(String(claims?.email||'').trim().toLowerCase())||
    !Array.isArray(claims.grants)))
    deny('Verified LOC business role required');
  sessions.set(db,{role,claims,email:String(claims?.email||'').trim().toLowerCase()});
}
export async function locPermissions(db){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated')return {blocked:true,rows:[]};
  const rows=await db.selectFrom('api.manage as m')
    .leftJoin('silver.loc as s','s.id','m.id')
    .select(['m.id','m.email','m.manage_role','m.active',
      'm.galaxy_table','m.anchor_table','s.birthday as birthday'])
    .where(db.fn('lower',['m.email']),'=',state.email).execute();
  return {blocked:false,rows};
}
export async function canManageLoc(db,type,id='',registryRelation=null){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated')return false;
  const kind=String(type||'').toLowerCase(),scope=String(id||'').toLowerCase();
  if(!['global','scope','group'].includes(kind)||
     kind!=='global'&&!SCOPE.test(scope))return false;
  const claims=state.claims;
  // Email identity was already checked at the Auth boundary; permissions
  // were looked up in api.manage. Never repeat email/role policy here.
  if(claims?.provider!=='loc'||claims?.me!==true||!Array.isArray(claims.grants))
    return false;
  return claims.grants.includes('global:manage')||
    kind!=='global'&&claims.grants.includes(scope+':manage');
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
  const {blocked,rows}=await locPermissions(db);
  if(blocked)return [];
  const visible=rows.filter(row=>['admin','group','scope'].includes(row.manage_role));
  const mapped=[];
  for(const row of visible){
    const level=row.manage_role==='admin'?'global':row.manage_role;
    if(await canManageLoc(db,level,row.id))
      mapped.push({id:row.id,email:row.email,role:row.manage_role,
        galaxy:row.galaxy_table,anchor:row.anchor_table,birthday:row.birthday,allowed:true});
  }
  return mapped;
}
