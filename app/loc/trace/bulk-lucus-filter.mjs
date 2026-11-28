// Client-side filtering for lucus already loaded for the active Scope.
// Never query a different Scope or write data while filtering/choosing rows.
export function filterTraceLucusByText(lucus,rawQuery){
  const term=String(rawQuery||'').trim().toLocaleLowerCase();
  if(!term)return lucus;
  return lucus.filter(row=>[
    row.title,row.postal_address,row.description,row.uid
  ].some(value=>String(value??'').toLocaleLowerCase().includes(term)));
}

export function addTraceLucusSelection(selected,matched){
  return [...new Set([...selected,...matched.map(row=>row.uid)])];
}

export function removeTraceLucusSelection(selected,matched){
  const removed=new Set(matched.map(row=>row.uid));
  return selected.filter(uid=>!removed.has(uid));
}
