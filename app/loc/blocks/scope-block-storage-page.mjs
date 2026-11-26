// LOC's Trace presentation is authored on the single Governance Block page.
export function scopeBlockStoragePage(scopeId,pageName='index'){
  const scope=String(scopeId||'').trim().toLowerCase();
  const page=String(pageName||'index').trim().toLowerCase();
  return scope==='loc'&&page==='trace'?'governance':page;
}
