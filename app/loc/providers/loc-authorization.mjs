// Trusted transaction-bound LOC business authorization. LOC Auth identifies
// the user; the single ZModel-backed loc_access projection grants resources.
import {hasLocAccess} from '../permissions/loc_access.mjs';
import {LocAccessRowSchema} from '../permissions/loc-access-schema.mjs';

const sessions=new WeakMap();
const SUBJECT=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function deny(message='LOC access denied'){
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

// One scope-aware predicate for all providers, using the ZModel LocPrincipal.
// Global, Group and Scope are never inferred from publication or page routes.
export function canLocAccess(db,type,id=''){
  const state=sessions.get(db);
  return Boolean(state?.role==='authenticated'&&hasLocAccess(state.claims,type,id));
}

export async function locAccessRows(db,type,id=null){
  const kind=String(type||'').toLowerCase(),scope=id==null?'':String(id).toLowerCase();
  if(!['self','global','group','scope'].includes(kind)||(
    ['group','scope'].includes(kind)&&!SCOPE.test(scope)))
    throw Object.assign(new Error('Invalid LOC access type or Scope'),{httpStatus:400});
  if(kind!=='self')return [{
    id:scope,email:null,role:kind,galaxy:null,anchor:null,birthday:null,
    allowed:canLocAccess(db,kind,scope)
  }];
  const state=sessions.get(db);
  if(state?.role!=='authenticated')return [];
  const rows=await db.selectFrom('api.manage as m')
    .leftJoin('silver.loc as s','s.id','m.id')
    .select(['m.id','m.email','m.manage_role','m.active',
      'm.galaxy_table','m.anchor_table','s.birthday as birthday'])
    .where(db.fn('lower',['m.email']),'=',state.email).execute();
  return rows.flatMap(row=>{
    const parsed=LocAccessRowSchema.safeParse({
      id:row?.id,email:String(row?.email||'').trim().toLowerCase(),
      manage_role:row?.manage_role,active:row?.active
    });
    if(!parsed.success)return [];
    const level=parsed.data.manage_role==='admin'?'global':parsed.data.manage_role;
    if(!canLocAccess(db,level,row.id))return [];
    return [{id:row.id,email:row.email,role:parsed.data.manage_role,
      galaxy:row.galaxy_table,anchor:row.anchor_table,
      birthday:row.birthday,allowed:true}];
  });
}
