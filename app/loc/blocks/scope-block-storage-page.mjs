// LOC's Trace presentation is authored on the single Governance Block page.
export function scopeBlockStoragePage(scopeId,pageName='index'){
  const scope=String(scopeId||'').trim().toLowerCase();
  const page=String(pageName||'index').trim();
  const lowerPage=page.toLowerCase();
  if(scope==='loc'&&lowerPage==='trace')return 'governance';
  // LOC's fixed Hero discriminators are case-sensitive Anchor types. Keep
  // them unchanged for the fixed public Hero reader; route-owned page names
  // on other Scopes retain their historical lowercase normalization.
  return scope==='loc'?page:lowerPage;
}
