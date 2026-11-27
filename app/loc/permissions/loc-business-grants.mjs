// LOC business grants derived only from the published JS Manage registry.
// Identity is established by LOC Auth (never by this public projection).
// This module neither reads SQL nor makes any HTTP requests.
import {FIXED_MANAGE_ROWS} from './fixed-manage-registry.mjs';
import {LocAccessRowSchema} from './loc-access-schema.mjs';

const empty=()=>({canWrite:false,canManage:false,grants:[],roles:[]});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();
const owner=FIXED_MANAGE_ROWS.find(row=>row.id==='admin'&&row.manage_role==='admin');
export const LOC_OWNER_EMAIL=normalizedEmail(owner?.email);

// A website-only, inactive admin identity is a virtual owner and is NOT
// published as a navigable Scope or delegated to an external caller.
export function loc_access(email,rows=[],{website=false}={}){
  const verified=normalizedEmail(email);
  if(!verified||!Array.isArray(rows))return empty();
  const eligible=[];
  for(const row of rows){
    const virtualAdmin=website&&verified===LOC_OWNER_EMAIL&&row?.id==='admin'&&
      row?.manage_role==='admin'&&row?.active===false;
    if(row?.active!==true&&!virtualAdmin)continue;
    const parsed=LocAccessRowSchema.safeParse({
      id:String(row?.id||''),email:normalizedEmail(row?.email),
      manage_role:String(row?.manage_role||'').trim().toLowerCase(),
      active:row?.active
    });
    if(parsed.success&&parsed.data.email===verified)eligible.push(parsed.data);
  }
  if(!eligible.length)return empty();
  const admin=eligible.some(row=>row.manage_role==='admin')||
    eligible.some(row=>row.id==='loc'&&row.manage_role==='group');
  const grants=new Set(admin?['global:manage']:[]);
  for(const row of eligible){
    grants.add(row.id+':manage');
    if(row.manage_role==='group'||row.manage_role==='scope')
      grants.add(row.manage_role+':'+row.id+':manage');
    grants.add(row.id+':write');
    grants.add(row.id+':read');
  }
  return {canWrite:true,canManage:admin,grants:[...grants],
    roles:eligible.map(row=>({id:row.id,email:verified,role:row.manage_role}))};
}

// JS always wins. An identity absent from JS is ungranted, rather than
// falling back to an extra api.manage lookup during DB outages.
export function publishedLocAccess(email,{website=false}={}){
  return loc_access(email,FIXED_MANAGE_ROWS,{website});
}
