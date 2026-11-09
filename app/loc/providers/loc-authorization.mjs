// The LOC OAuth identity is verified by the trusted Pages/Authority boundary.
// A database role or signed Scope grant alone is never a write permission.
import {isLocWriteOwner} from '../auth/delegation-contract.mjs';
const sessions=new WeakMap();
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC management permission denied'){
  throw Object.assign(new Error(message),{httpStatus:403});
}
export function bindLocAuthorization(db,{role='anon',claims={}}={}){
  if(!db||typeof db.selectFrom!=='function')throw new Error('Invalid Kysely transaction');
  if(role==='authenticated'&&(
    claims?.provider!=='loc'||claims?.me!==true||!SUBJECT.test(String(claims?.sub||''))||
    !EMAIL.test(String(claims?.email||'').trim().toLowerCase())))
    deny('Verified LOC delegation required');
  sessions.set(db,{role,claims,email:String(claims?.email||'').trim().toLowerCase()});
}
export async function locPermissions(db){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated'||!isLocWriteOwner(state.email))
    return {blocked:true,rows:[]};
  // Display metadata only, not a permission gate or blacklist check.
  const rows=await db.selectFrom('api.manage as m')
    .leftJoin('silver.loc as s','s.id','m.id')
    .select(['m.id','m.email','m.manage_role','m.active',
      'm.galaxy_table','m.anchor_table','s.birthday as birthday'])
    .where(db.fn('lower',['m.email']),'=',state.email).execute();
  return {blocked:false,rows};
}
export async function canManageLoc(db,type,id=''){
  const state=sessions.get(db);
  if(!state||state.role!=='authenticated'||!isLocWriteOwner(state.email))
    return false;
  const kind=String(type||'').toLowerCase(),scope=String(id||'').toLowerCase();
  return kind==='global'||(['scope','group'].includes(kind)&&SCOPE.test(scope));
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
