import {WebManageRowSchema} from './web-manage-schema.mjs';

// LOC authorization is a business-data decision, NOT an Auth subsystem.
// The Web business database is the role source. Its fixed ZModel and Zod
// validators are separate from the LOC Auth identity and Session model.
export const LOC_OWNER_EMAIL='sopa2306@gmail.com';
// One existing ZModel-derived Zod role projection for both the website and
// MCP/Extension. Whether a caller may use it is decided at its own boundary.
export function resolveManagePermissions(email,rows=[]){
  const verified=String(email||'').trim().toLowerCase();
  const denied={canWrite:false,canManage:false,grants:[],roles:[]};
  if(!Array.isArray(rows))return denied;
  const active=rows.flatMap(row=>{
    // A defaulted ZModel Boolean must never turn a missing active flag
    // into an authorization grant.
    if(row?.active!==true)return [];
    const validated=WebManageRowSchema.safeParse({
      id:String(row?.id||''),
      email:String(row?.email||'').trim().toLowerCase(),
      manage_role:String(row?.manage_role||'').trim().toLowerCase(),
      active:row?.active
    });
    return validated.success&&validated.data.active&&validated.data.email===verified
      ?[validated.data]:[];
  });
  if(!active.length)return denied;
  // manage_role has already been narrowed by the generated ZModel/Zod
  // enum; do not maintain another handwritten list of permitted roles.
  const isAdmin=active.some(row=>row.manage_role==='admin');
  const grants=active.flatMap(row=>[
    row.id+':manage',row.id+':write',row.id+':read']);
  if(isAdmin)grants.unshift('global:manage');
  const roles=active.map(row=>({
    id:row.id,email:verified,role:row.manage_role
  }));
  return {canWrite:grants.length>0,canManage:isAdmin,
    grants:[...new Set(grants)],roles};
}
// The existing website owner-only policy remains unchanged. MCP uses the
// independently authorized projection above, never this owner-only gate.
export function resolveLocPermissions(email,rows=[]){
  const verified=String(email||'').trim().toLowerCase();
  return verified===LOC_OWNER_EMAIL?resolveManagePermissions(verified,rows):
    {canWrite:false,canManage:false,grants:[],roles:[]};
}

export async function locPermissionsForEmail(db,verifiedEmail,{policyClient}={}){
  if((!db||typeof db.selectFrom!=='function')&&!policyClient)
    throw Error('LOC permission database unavailable');
  if(String(verifiedEmail||'').trim().toLowerCase()!==LOC_OWNER_EMAIL)
    return resolveLocPermissions(verifiedEmail,[]);
  const roles=policyClient
    ?await policyClient.manage.findMany({
      where:{email:LOC_OWNER_EMAIL,active:true},
      select:{id:true,email:true,manage_role:true,active:true}
    })
    :await db.selectFrom('api.manage')
      .select(['id','email','manage_role','active'])
      .where('email','=',LOC_OWNER_EMAIL)
      .where('active','=',true)
      .execute();
  return resolveLocPermissions(verifiedEmail,roles);
}
