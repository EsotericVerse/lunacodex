// Client-side filtering for anchors already loaded for the active Scope.
// Never query a different Scope or write data while filtering/choosing rows.
export function filterTraceAnchorsByText(anchors,rawQuery){
  const term=String(rawQuery||'').trim().toLocaleLowerCase();
  if(!term)return anchors;
  return anchors.filter(row=>[
    row.title,row.postal_address,row.description,row.uid
  ].some(value=>String(value??'').toLocaleLowerCase().includes(term)));
}

export function addTraceAnchorSelection(selected,matched){
  return [...new Set([...selected,...matched.map(row=>row.uid)])];
}

export function removeTraceAnchorSelection(selected,matched){
  const removed=new Set(matched.map(row=>row.uid));
  return selected.filter(uid=>!removed.has(uid));
}
