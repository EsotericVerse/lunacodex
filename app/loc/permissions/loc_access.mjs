// Single LOC business-access projection. LOC Auth verifies identity; the
// existing physical api.manage Registry and its fixed ZenStack Manage model
// define roles. This is not a new table, token issuer, or SQL endpoint.
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {fixedPolicyReader} from '../../../zenstack/policy-runtime.mjs';
import {locRolePrincipal,LOC_ROLE_LEVEL} from '../../../zenstack/role-hierarchy.mjs';
import {LocAccessRowSchema} from './loc-access-schema.mjs';

export const LOC_OWNER_EMAIL='sopa2306@gmail.com';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const empty=()=>({canWrite:false,canManage:false,grants:[],roles:[]});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();

// Pure ZModel-derived Zod projection. An unpublished virtual System Admin
// record remains a website-owner role; it never publishes an /admin Scope.
// MCP and every other inactive Scope/Group record remain ungranted.
export function loc_access(email,rows=[],{website=false}={}){
  const verified=normalizedEmail(email);
  if(!verified||!Array.isArray(rows)||website&&verified!==LOC_OWNER_EMAIL)
    return empty();
  const eligible=[];
  for(const row of rows){
    const virtualAdmin=website&&row?.id==='admin'&&
      row?.manage_role==='admin'&&row?.active===false;
    if(row?.active!==true&&!virtualAdmin)continue;
    const parsed=LocAccessRowSchema.safeParse({
      id:String(row?.id||''),
      email:normalizedEmail(row?.email),
      manage_role:String(row?.manage_role||'').trim().toLowerCase(),
      active:row?.active
    });
    if(parsed.success&&parsed.data.email===verified)eligible.push(parsed.data);
  }
  if(!eligible.length)return empty();
  const admin=eligible.some(row=>row.manage_role==='admin');
  const grants=new Set(admin?['global:manage']:[]);
  for(const row of eligible){
    grants.add(row.id+':manage');
    grants.add(row.id+':write');
    grants.add(row.id+':read');
  }
  return {canWrite:true,canManage:admin,grants:[...grants],
    roles:eligible.map(row=>({id:row.id,email:verified,role:row.manage_role}))};
}

// Shared trusted read: PostgreSQL uses ZenStack's actual Manage delegate and
// PolicyPlugin over the existing Kysely dialect. Dialects without a supported
// ZenStack provider retain the bounded portable Kysely SELECT; no new pool,
// SQL migration, polling or duplicate role read is created.
export async function readLocAccess(db,email,{dialect,engine='postgres',website=false}={}){
  if(!db||typeof db.selectFrom!=='function')
    throw new Error('LOC permission database unavailable');
  const verified=normalizedEmail(email);
  if(!verified||website&&verified!==LOC_OWNER_EMAIL)return empty();
  // Website PostgreSQL authorization must use the ZModel PolicyPlugin;
  // never silently downgrade to an unchecked SQL read on a missing dialect.
  if(website&&engine==='postgres'&&!dialect)
    throw new Error('LOC website ZModel policy dialect unavailable');
  const columns=['id','email','manage_role','active'];
  const rows=engine==='postgres'&&dialect
    ?await fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin})
      .manage.findMany({
        where:{email:verified,...(website?{}:{active:true})},
        select:{id:true,email:true,manage_role:true,active:true}
      })
    :await (()=>{
      let query=db.selectFrom('api.manage').select(columns)
        .where(db.fn('lower',['email']),'=',verified);
      if(!website)query=query.where('active','=',true);
      return query.execute();
    })();
  return loc_access(verified,rows,{website});
}

// Existing trusted Gateway grants are projected into the SAME ZModel
// LocPrincipal role hierarchy. A Group grant never becomes global Admin;
// Scope/Group grants still require their exact server-issued resource ID.
export function hasLocAccess(claims,type,id=''){
  const kind=String(type||'').toLowerCase();
  const scope=String(id||'').toLowerCase();
  if(!['global','group','scope'].includes(kind)||
      kind!=='global'&&!SCOPE.test(scope))return false;
  const principal=locRolePrincipal(claims);
  if(!principal)return false;
  if(principal.roleLevel>=LOC_ROLE_LEVEL.admin)return true;
  return kind!=='global'&&Array.isArray(claims.grants)&&
    claims.grants.includes(scope+':manage');
}
