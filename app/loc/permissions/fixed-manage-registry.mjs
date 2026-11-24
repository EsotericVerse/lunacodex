// LOC's published fixed api.manage records (Neon production snapshot, 2026-11-22).
// One JS definition for the four built-in Registry identities.  These are
// public contact / routing / display settings, never credentials or tokens.
// Do not use this unverified public projection as a login/session assertion.
// Legacy SQL columns caches/note are intentionally omitted: they are not
// fixed Scope identity, routing, or permission fields.
// Dynamic Scope metadata may be stored in SQL; authorization grants remain
// controlled by this published JavaScript registry.
export const FIXED_MANAGE_ROWS=Object.freeze([
  Object.freeze({
    id:'admin',email:'sopa2306@gmail.com',domain:null,directory:null,
    parent_scope_id:null,active:false,sort_order:-100,manage_role:'admin',
    galaxy_table:'galaxy',anchor_table:'anchor'
  }),
  Object.freeze({
    id:'loc',email:'sopa2306@gmail.com',domain:'loc.lo3rwang.cc',
    directory:null,parent_scope_id:null,active:true,sort_order:0,
    manage_role:'group',galaxy_table:'galaxy',anchor_table:'anchor'

  }),
  Object.freeze({
    id:'lo3rwang',email:'sopa2306@gmail.com',domain:null,
    directory:'/lo3rwang',parent_scope_id:'loc',active:true,sort_order:10,
    manage_role:'scope',galaxy_table:'galaxy',anchor_table:'anchor'

  }),
  Object.freeze({
    id:'lrunes',email:'sopa2306@gmail.com',domain:'lrunes.lo3rwang.cc',
    directory:null,parent_scope_id:'loc',active:true,sort_order:10,
    manage_role:'scope',galaxy_table:'galaxy',anchor_table:'anchor'

  })
]);
export const FIXED_MANAGE_BY_ID=new Map(FIXED_MANAGE_ROWS.map(row=>[row.id,row]));
export function fixedManageScope(scope){
  return FIXED_MANAGE_BY_ID.get(String(scope||''))||null;
}
export function fixedManageGrants(email,{website=false}={}){
  const normalized=String(email||'').trim().toLowerCase();
  return FIXED_MANAGE_ROWS.filter(row=>
    row.email===normalized&&
    (row.active===true||website&&row.id==='admin'&&row.manage_role==='admin')
  );
}
