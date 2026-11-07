// LOC-managed route validation used by every SQL engine.
// Replaces the PostgreSQL-only domain_has_repeated_labels() CHECK helper.
const LABEL=/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export function normalizeLocDomain(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string')throw new TypeError('Invalid LOC domain');
  const domain=value.trim().toLowerCase();
  const labels=domain.split('.');
  if(domain.length>253||labels.length===0||
    labels.some(label=>label.length>63||!LABEL.test(label)))
    throw new TypeError('Invalid LOC domain');
  if(new Set(labels).size!==labels.length)
    throw new TypeError('LOC domain contains repeated labels');
  return domain;
}
export function validateLocRegistryDomain(values){
  if(!values||typeof values!=='object'||Array.isArray(values))
    throw new TypeError('Invalid LOC Registry values');
  if(!Object.hasOwn(values,'domain'))return values;
  return {...values,domain:normalizeLocDomain(values.domain)};
}
