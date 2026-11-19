// LOC-owned outbound destinations; never treat these as LOC Scopes.
// DNS/hosting is owned by each destination. LOC grants no permissions here.
export const LOC_SERVICE_ORIGINS=Object.freeze({
  auth:'https://auth.lo3rwang.cc',
  mcp:'https://mcp.lo3rwang.cc',
  lrs:'https://lrs.lo3rwang.cc'
});

export function locServiceHref(service,path='/'){
  const origin=LOC_SERVICE_ORIGINS[service];
  if(!origin)throw Error('Unknown LOC outbound service');
  const suffix=String(path||'/');
  if(!suffix.startsWith('/')||suffix.startsWith('//')||suffix.includes('\\'))
    throw Error('Invalid LOC outbound path');
  const target=new URL(suffix,origin);
  if(target.origin!==origin)throw Error('External redirect is not a LOC route');
  return target.href;
}
