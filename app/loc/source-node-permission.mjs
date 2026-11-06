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
  // Nodes may be displayed up or down the tree, regardless of edit rights.
  const edit=level<=1
    ?viewer==='loc'&&owner==='loc'&&canManageLoc===true
    :viewer!=='loc'&&viewer===owner&&canManageScope===true;
  return {read:true,edit};
}
export function assertSourceNodeWritePermission(input){
  if(!sourceNodePermission(input).edit)throw Error('Source Anchor ownership boundary denied');
}
