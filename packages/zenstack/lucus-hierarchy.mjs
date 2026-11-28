// Virtual relationships over the FROZEN Anchor model, not SQL foreign keys.
// The physical table stays (uid,type,title,description,invisible,attr,createtime,num).
// Only trusted, already-scoped and already-authorized Anchor rows may enter.
// This module does no I/O, no authorization, no SQL JOIN and no UID ordering.
// Anchor.invisible: true hides from public reads; false is only public-eligible.
const UID=/^[A-Za-z0-9]{8}$/;
// These are typed payload variants carried by the existing physical Anchor row.
// The model-of-models composition is declared in schema.zmodel; this module
// alone owns Tree/DAG edge semantics and UID validation (not extra SQL tables).
// These are the persisted semantic variants carried by the existing
// eight-column Anchor row.  Keep the vocabulary in one place so the
// hierarchy projection and the Kysely/Zod boundaries cannot silently drift.
// TLucus: date/period/era; LLucus: point/path/trace.
// MLucus: image/video/suno/rune (semantic fields images/video/suno/runes).
// KLucus: category > class > group > item > pattern; lrunes66 stays separate.
// SLucus: universe (all) > galaxy (group) > domain (collection) > from (single source).
export const LUCUS_TYPE_GROUPS=Object.freeze({
  time:Object.freeze(['date','period','era']),
  space:Object.freeze(['point','path','trace']),
  media:Object.freeze(['image','video','rune','suno']),
  keyword:Object.freeze(['pattern','item','group','class','category']),
  source:Object.freeze(['from','domain','galaxy','universe'])
});
// Shared physical MLucus contract. No Galaxy Media SQL relation exists.
// Consumer projections are kept here beside the frozen ZModel type vocabulary.
export const MEDIA_LUCUS_COLUMNS='uid,type,title,description,createtime,attr,invisible';
export function canonicalMediaLucusType(hint='',url=''){
  const type=String(hint||'').trim().toLowerCase();
  const link=String(url||'').trim().toLowerCase();
  // Explicit persisted ZModel type wins over URL-based inference.
  if(LUCUS_TYPE_GROUPS.media.includes(type))return type;
  if(type==='runes')return 'rune';
  const sunoHost=/^https?:\/\/(?:[a-z0-9-]+\.)*suno\.(?:com|ai)(?:[\/?#: ]|$)/i.test(link);
  if(sunoHost)return 'suno';
  if(['image','images','photo','photos','pic','picture','thumbnail'].includes(type)||
    /(?:^|[_/.-])(image|images|photo|photos|pic|picture|jpeg|png|jpg|gif)(?:$|[_/.-])/.test(type)||
    (!type||type==='url'||type==='attachment')&&/\.(?:png|jpe?g|gif|webp|heic|avif|svg)(?:[?#]|$)/.test(link))
    return 'image';
  if(type==='video'||type==='videos'||type==='reel'||type==='reels'||
    /(?:^|[_/.-])(video|videos|reel|reels|clip|clips)(?:$|[_/.-])/.test(type)||
    (!type||type==='url'||type==='attachment')&&/\.(?:mp4|mov|avi|webm|mkv)(?:[?#]|$)/.test(link))
    return 'video';
  // Standalone audio/generic URL is NOT automatically a Suno or Image.
  // Reject uncertain formats rather than silently corrupting the fixed ZModel.
  throw new Error('Unsupported MLucus type: '+(type||'unknown'));
}
function typedMediaAttr(row){
  const raw=row?.attr;
  if(typeof raw==='string'){try{return JSON.parse(raw)||{};}catch{throw new Error('Invalid MLucus attr JSON');}}
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
}
export function mediaLucusProjection(row={}, {includeAttr=false}={}){
  if(!LUCUS_TYPE_GROUPS.media.includes(row.type))
    throw new Error('Not a MLucus row');
  const attr=typedMediaAttr(row);
  const {attr:_sourceAttr,...fields}=row;
  // Related media and public statistics expose typed fields, never arbitrary
  // JSON metadata. Only an authorized edit loads the original attr to retain
  // fields when updating the managed Anchor.
  return {...(includeAttr?row:fields),url:typeof attr.url==='string'?attr.url:null,
    media_type:row.type,date:typeof attr.date==='string'?attr.date:null};
}
export function mediaLucusRecord(values={}){
  const url=String(values?.url??values?.attr?.url??'').trim();
  if(url&&!/^https?:\/\//i.test(url))throw new Error('Invalid MLucus public URL');
  const type=canonicalMediaLucusType(values?.type||values?.media_type,url);
  const created=values?.createtime;
  const date=String(values?.attr?.date||created||'').slice(0,10);
  const attr={...(url?{url}:{}),...(/^\d{4}-\d{2}-\d{2}$/.test(date)?{date}:{})};
  const uid=String(values?.uid||'').trim();
  if(!/^[0-9A-Za-z]{8}$/.test(uid))throw new Error('MLucus UID must be eight Base62 characters');
  const row={uid,type,title:values?.title??null,
    description:values?.description??null,
    // Match the physical Anchor default; a missing URL is not an ACL grant.
    invisible:Boolean(values?.invisible),attr};
  if(created!==null&&created!==undefined&&created!==''){
    const iso=new Date(created);
    if(Number.isNaN(iso.getTime()))throw new Error('Invalid MLucus createtime');
    row.createtime=iso.toISOString();
  }
  return row;
}

// The semantic Anchor payload is stored in the existing Anchor.attr JSON;
// these are the corresponding *article carrier* fields on <scope>_galaxy.
// Keeping this map explicit prevents a semantic ZModel from being mistaken
// for a new SQL table or from silently choosing a different physical field.
// 'source' intentionally maps to Galaxy.site (the platform NAME), not
// Galaxy.site_id (the upstream post/media ID) or silver.loc_lucus.uid
// (the eight-character source-tree Anchor UID). Those IDs are unrelated.
// 'media' maps to Galaxy.media_link, which contains real URL strings;
// it is NOT a MLucus UID edge. Galaxy.url is the article permalink.
export const LUCUS_GROUP_GALAXY_FIELDS=Object.freeze({
  time:Object.freeze(['date','createtime']),
  space:Object.freeze(['location','place_id']),
  media:Object.freeze(['media_link']),
  keyword:Object.freeze(['keyword']),
  source:Object.freeze(['site'])
});
export const PERSISTED_LUCUS_TYPES=Object.freeze(Object.values(LUCUS_TYPE_GROUPS)
  .flat());
// "anniversary"/historical "aniversary" is a VIRTUAL TLucus suggestion.
// Anniversary is a derived editor suggestion. It is deliberately not a
// persisted discriminator and therefore is not included above.
export const VIRTUAL_LUCUS_TYPES=Object.freeze(['anniversary','aniversary']);
// Anchor.num generally counts UID references from the typed payload. Pattern
// is the exception: its num stores analyzed literal occurrences, while it
// remains terminal and contributes no child-UID count here. The LOC Block
// uidlist may start with a numeric layout marker: that marker is NOT a UID.
export function lucusUidListCount(type,storedAttr={}){
  const attr=typeof storedAttr==='string'?JSON.parse(storedAttr):storedAttr??{};
  if(!attr||typeof attr!=='object'||Array.isArray(attr))
    throw new TypeError('Invalid Anchor attr for UID counting');
  const count=key=>Array.isArray(attr[key])?attr[key].length:0;
  if(type==='pattern')return 0;
  if(type==='trace')return count('path')+count('point');
  if(type==='path')return count('point');
  if(type==='era')return count('period');
  if(['period','category','class','group','item','universe','galaxy','domain','from']
      .includes(type))return count('uid');
  if(PERSISTED_LUCUS_TYPES.includes(type))return 0;
  return Array.isArray(attr.uidlist)?attr.uidlist.filter(value=>
    UID.test(typeof value==='string'?value:String(value?.uid||''))).length:0;
}


// ZModel value types for the JSON payload carried by each discriminator. They
// are semantic projections, not extra SQL tables. Optional lists are valid in
// a value type because the nullable-list limitation only applies to physical
// SQL columns. Pattern does not persist article UID postings.
export const LUCUS_TYPE_MODEL_NAMES=Object.freeze({
  date:'DateLucus',period:'PeriodLucus',era:'EraLucus',
  point:'PointLucus',path:'PathLucus',trace:'TraceLucus',
  image:'ImageLucus',video:'VideoLucus',rune:'RuneLucus',suno:'SunoLucus',
  pattern:null,item:'ItemLucus',group:'GroupLucus',
  class:'ClassLucus',category:'CategoryLucus',
  from:'FromLucus',domain:'DomainLucus',galaxy:'GalaxyLucus',universe:'UniverseLucus'
});
export const LUCUS_GROUP_MODEL_NAMES=Object.freeze({
  time:'TLucus',space:'LLucus',media:'MLucus',
  keyword:'KLucus',source:'SLucus'
});
export const LUCUS_TYPE_GROUP_FIELDS=Object.freeze({
  date:'date',period:'period',era:'era',
  point:'point',path:'path',trace:'trace',
  image:'images',video:'video',rune:'runes',suno:'suno',
  pattern:'pattern',item:'item',group:'group',class:'class',category:'category',
  from:'from',domain:'domain',galaxy:'galaxy',universe:'universe'
});
export const VIRTUAL_LUCUS_TYPE_MODEL_NAMES=Object.freeze({
  anniversary:'AnniversarySuggestion',aniversary:'AnniversarySuggestion'
});
export const LUCUS_TYPE_PROJECTIONS=Object.freeze(Object.fromEntries(
  Object.entries(LUCUS_TYPE_GROUPS).flatMap(([group,types])=>types.map(type=>[
    type,Object.freeze({group,modelName:LUCUS_GROUP_MODEL_NAMES[group],
      payloadModelName:LUCUS_TYPE_MODEL_NAMES[type],
      groupField:LUCUS_TYPE_GROUP_FIELDS[type],
      galaxyFields:LUCUS_GROUP_GALAXY_FIELDS[group]})
  ]))
));
export const LUCUS_PAYLOAD_DEFS=Object.freeze({
  DateLucus:{date:{type:'String'}},
  PeriodLucus:{uid:{type:'String',array:true,optional:true},date:{type:'String',array:true,optional:true}},
  EraLucus:{period:{type:'String',array:true,optional:true},date:{type:'String',array:true,optional:true}},
  PointLucus:{longitude:{type:'Float',optional:true},latitude:{type:'Float',optional:true},
    location:{type:'Json',optional:true}},
  PathLucus:{point:{type:'String',array:true,optional:true}},
  TraceLucus:{point:{type:'String',array:true,optional:true},path:{type:'String',array:true,optional:true}},
  ImageLucus:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  VideoLucus:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  RuneLucus:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  SunoLucus:{url:{type:'String',optional:true},date:{type:'String',optional:true}},
  ItemLucus:{keyword:{type:'String',array:true,optional:true},uid:{type:'String',array:true,optional:true},total:{type:'Int',optional:true}},
  GroupLucus:{uid:{type:'String',array:true,optional:true},total:{type:'Int',optional:true}},
  ClassLucus:{uid:{type:'String',array:true,optional:true},
    exceptions:{type:'Json',optional:true}},
  CategoryLucus:{uid:{type:'String',array:true,optional:true}},
  FromLucus:{uid:{type:'String',array:true,optional:true},counts:{type:'Json',optional:true}},
  DomainLucus:{uid:{type:'String',array:true,optional:true},counts:{type:'Json',optional:true}},
  GalaxyLucus:{uid:{type:'String',array:true,optional:true},counts:{type:'Json',optional:true}},
  UniverseLucus:{uid:{type:'String',array:true,optional:true},counts:{type:'Json',optional:true}},
  AnniversarySuggestion:{date:{type:'String'},years:{type:'Int'},sourceUid:{type:'String',optional:true},title:{type:'String'}},
  TLucus:{date:{type:'DateLucus',optional:true},period:{type:'PeriodLucus',optional:true},
    era:{type:'EraLucus',optional:true},anniversary:{type:'AnniversarySuggestion',optional:true}},
  LLucus:{point:{type:'PointLucus',optional:true},path:{type:'PathLucus',optional:true},
    trace:{type:'TraceLucus',optional:true}},
  MLucus:{images:{type:'ImageLucus',optional:true},video:{type:'VideoLucus',optional:true},
    suno:{type:'SunoLucus',optional:true},runes:{type:'RuneLucus',optional:true}},
  KLucus:{pattern:{type:'Json',optional:true},item:{type:'ItemLucus',optional:true},
    group:{type:'GroupLucus',optional:true},class:{type:'ClassLucus',optional:true},
    category:{type:'CategoryLucus',optional:true}},
  SLucus:{universe:{type:'UniverseLucus',optional:true},galaxy:{type:'GalaxyLucus',optional:true},
    domain:{type:'DomainLucus',optional:true},from:{type:'FromLucus',optional:true}},
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

// A FromLucus is the terminal SLucus discriminator. The physical
// payload still stores uid:[] (and ZModel accepts that legacy shape), but a
// nonempty list cannot silently become an unmodeled fifth Source level.
export function assertSiteLucusLeaf(type,attr){
  if(type==='from'&&Array.isArray(attr?.uid)&&attr.uid.length>0)
    throw new TypeError('LOC FromLucus is a terminal Source node; attr.uid must be empty');
}

// TREE MODEL is a separate relationship layer over typed/composite Models.
// Parents/children are real Anchor UIDs, never matching titles or Galaxy UIDs.
// Keyword and Site are directed hierarchies; Time/Space allow shared children
// (DAG), and multiple Items may reference the same Pattern. Do not force a
// single-parent physical FK or reimplement the tree in each feature module.
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
export const LUCUS_HIERARCHY_FAMILIES=Object.freeze(Object.keys(FAMILY_DEFS));
// Typed payloads say what a node contains; FAMILY_DEFS says how nodes connect.
// Editor transition checks use the SAME ZModel hierarchy as typed readers.
export function nextZModelLucusType(family,type){
  const edges=FAMILY_DEFS[String(family||'')]?.edges?.[String(type||'')];
  const next=edges?Object.values(edges):[];
  return next.length===1?next[0]:null;
}


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
export function indexZModelLucusHierarchy(rows,{family,strict=false}={}){
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
    const attr=attrOf(row);
    if(family==='source')assertSiteLucusLeaf(type,attr);
    nodes.set(uid,{uid,type,title:String(row?.title||''),attr});
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
        // TLucus is a DAG: dates/periods may be reused by multiple ranges.
        // Only strict Keyword/Site hierarchies require unique parents.
        const sharedChild=family==='space'||family==='time'||
          (family==='keyword'&&childType==='pattern');
        if(!sharedChild&&incoming.has(uid))
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
