// Source selectors share LocAnchor's authoritative Universe/Galaxy/Domain/From
// hierarchy. Category codes are the existing case-sensitive Anchor UIDs.
export function sourceKeywordOptions(taxonomy){
  return (taxonomy?.categories||[]).filter(row=>row.enabled!==false).map(row=>{
    const root=row.root||'system';
    const path=[row.universe,row.galaxy,...(row.type==='from'?[row.domain]:[])]
      .filter(Boolean).join(' / ');
    return {
      key:root+':'+row.category_code,
      code:row.category_code,
      root,
      domain:path,
      type:row.type||'from',
      label:row.display_name||row.category_code
    };
  });
}

// Culture's four-level outline uses the canonical UID path of EVERY saved
// Source node. Each option is one node, never a flattened "CMS / Facebook"
// label or an inferred Source hierarchy. Statistics keeps its existing
// Domain/From-only selectors above.
export function sourceOutlineOptions(taxonomy){
  const rootOrder=new Map([['Words',0],['Mutlimedia',1],['PastBy',2]]);
  const rank=node=>rootOrder.get(node.universe||node.title)??100;
  // Stable sort reorders ONLY the three Universe subtrees; each stored UID
  // child order stays unchanged within its own ancestor.
  return [...(taxonomy?.tree||[])].sort((a,b)=>rank(a)-rank(b)).map(node=>({
    key:node.root+':'+node.uid,code:node.uid,
    root:node.root,type:node.type,label:node.title,
    level:Math.max(0,(node.path||[]).length-1),
    path:node.path||[]
  }));
}
