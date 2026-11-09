export function sourceKeywordOptions(taxonomy){
 return (taxonomy?.categories||[]).filter(row=>row.enabled!==false).map(row=>({
  key:'source:'+row.category_code,code:row.category_code,root:'system',label:row.display_name||row.category_code
 }));
}
