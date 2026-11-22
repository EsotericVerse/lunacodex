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
    // Show its real ZModel tier even when the parent Anchor is absent.
    level:Number.isInteger(node.level)?node.level:Math.max(0,(node.path||[]).length-1),
    orphanType:node.orphanType||null,
    path:node.path||[]
  }));
}

// Presentation groups are never inferred from the name. A disconnected
// Galaxy/Domain/From appears under the matching 未分類 section and keeps its
// actual type/UID; it is never promoted to Universe or flattened as a peer.
export function groupedSourceOutline(taxonomy={}){
  const options=sourceOutlineOptions(taxonomy);
  const groups=[];
  for(const universe of options.filter(node=>node.type==='universe'&&!node.orphanType))
    groups.push({key:universe.code,label:universe.label,
      items:options.filter(row=>row.path[0]===universe.code)});
  for(const type of ['galaxy','domain','from']){
    const orphan=options.filter(row=>row.orphanType===type);
    if(orphan.length)groups.push({key:'unclassified:'+type,
      label:'未分類 '+({galaxy:'Galaxy',domain:'Domain',from:'From'}[type]),
      items:orphan});
  }
  return groups;
}

// Editors retain invisible nodes in their hierarchy; public views filter
// them out in sourceTaxonomyFromAnchors' default mode.
export function sourceEditorOutlineOptions(anchorRows=[]){
  return sourceOutlineOptions(sourceTaxonomyFromAnchors(anchorRows,{includeHidden:true}));
}
