// Virtual relationships over the FROZEN Anchor model, not SQL foreign keys.
// The physical table stays (uid,type,title,description,invisible,attr,createtime).
// Only trusted, already-scoped and already-authorized Anchor rows may enter.
// This module does no I/O, no authorization, no SQL JOIN and no UID ordering.
const UID=/^[A-Za-z0-9]{8}$/;
const FAMILY_DEFS=Object.freeze({
  keyword:{
    root:'category',
    edges:{category:{uid:'class'},class:{uid:'group'},group:{uid:'item'},item:{}}
  },
  source:{
    root:'universe',
    edges:{universe:{uid:'galaxy'},galaxy:{uid:'domain'},domain:{uid:'from'},from:{}}
  },
  time:{
    root:'era',
    edges:{era:{period:'period'},period:{uid:'date'},date:{}}
  },
  space:{
    root:'trace',
    // Trace may directly reference Point as well as Path; it is a DAG,
    // unlike Keyword/Source/Time. Do not infer coordinates or visits.
    edges:{trace:{path:'path',point:'point'},path:{point:'point'},point:{}}
  }
});
export const ANCHOR_HIERARCHY_FAMILIES=Object.freeze(Object.keys(FAMILY_DEFS));

function attrOf(row){
  const raw=typeof row?.attr==='string'?JSON.parse(row.attr):row?.attr;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Anchor attr must be a JSON object');
  return raw;
}
function linksOf(node,key){
  const data=node.attr[key];
  if(data==null)return [];
  if(!Array.isArray(data)||data.some(uid=>typeof uid!=='string'||!UID.test(uid))||
     new Set(data).size!==data.length)
    throw new Error('Anchor '+node.uid+' attr.'+key+' must contain unique Base62 UIDs');
  return data;
}

/**
 * Resolve one hierarchy from a caller-supplied set of already authorized
 * Anchor rows. The returned object is a read-only relationship *projection*;
 * it does not manufacture SQL permissions, request missing rows, fetch Galaxy
 * articles or compute culture/statistics counts.
 *
 * strict=false supports bounded/partially loaded nodes: unresolved links are
 * reported, never assumed to be nonexistent. Set strict=true when validating
 * an intentionally complete hierarchy.
 */
export function indexZModelAnchorHierarchy(rows,{family,strict=false}={}){
  const def=FAMILY_DEFS[family];
  if(!def||!Array.isArray(rows))
    throw new Error('Unknown or invalid ZModel Anchor hierarchy');
  const nodes=new Map(),children=new Map(),incoming=new Map();
  for(const row of rows){
    const type=String(row?.type||'');
    if(!Object.hasOwn(def.edges,type))continue;
    const uid=String(row?.uid||'');
    if(!UID.test(uid)||nodes.has(uid))
      throw new Error('Invalid or repeated Anchor UID: '+uid);
    nodes.set(uid,{uid,type,title:String(row?.title||''),attr:attrOf(row)});
  }
  const unresolved=[],relations=[];
  for(const node of nodes.values()){
    const edges=def.edges[node.type];
    for(const [key,childType] of Object.entries(edges)){
      for(const uid of linksOf(node,key)){
        const child=nodes.get(uid);
        relations.push(Object.freeze({
          family,fromUid:node.uid,toUid:uid,
          fromType:node.type,toType:childType,attrKey:key,
          resolved:Boolean(child)
        }));
        if(!child){unresolved.push({from:node.uid,uid,type:childType});continue;}
        if(child.type!==childType)
          throw new Error('Invalid Anchor hierarchy ('+family+'): '+node.type+' -> '+child.type);
        if(family!=='space'&&incoming.has(uid))
          throw new Error('Anchor node has multiple parents: '+uid);
        if(!children.has(node.uid))children.set(node.uid,[]);
        children.get(node.uid).push(uid);
        if(!incoming.has(uid))incoming.set(uid,[]);
        incoming.get(uid).push(node.uid);
      }
    }
  }
  if(strict&&unresolved.length)
    throw new Error('Incomplete '+family+' Anchor references: '+unresolved.length);
  const roots=[...nodes.values()].filter(node=>node.type===def.root&&!incoming.has(node.uid))
    .map(node=>node.uid);
  const missingByParent=new Map();
  for(const ref of unresolved){
    if(!missingByParent.has(ref.from))missingByParent.set(ref.from,[]);
    missingByParent.get(ref.from).push(ref);
  }
  function descendants(uid,{type=null,includeSelf=true}={}){
    if(!UID.test(String(uid||''))||!nodes.has(uid))
      throw new Error('Unknown Anchor root UID');
    if(type&&!Object.hasOwn(def.edges,String(type)))
      throw new Error('Invalid Anchor descendant type');
    const seen=new Set(),queue=[uid],selected=[],missing=[];
    for(let i=0;i<queue.length;i++){
      const current=queue[i];
      if(seen.has(current))continue;
      seen.add(current);
      const node=nodes.get(current);
      if((includeSelf||current!==uid)&&(!type||node.type===type))
        selected.push(current);
      for(const link of missingByParent.get(current)||[])missing.push({...link});
      for(const child of children.get(current)||[])queue.push(child);
    }
    // Missing edges mean this projection cannot assert a complete subtree.
    return {uids:selected,missing,complete:missing.length===0};
  }
  return Object.freeze({
    family,kind:family,rootType:def.root,
    nodeCount:nodes.size,roots,
    missing:unresolved.map(ref=>({...ref})),
    // Returned on demand to avoid changing existing tree consumers.
    // References are local to this caller-supplied database+Scope partition.
    links(){return [...relations];},
    descendants,
    childrenOf(uid){return [...(children.get(uid)||[])];},
    parentsOf(uid){return [...(incoming.get(uid)||[])];}
  });
}
