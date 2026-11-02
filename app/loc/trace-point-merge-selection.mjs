// Selection rules shared by the management UI and its regression tests.
// Base62 UIDs are case-sensitive; source rows must remain in the same Scope.
export function selectPointMergeSources(anchors,primary,selected,{visibilityPending=false}={}){
  if(!primary||visibilityPending)return [];
  const valid=new Set((anchors||[]).map(row=>String(row.uid||'')));
  return [...new Set(selected||[])].filter(uid=>uid!==primary&&valid.has(uid));
}
