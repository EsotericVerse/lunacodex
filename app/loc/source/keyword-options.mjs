// Source selectors share LocAnchor's authoritative Universe/Galaxy/Domain/From
// hierarchy. Category codes are the existing case-sensitive Anchor UIDs.
export function sourceKeywordOptions(taxonomy){
  return (taxonomy?.categories||[]).filter(row=>row.enabled!==false).map(row=>{
    const root=row.root||'system';
    const path=[row.universe,row.galaxy,...(row.type==='from'?[row.domain]:[])]
      .filter(Boolean).join(' / ');
    return {
      key:root+':'+row.category_code,
      code:row.category_code,
      root,
      domain:path,
      type:row.type||'from',
      label:row.display_name||row.category_code
    };
  });
}
