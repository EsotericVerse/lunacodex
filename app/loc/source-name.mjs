const OFFICIAL_SOURCE_LABELS=Object.freeze({facebook:'Facebook',threads:'Threads',instagram:'Instagram'});
export function canonicalImportSourceName(value,system=[],personal=[]){
  const name=String(value||'').trim();
  if(!name)return '';
  const key=name.toLocaleLowerCase();
  const match=names=>(Array.isArray(names)?names:[]).find(label=>String(label).trim().toLocaleLowerCase()===key);
  return match(system)||OFFICIAL_SOURCE_LABELS[key]||'Others';
}
export function inferImportSourceFromFilename(fileName=''){
  const value=String(fileName).toLowerCase();
  if(/your_posts|status_updates|facebook_activity|places_you_have_been_tagged_in/i.test(value))return 'Facebook';
  for(const key of ['threads','facebook','instagram','pixnet','ptt','vocus']){
    if(value.includes(key))return canonicalImportSourceName(key);
  }
  return String(fileName).replace(/\.[a-z0-9]+$/i,'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-')||'import';
}
