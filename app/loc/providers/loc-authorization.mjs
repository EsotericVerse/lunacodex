// LOC OAuth verifies the person. The signed delegation and api.manage
// determine database management authority; neither a client email nor a
// database role alone authorizes a write.
const sessions=new WeakMap();
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC management permission denied'){
  throw Object.assign(new Error(message),{httpStatus:403});
}
export function bindLocAuthorization(db,{role='anon',claims={}}={}){
  if(!db||typeof db.selectFrom!=='function')throw new Error('Invalid Kysely transaction');
  if(role==='authenticated'&&(
    claims?.provider!=='loc'||claims?.me!==true||!SUBJECT.test(String(claims?.sub||''))||
    !EMAIL.test(String(claims?.email||'').trim().toLowerCase())||
    !Array.isArray(claims.grants)))
    deny('Verified LOC delegation required');
  sessions.set(db,{role,claims,email:String(claims?.email||'').trim().toLowerCase(),registry:null});
}
async function registryFor(db,state){
  if(!state.registry)state.registry=db.selectFrom('api.manage')
    .select(['id','manage_role','active'])
    .where(db.fn('lower',['email']),'=',state.email).execute();
  return state.registry;
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
export async function canManageLoc(db,type,id=''){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated')return false;
  const kind=String(type||'').toLowerCase(),scope=String(id||'').toLowerCase();
  if(!['global','scope','group'].includes(kind)||
     kind!=='global'&&!SCOPE.test(scope))return false;
  const grants=state.claims.grants;
  const rows=await registryFor(db,state);
  // Admin must come from the database, AND LOC Auth must have signed
  // the global grant. An inactive scope never becomes an implicit permission.
  const admin=grants.includes('global:manage')&&rows.some(row=>
    row.manage_role==='admin'&&row.active===true);
  if(admin)return true;
  if(kind==='global'||!grants.includes(scope+':manage'))return false;
  return rows.some(row=>row.id===scope&&row.active===true&&
    (row.manage_role===kind||kind==='scope'&&row.manage_role==='admin'));
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
