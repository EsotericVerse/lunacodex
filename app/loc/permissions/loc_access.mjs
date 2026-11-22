// Single LOC business-access projection. LOC Auth verifies identity; the
// existing physical api.manage Registry and its fixed ZenStack Manage model
// define roles. This is not a new table, token issuer, or SQL endpoint.
// LOC Web owns these grants; LOC Auth identity must never be treated as a Web role.
import {ZenStackClient} from '@zenstackhq/orm';
import {PolicyPlugin} from '@zenstackhq/plugin-policy';
import {fixedPolicyReader} from '../../../packages/zenstack/policy-runtime.mjs';
import {locRolePrincipal,LOC_ROLE_LEVEL} from '../../../packages/zenstack/role-hierarchy.mjs';
import {LocAccessRowSchema} from './loc-access-schema.mjs';
import {FIXED_MANAGE_ROWS} from './fixed-manage-registry.mjs';

export const LOC_OWNER_EMAIL=FIXED_MANAGE_ROWS.find(row=>row.manage_role==='admin')?.email||'';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const empty=()=>({canWrite:false,canManage:false,grants:[],roles:[]});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();

// Pure ZModel-derived Zod projection. An unpublished virtual System Admin
// record remains a website-owner role; it never publishes an /admin Scope.
// MCP and every other inactive Scope/Group record remain ungranted.
export function loc_access(email,rows=[],{website=false}={}){
  const verified=normalizedEmail(email);
  if(!verified||!Array.isArray(rows))
    return empty();
  const eligible=[];
  for(const row of rows){
    const virtualAdmin=website&&verified===LOC_OWNER_EMAIL&&row?.id==='admin'&&
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
    // Role-qualified grants preserve the ZModel level, not just resource ID.
    if(row.manage_role==='group'||row.manage_role==='scope')
      grants.add(row.manage_role+':'+row.id+':manage');
    grants.add(row.id+':write');
    grants.add(row.id+':read');
  }
  return {canWrite:true,canManage:admin,grants:[...grants],
    roles:eligible.map(row=>({id:row.id,email:verified,role:row.manage_role}))};
}

// The published JS Registry is the PRIMARY business permission source.
// The caller must first verify LOC Auth identity; neither an email supplied by
// a browser nor this public JS file is an authentication credential.
// A verified identity present in JS never issues a Registry SQL query.
export function publishedLocAccess(email,{website=false}={}){
  const verified=normalizedEmail(email);
  if(!verified)return {found:false,rights:empty()};
  const rows=FIXED_MANAGE_ROWS.filter(row=>normalizedEmail(row.email)===verified);
  return {found:rows.length>0,rights:loc_access(verified,rows,{website})};
}

// SQL is reserved for identities not represented by the published JS snapshot.
// No DB connection or SQL dialect is required for a published identity, even
// when that identity is authorizing a separate, already-open write transaction.
export async function readLocAccess(db,email,{dialect,engine='postgres',website=false,transactional=false}={}){
  const verified=normalizedEmail(email);
  if(!verified)return empty();
  const published=publishedLocAccess(verified,{website});
  if(published.found)return published.rights;
  if(!db||typeof db.selectFrom!=='function')
    throw new Error('LOC permission database unavailable');
  if(website&&engine==='postgres'&&!dialect&&!transactional)
    throw new Error('LOC website ZModel policy dialect unavailable');
  const rows=engine==='postgres'&&dialect&&!transactional
    ?await fixedPolicyReader(db,{dialect,ZenStackClient,PolicyPlugin})
      .manage.findMany({
        where:{email:verified,...(website?{}:{active:true})},
        select:{id:true,email:true,manage_role:true,active:true}
      })
    :await (()=>{
      let query=db.selectFrom('api.manage')
        .select(['id','email','manage_role','active'])
        .where(db.fn('lower',['email']),'=',verified);
      if(!website)query=query.where('active','=',true);
      return query.execute();
    })();
  // JS-listed rows are authoritative; an unlisted database row must never
  // override a published identity with the same Scope ID.
  return loc_access(verified,rows.filter(row=>
    !FIXED_MANAGE_ROWS.some(entry=>entry.id===row.id)),{website});
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
  if(kind==='global')return false;
  return kind==='group'?principal.groupIds.includes(scope):
    principal.groupIds.includes(scope)||principal.scopeIds.includes(scope);
}
