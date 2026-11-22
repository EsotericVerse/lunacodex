import {sourceTaxonomyFromAnchors} from './classification.mjs';

// All source UIs traverse the same hierarchy projected from
// silver.loc_anchor.attr.uid: Universe → Galaxy → Domain → From (site).
// A node is never replaced by its single child or inferred from a title.
export function sourceOutlineOptions(taxonomy){
  const rootOrder=new Map([['Words',0],['Mutlimedia',1],['PastBy',2]]);
  const rank=node=>rootOrder.get(node.universe||node.title)??100;
  // The canonical taxonomy already follows the persisted UID child order.
  // Stable sorting only places the three Universe subtrees in UI order.
  return [...(taxonomy?.tree||[])].sort((a,b)=>rank(a)-rank(b)).map(node=>({
    key:node.root+':'+node.uid,
    code:node.uid,
    root:node.root,
    type:node.type,
    label:node.title,
    level:Math.max(0,(node.path||[]).length-1),
    path:node.path||[]
  }));
}

// Editors retain invisible nodes in their hierarchy; public views filter
// them out in sourceTaxonomyFromAnchors' default mode.
export function sourceEditorOutlineOptions(anchorRows=[]){
  return sourceOutlineOptions(sourceTaxonomyFromAnchors(anchorRows,{includeHidden:true}));
}
