// Pure change plan for editable homepage blocks. A displayed block is not
// necessarily a changed block; never rewrite every row on a single edit.
export function planHomeBlockWrites(drafts=[],originalDrafts=[],{preserveOrder=false}={}){
  const originals=new Map((Array.isArray(originalDrafts)?originalDrafts:[])
    .filter(item=>item.stored).map(item=>[String(item.uid),item]));
  const placeholderOriginals=new Map((Array.isArray(originalDrafts)?originalDrafts:[])
    .filter(item=>!item.stored).map(item=>[Number(item.order),item]));
  const rows=(Array.isArray(drafts)?drafts:[]).filter(item=>!item._deleted);
  const changed=rows.map((draft,index)=>{
    const previous=draft.stored?originals.get(String(draft.uid)):placeholderOriginals.get(Number(draft.order));
    const order=preserveOrder?Number(draft.order)||index+1:index+1;
    const modified=!previous||JSON.stringify(draft)!==JSON.stringify(previous)||
      Number(previous.order)!==order;
    return {draft,index,modified,order};
  });
  const deleted=(Array.isArray(drafts)?drafts:[]).filter(draft=>draft._deleted&&draft.stored);
  return {changed,deleted,hasWrites:deleted.length>0||changed.some(item=>item.modified)};
}
