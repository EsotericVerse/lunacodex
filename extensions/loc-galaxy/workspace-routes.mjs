// Only published LOC-hosted management pages may be opened by this Extension.
// The site performs its own Clerk login and Scope manage checks.
// NEVER add OAuth tokens, source text or database credentials to these URLs.
export const SCOPE_ID_PATTERN=/^[a-z][a-z0-9]{0,14}$/;
export const LOC_HOST='https://loc.lo3rwang.cc';
const KNOWN_SCOPE_PATHS=Object.freeze({
  lo3rwang:'/lo3rwang/search/manage/',
  lrunes:'/lrunes/search/manage/'
});
export function scopeManagementUrl(scopeid,mode='import'){
  if(!SCOPE_ID_PATTERN.test(String(scopeid||'')))throw Error('Scope ID 格式不正確');
  if(!['import','bulk','article'].includes(mode))throw Error('不支援的 Scope 管理功能');
  const known=KNOWN_SCOPE_PATHS[scopeid];
  const url=new URL(known||'/scope-shell/search/manage/',LOC_HOST);
  url.searchParams.set('section',mode==='article'?'publish':'import');
  url.searchParams.set('edit','1');
  if(!known)url.searchParams.set('scopeid',scopeid);
  if(mode==='bulk')url.hash='bulk-galaxy-visibility';
  return url.href;
}
