// Comparison-only text key. Keep the source text untouched for display/export.
export function canonicalArchiveText(value){
  return String(value??'').replace(/[\r\n]/g,'').trim();
}

export function sameArchiveText(left,right){
  return canonicalArchiveText(left)===canonicalArchiveText(right);
}
