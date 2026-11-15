import {indexZModelAnchorHierarchy} from '../../../packages/zenstack/anchor-hierarchy.mjs';
// Current Keyword Tree Model: category > class > group > item > pattern.
// Typed/composite models define node payloads; anchor-hierarchy.mjs validates
// UID edges; this module adapts them for editor/catalog consumers.
// Only Pattern.attr postings hold Galaxy article UIDs (Pattern.num = count).
// Item.attr.uid links Pattern Anchor UIDs; Item.keyword carries word labels.
// Older "literal keyword strings" and Group/Item uid_lists are compatibility
// data shapes, NOT the persisted search/index architecture.
// Parent lists contain child UIDs, not names. No class_id, group_id, item_no.
// Only the canonical eight-character Anchor UID exists in the current ZModel.
const UID=/^[0-9A-Za-z]{8}$/;
const ARTICLE_UID=/^[0-9A-Za-z]{8}$/;
const TYPES=new Set(['category','class','group','item']);
const array=value=>{
  if(Array.isArray(value))return value;
  if(typeof value==='string'){try{const v=JSON.parse(value);if(Array.isArray(v))return v;}catch{}}
  throw new Error('Keywords lists and uid_lists must be arrays');
};
// COMPATIBILITY-ONLY reader for old uid_lists payloads (array, articles, hits).
// It does NOT define a new physical JSONB column or an authoritative hit index.
// New code must use Pattern posting UIDs and ZModel graph links; do not restore
// Item/Group article-list storage merely because this decoder still exists.
export function keywordUidListData(type,value){
  const raw=typeof value==='string'?(()=>{try{return JSON.parse(value)}catch{return value}})():value;
  if(Array.isArray(raw))return raw; // Existing local-file or import documents.
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
    if(type==='group'&&Array.isArray(raw.articles))return [...raw.articles];
    if(type==='item'&&Array.isArray(raw.hits))return [...raw.hits];
    // Legacy adapter can reconstruct in-memory {uid,times}; never persist as the
// new Item/Group index. The authoritative distinct count is Pattern.num.
    // Reconstruct legacy hit objects in memory only for existing consumers.
    if(['group','item'].includes(type)&&Array.isArray(raw.uidlists))
      return type==='item'?raw.uidlists.map(uid=>({uid,times:1})):raw.uidlists;
    if(['category','class'].includes(type)&&Object.keys(raw).length===0)return [];
  }
  throw new Error('Invalid structured Keywords uid_lists for '+type);
}
const cleanUid=value=>{
  if(typeof value!=='string'||!UID.test(value))throw new Error('KeywordAnchor UID must be eight case-sensitive Base62 characters');
  return value;
};
export function normalizeKeywordTreeRow(row){
  const uid=cleanUid(row?.uid),type=String(row?.type||'');
  if(!TYPES.has(type))throw new Error('Invalid Keywords type');
  const name=String(row?.name||'').trim(),desc=String(row?.desc??'');
  if(!name)throw new Error('Keywords name is required');
  const lists=array(row?.lists??[]),uid_lists=keywordUidListData(type,row?.uid_lists??[]);
  if(type==='item'){
    if(lists.some(word=>typeof word!=='string'||!word.trim()))throw new Error('Item lists must contain keyword strings');
    const seen=new Set();
    for(const hit of uid_lists){
      if(!hit||typeof hit!=='object'||!ARTICLE_UID.test(hit.uid)
        ||!Number.isSafeInteger(hit.times)||hit.times<0||seen.has(hit.uid))
        throw new Error('Item uid_lists require unique {uid,times} hits');
      seen.add(hit.uid);
    }
  }else{
    if(lists.some(x=>typeof x!=='string'||!UID.test(x)))throw new Error('Parent lists must contain child UIDs');
    if(new Set(lists).size!==lists.length)throw new Error('Duplicate child UID');
    if(type==='group'){
      if(uid_lists.some(x=>typeof x!=='string'||!ARTICLE_UID.test(x))
        ||new Set(uid_lists).size!==uid_lists.length)
        throw new Error('Group uid_lists require unique article UID strings');
    }else if(uid_lists.length)throw new Error('Category and Class do not store uid_lists');
  }
  const compact=row?.uid_lists&&typeof row.uid_lists==='object'&&!Array.isArray(row.uid_lists)
    &&Array.isArray(row.uid_lists.uidlists);
  // Old compatibility summaries may supply computed totals, but not index data.
  // Physical Keyword hit counts live only in Pattern.num; Item/Group totals are
  // derived presentation values and must not be written as another hit cache.
  const projected=Number(row?.total);
  const total=Number.isSafeInteger(projected)&&projected>=0&&row?.total!=null
    ?projected:compact&&Number.isSafeInteger(Number(row.uid_lists.total))
      ?Number(row.uid_lists.total):type==='item'
        ?uid_lists.reduce((sum,hit)=>sum+hit.times,0):uid_lists.length;
  // Preserve Class-specific scan rules for the editor and import/copy path.
  // The virtual hierarchy still uses only child Anchor IDs for all parent UIDs.
  return {uid,type,name,desc,lists:[...lists],uid_lists:[...uid_lists],
    attr:row?.attr&&typeof row.attr==='object'&&!Array.isArray(row.attr)
      ?{...row.attr}:{},total};
}
// Shared UID-linked tree used by Keywords and source classification.
// Physical Source Anchor: attr.uid stores child Anchor UIDs, not site names.
export function indexAnchorTree(rows=[],{normalize,rootType}){
  const index=new Map(),parent=new Map();
  for(const raw of rows){
    const row=normalize(raw);
    if(index.has(row.uid))throw new Error('Duplicate Anchor UID: '+row.uid);
    index.set(row.uid,row);
  }
  // All current Keyword/Source hierarchies use the one typed ZModel graph.
  // Legacy four-character trees no longer have a runtime fallback.
  const family=rootType==='category'?'keyword':rootType==='universe'?'source':null;
  if(!family)throw new Error('Unknown ZModel Anchor hierarchy');
  const canonical=[...index.values()].map(row=>({
    uid:row.uid,type:row.type,title:row.name,
    attr:row.type==='item'?{keyword:row.lists}:{uid:row.lists}
  }));
  const graph=indexZModelAnchorHierarchy(canonical,{family,strict:true});
  for(const uid of index.keys()){
    const parents=graph.parentsOf(uid);
    if(parents.length)parent.set(uid,parents[0]);
  }
  return {index,parent,roots:graph.roots.map(uid=>index.get(uid)).filter(Boolean),graph};
}
export function indexKeywordTree(rows=[]){
  return indexAnchorTree(rows,{normalize:normalizeKeywordTreeRow,rootType:'category'});
}
export function descendantsOfKeyword(rows,uid,{type}={}){
  const tree=indexKeywordTree(rows),start=tree.index.get(cleanUid(uid));
  if(!start)throw new Error('Unknown Keywords UID');
  return tree.graph.descendants(start.uid,{type}).uids
    .map(id=>tree.index.get(id)).filter(Boolean);
}
export function keywordClassCatalog(rows,classUid){
  const nodes=descendantsOfKeyword(rows,classUid),root=nodes[0];
  if(root.type!=='class')throw new Error('Keywords Class UID required');
  const map=new Map(nodes.map(node=>[node.uid,node])),catalog=[];
  for(const groupUid of root.lists){
    const group=map.get(groupUid);
    if(group.type!=='group')throw new Error('Unknown Group');
    for(const itemUid of group.lists){
      const item=map.get(itemUid);
      catalog.push({
        uid:item.uid,item_name:item.name,class_group:group.name,keywords:[...item.lists],
        order_no:catalog.length+1,group_uid:group.uid,class_uid:root.uid
      });
    }
  }
  return {classNode:root,catalog};
}
