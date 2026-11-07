import {createKeywordDocumentClassifier} from './keyword-engine.mjs';
import {keywordClassCatalog,indexKeywordTree} from '../keyword-tree.mjs';

// Keep scoring rules unchanged; ephemeral ordinals only index one analysis call.
// All externally visible references are four-character Item UIDs.
export function createKeywordUidDocumentClassifier(treeRows=[],classUid='',{collectKeywordTerms=false}={}){
  const {catalog}=keywordClassCatalog(treeRows,classUid);
  const slot=new Map(catalog.map((item,i)=>[i+1,item.uid]));
  const temp=catalog.map((item,i)=>({
    item_no:i+1,item_name:item.item_name,class_group:item.group_uid,
    keywords:item.keywords,order_no:item.order_no,class_enable:true
  }));
  const classify=createKeywordDocumentClassifier(temp,{collectKeywordTerms});
  return documents=>{
    const outcome=classify(documents);
    return {...outcome,classifications:(outcome.classifications||[]).map(row=>({
    uid:row.uid,status:row.status,classification_group:row.classification_group,
    tied_groups:[...(row.tied_groups||[])],
    hits:(row.rune_counts||[]).map(hit=>({uid:slot.get(hit.rune_id),times:hit.count})),
    matched_terms:[...(row.matched_terms||[])]
    }))};
  };
}
export function classifyKeywordDocumentsByUid(documents=[],treeRows=[],classUid=''){
  return createKeywordUidDocumentClassifier(treeRows,classUid)(documents);
}

// Mirror the pre-UID stateful tie resolver: previous Group allocations matter,
// and the configured default Group is ordered after the ordinary Groups.
// A Group containing the legacy zero rune 德 retains the no-hit fallback,
// without storing a numeric item_no or an extra Class/Group ID.
export function createKeywordUidGroupResolver(treeRows=[],classUid=''){
  const {index}=indexKeywordTree(treeRows);
  const root=index.get(classUid);
  if(!root||root.type!=='class')throw new Error('Unknown Keywords Class');
  const groups=root.lists.map((uid,order)=>{
    const node=index.get(uid);
    if(!node||node.type!=='group')throw new Error('Broken Group link');
    return {uid,order,items:node.lists};
  });
  const byUid=new Map(groups.map(group=>[group.uid,group]));
  const winners=new Map(groups.map(group=>[group.uid,0]));
  const defaultGroups=groups.filter(group=>group.items.some(uid=>index.get(uid)?.name==='德'));
  const defaultGroup=defaultGroups.length===1?defaultGroups[0]:null;
  return {
    resolve(result){
      const candidates=[...new Set(result?.tied_groups||[])]
        .map(uid=>byUid.get(uid)).filter(Boolean);
      let chosen=null;
      if(candidates.length>1){
        chosen=[...candidates].sort((a,b)=>
          winners.get(a.uid)-winners.get(b.uid)||a.order-b.order
        )[0];
      }else if(candidates.length===1){
        chosen=candidates[0];
      }else{
        chosen=byUid.get(String(result?.classification_group||''))||defaultGroup;
      }
      if(chosen)winners.set(chosen.uid,winners.get(chosen.uid)+1);
      return chosen?.uid||'';
    },
    counts:()=>new Map(winners)
  };
}
