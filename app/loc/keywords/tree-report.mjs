import {indexKeywordTree} from './tree.mjs';

// LEGACY REPORT ADAPTER, not the current Keyword Tree Model or write contract.
// Its Group.uid_lists and Item.{uid,times} shapes are compatibility input to
// older report consumers, NOT persisted Anchor posting lists. Current source
// of truth: Item rules and cached Item/Group.attr.total, connected through
// Item/Group/Class/Category Anchor UIDs by lucus-hierarchy.mjs.
// Do not create/update Group or Item hit lists for new Statistics/Culture work.
export function keywordTreeCatalog(rows,classUid){
  const tree=indexKeywordTree(rows),root=tree.index.get(classUid);
  if(!root||root.type!=='class')throw new Error('Unknown Class UID');
  const groups=root.lists.map(uid=>{
    const node=tree.index.get(uid);
    return {uid:node.uid,name:node.name,desc:node.desc,
      items:node.lists.map(childUid=>{
        const item=tree.index.get(childUid);
        return {uid:item.uid,name:item.name,desc:item.desc,
          keywords:[...item.lists],uid_lists:item.uid_lists,total:item.total};
      }),
      uid_lists:node.uid_lists,total:node.total};
  });
  return {uid:root.uid,name:root.name,groups};
}
// Legacy metrics require old caller-supplied hit projections; this helper
// does not fetch the authoritative Pattern index. Do not treat its output as
// proof that old Group/Item physical hit lists are current storage.
export function keywordTreeMetrics(rows,classUid,{articleUids=null}={}){
  const catalog=keywordTreeCatalog(rows,classUid);
  const selected=articleUids==null?null:new Set(articleUids);
  if(selected)for(const uid of selected)
    if(typeof uid!=='string'||!/^[A-Za-z0-9]{8}$/.test(uid))
      throw new Error('Invalid Galaxy article UID');
  const matching=uid=>!selected||selected.has(uid);
  const byArticle=new Map(),groups=[],items=[];
  for(const group of catalog.groups){
    const members=group.uid_lists.filter(matching);
    for(const uid of members){
      if(byArticle.has(uid))throw new Error('Article belongs to multiple Groups');
      byArticle.set(uid,group.uid);
    }
    let itemMatches=0,occurrences=0;
    for(const item of group.items){
      const hits=item.uid_lists.filter(hit=>matching(hit.uid));
      const count=selected?hits.length:Number(item.total??hits.reduce((sum,hit)=>sum+hit.times,0));
      itemMatches+=hits.length;occurrences+=count;
      items.push({uid:item.uid,name:item.name,group_uid:group.uid,group_name:group.name,
        document_count:hits.length,hit_count:count});
    }
    groups.push({uid:group.uid,name:group.name,description:group.desc,
      document_count:members.length,item_matches:itemMatches,hit_count:occurrences});
  }
  return {class_uid:catalog.uid,class_name:catalog.name,
    document_count:byArticle.size,groups,items,byArticle};
}
export function keywordTreeGroupForArticle(rows,classUid,articleUid){
  const report=keywordTreeMetrics(rows,classUid,{articleUids:[articleUid]});
  const groupUid=report.byArticle.get(articleUid);
  return report.groups.find(group=>group.uid===groupUid)||null;
}
