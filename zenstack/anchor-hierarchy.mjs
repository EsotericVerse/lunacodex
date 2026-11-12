// Virtual relationships over the FROZEN Anchor model, not SQL foreign keys.
// The physical table stays (uid,type,title,description,invisible,attr,createtime).
// Only trusted, already-scoped and already-authorized Anchor rows may enter.
// This module does no I/O, no authorization, no SQL JOIN and no UID ordering.
const UID=/^[A-Za-z0-9]{8}$/;
// These are the persisted semantic variants carried by the existing
// eight-column Anchor row.  Keep the vocabulary in one place so the
// hierarchy projection and the Kysely/Zod boundaries cannot silently drift.
export const ANCHOR_TYPE_GROUPS=Object.freeze({
  time:Object.freeze(['date','period','era']),
  space:Object.freeze(['point','path','trace']),
  media:Object.freeze(['image','video','rune','suno']),
  keyword:Object.freeze(['pattern','item','group','class','category']),
  source:Object.freeze(['from','domain','galaxy','universe'])
});
// The semantic Anchor payload is stored in the existing Anchor.attr JSON;
// these are the corresponding *article carrier* fields on <scope>_galaxy.
// Keeping this map explicit prevents a semantic ZModel from being mistaken
// for a new SQL table or from silently choosing a different physical field.
export const ANCHOR_GROUP_GALAXY_FIELDS=Object.freeze({
  time:Object.freeze(['date','createtime']),
  space:Object.freeze(['location','place_id']),
  media:Object.freeze(['media_link']),
  keyword:Object.freeze(['keyword']),
  source:Object.freeze(['site'])
});
export const PERSISTED_ANCHOR_TYPES=Object.freeze(Object.values(ANCHOR_TYPE_GROUPS)
  .flat());
// Anniversary is a derived editor suggestion. It is deliberately not a
// persisted discriminator and therefore is not included above.
export const VIRTUAL_ANCHOR_TYPES=Object.freeze(['anniversary','aniversary']);

// ZModel value types for the JSON payload carried by each discriminator. They
// are semantic projections, not extra SQL tables. Optional lists are valid in
// a value type because the nullable-list limitation only applies to physical
// SQL columns. Pattern postings remain dynamic JSON keyed by database UID.
export const ANCHOR_TYPE_MODEL_NAMES=Object.freeze({
  date:'DateAnchor',period:'PeriodAnchor',era:'EraAnchor',
  point:'PointAnchor',path:'PathAnchor',trace:'TraceAnchor',
  image:'ImageAnchor',video:'VideoAnchor',rune:'RuneAnchor',suno:'SunoAnchor',
  pattern:'PatternAnchor',item:'ItemAnchor',group:'GroupAnchor',
  class:'ClassAnchor',category:'CategoryAnchor',
  from:'FromAnchor',domain:'DomainAnchor',galaxy:'GalaxyAnchor',universe:'UniverseAnchor'
});
export const ANCHOR_GROUP_MODEL_NAMES=Object.freeze({
  time:'TimeAnchor',space:'LocationAnchor',media:'MediaAnchor',
  keyword:'KeywordAnchor',source:'SiteAnchor'
});
export const ANCHOR_TYPE_GROUP_FIELDS=Object.freeze({
  date:'date',period:'period',era:'era',
  point:'point',path:'path',trace:'trace',
  image:'images',video:'video',rune:'runes',suno:'suno',
  pattern:'pattern',item:'item',group:'group',class:'class',category:'category',
  from:'from',domain:'domain',galaxy:'galaxy',universe:'universe'
});
export const VIRTUAL_ANCHOR_TYPE_MODEL_NAMES=Object.freeze({
  anniversary:'AnniversarySuggestion',aniversary:'AnniversarySuggestion'
});
export const ANCHOR_TYPE_PROJECTIONS=Object.freeze(Object.fromEntries(
  Object.entries(ANCHOR_TYPE_GROUPS).flatMap(([group,types])=>types.map(type=>[
    type,Object.freeze({group,modelName:ANCHOR_GROUP_MODEL_NAMES[group],
      payloadModelName:ANCHOR_TYPE_MODEL_NAMES[type],
      groupField:ANCHOR_TYPE_GROUP_FIELDS[type],
      galaxyFields:ANCHOR_GROUP_GALAXY_FIELDS[group]})
  ]))
));
export const ANCHOR_PAYLOAD_DEFS=Object.freeze({
  DateAnchor:{date:{type:'String'}},
  PeriodAnchor:{uid:{type:'String',array:true,optional:true},date:{type:'String',array:true,optional:true}},
  EraAnchor:{period:{type:'String',array:true,optional:true},date:{type:'String',array:true,optional:true}},
  PointAnchor:{longitude:{type:'Float',optional:true},latitude:{type:'Float',optional:true},
    location:{type:'String',optional:true},times:{type:'String',array:true,optional:true}},
  PathAnchor:{point:{type:'String',array:true,optional:true}},
  TraceAnchor:{point:{type:'String',array:true,optional:true},path:{type:'String',array:true,optional:true}},
  ImageAnchor:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  VideoAnchor:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  RuneAnchor:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  SunoAnchor:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  PatternAnchor:{postings:{type:'Json',optional:true}},
  ItemAnchor:{keyword:{type:'String',array:true,optional:true},uid:{type:'String',array:true,optional:true},total:{type:'Int',optional:true}},
  GroupAnchor:{uid:{type:'String',array:true,optional:true}},
  ClassAnchor:{uid:{type:'String',array:true,optional:true}},
  CategoryAnchor:{uid:{type:'String',array:true,optional:true}},
  FromAnchor:{uid:{type:'String',array:true,optional:true}},
  DomainAnchor:{uid:{type:'String',array:true,optional:true}},
  GalaxyAnchor:{uid:{type:'String',array:true,optional:true}},
  UniverseAnchor:{uid:{type:'String',array:true,optional:true}},
  AnniversarySuggestion:{date:{type:'String'},years:{type:'Int'},sourceUid:{type:'String',optional:true},title:{type:'String'}},
  TimeAnchor:{date:{type:'DateAnchor',optional:true},period:{type:'PeriodAnchor',optional:true},
    era:{type:'EraAnchor',optional:true},anniversary:{type:'AnniversarySuggestion',optional:true}},
  LocationAnchor:{point:{type:'PointAnchor',optional:true},path:{type:'PathAnchor',optional:true},
    trace:{type:'TraceAnchor',optional:true}},
  MediaAnchor:{images:{type:'ImageAnchor',optional:true},video:{type:'VideoAnchor',optional:true},
    suno:{type:'SunoAnchor',optional:true},runes:{type:'RuneAnchor',optional:true}},
  KeywordAnchor:{pattern:{type:'PatternAnchor',optional:true},item:{type:'ItemAnchor',optional:true},
    group:{type:'GroupAnchor',optional:true},class:{type:'ClassAnchor',optional:true},
    category:{type:'CategoryAnchor',optional:true}},
  SiteAnchor:{from:{type:'FromAnchor',optional:true},domain:{type:'DomainAnchor',optional:true},
    galaxy:{type:'GalaxyAnchor',optional:true},universe:{type:'UniverseAnchor',optional:true}},
  LRunes66:{rune_id:{type:'Int'},rune_name:{type:'String',optional:true},
    english_name:{type:'String',optional:true},totem:{type:'String',optional:true},
    group_name:{type:'String',optional:true},moon_phase:{type:'Int',optional:true},
    card_attr:{type:'Int',optional:true},rune_description:{type:'String',optional:true},
    archetype:{type:'String',optional:true},char_action:{type:'String',optional:true},
    positive_keywords:{type:'String',optional:true},negative_keywords:{type:'String',optional:true},
    extra_rules:{type:'String',optional:true},extra_notes:{type:'String',optional:true},
    positive_meaning:{type:'String',optional:true},half_positive_meaning:{type:'String',optional:true},
    half_reverse_meaning:{type:'String',optional:true},reverse_meaning:{type:'String',optional:true},
    rune_evolution_history:{type:'String',optional:true},myth_story:{type:'String',optional:true},
    soul_question:{type:'String',optional:true},practice_challenge:{type:'String',optional:true},
    ritual_advice:{type:'String',optional:true},harmony_advice:{type:'String',optional:true},
    class_enable:{type:'Boolean',optional:true}}
});

const FAMILY_DEFS=Object.freeze({
  keyword:{
    root:'category',
    edges:{category:{uid:'class'},class:{uid:'group'},group:{uid:'item'},item:{uid:'pattern'},pattern:{}}
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
        if(family!=='space'&&!(family==='keyword'&&childType==='pattern')&&incoming.has(uid))
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
