// Source hierarchy ownership is determined by the Anchor node level,
// never by where the graph happens to be displayed.
// LOC manages its own upper levels; each Scope manages its own lower levels.
export const SOURCE_HIERARCHY=Object.freeze(['universe','galaxy','domain','from']);
export function sourceNodePermission({viewerScopeId,nodeType,nodeScopeId,canManageLoc=false,canManageScope=false}={}){
  const level=SOURCE_HIERARCHY.indexOf(String(nodeType||''));
  if(level<0)return {read:false,edit:false};
  const viewer=String(viewerScopeId||'').toLowerCase();
  const owner=String(nodeScopeId||'').toLowerCase();
  if(!viewer||!owner)return {read:false,edit:false};
  // LOC sees the entire source tree. A Scope sees only its own branch and LOC ancestors.
  const read=viewer==='loc'||(level<=1?owner==='loc':owner===viewer);
  const edit=read&&(level<=1
    ?viewer==='loc'&&owner==='loc'&&canManageLoc===true
    :viewer!=='loc'&&viewer===owner&&canManageScope===true);
  return {read,edit};
}
export function assertSourceNodeWritePermission(input){
  if(!sourceNodePermission(input).edit)throw Error('Source Anchor ownership boundary denied');
}
