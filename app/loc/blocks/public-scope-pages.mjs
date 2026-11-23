// Only guest-visible Scope Block pages may be requested through the fixed
// public block_list action. Management/Settings/other private page names must
// never be exposed through this read path. index remains the default.
export const PUBLIC_SCOPE_BLOCK_PAGES=Object.freeze([
  'index','search','trace','hero','game','culture','statics'
]);
export function publicScopeBlockPage(value='index'){
  const page=String(value??'index').trim().toLowerCase();
  return PUBLIC_SCOPE_BLOCK_PAGES.includes(page)?page:null;
}
