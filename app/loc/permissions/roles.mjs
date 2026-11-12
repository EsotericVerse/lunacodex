import {WebManageRowSchema} from './web-manage-schema.mjs';

// LOC authorization is a business-data decision, NOT an Auth subsystem.
// Better Auth establishes identity; this function reads the existing role
// table with Kysely. Neither the website nor its public readers call it.
export const LOC_OWNER_EMAIL='sopa2306@gmail.com';
export function resolveLocPermissions(email,rows=[]){
  const verified=String(email||'').trim().toLowerCase();
  const denied={canWrite:false,canManage:false,grants:[],roles:[]};
  if(verified!==LOC_OWNER_EMAIL||!Array.isArray(rows))return denied;
  const active=rows.flatMap(row=>{
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
  const isAdmin=active.some(row=>String(row.manage_role||'').toLowerCase()==='admin');
  const grants=active.filter(row=>['admin','group','scope'].includes(
    String(row.manage_role||'').toLowerCase())).flatMap(row=>[
      row.id+':manage',row.id+':write',row.id+':read']);
  if(isAdmin)grants.unshift('global:manage');
  const roles=active.filter(row=>['admin','group','scope'].includes(
    String(row.manage_role||'').toLowerCase())).map(row=>({
      id:row.id,email:verified,role:String(row.manage_role).toLowerCase()
    }));
  return {canWrite:grants.length>0,canManage:isAdmin,
    grants:[...new Set(grants)],roles};
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
