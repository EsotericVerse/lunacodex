import {sourceImportModel,IMPORT_SOURCE_MODEL_LABELS} from '../../../packages/zenstack/import-source-models.mjs';

export const OFFICIAL_SOURCE_LABELS=Object.freeze(Object.fromEntries(
  IMPORT_SOURCE_MODEL_LABELS.map(label=>[label.toLowerCase(),label])));
export function canonicalImportSourceName(value,system=[],personal=[]){
  const name=String(value||'').trim();
  if(!name)return '';
  const key=name.toLocaleLowerCase();
  const match=names=>(Array.isArray(names)?names:[]).find(label=>String(label).trim().toLocaleLowerCase()===key);
  // A known external source has a stable display label, but this does NOT
  // create or grant a SiteLucus. Unknown categories remain Others.
  return match(system)||match(personal)||sourceImportModel(name)?.label||'Others';
}
export function inferImportSourceFromFilename(fileName=''){
  const value=String(fileName).toLowerCase();
  if(/your_posts|status_updates|facebook_activity|places_you_have_been_tagged_in/i.test(value))return 'Facebook';
  if(/(?:instagram|ig)[-_ .]*(?:direct|dm)|(?:direct|dm)[-_ .]*instagram/i.test(value))return 'Instagram DM';
  if(/(?:x|twitter)[-_ .]*(?:direct|dm)|(?:direct|dm)[-_ .]*(?:x|twitter)/i.test(value))return 'X DM';
  if(/messenger|facebook[-_ .]*messages/i.test(value))return 'Messenger';
  if(/(?:^|[-_. ])(?:msn|windows[-_ ]live)(?:[-_. ]|$)/i.test(value))return 'MSN';
  if(/wordpress|wp_posts|wp[-_]?export/i.test(value))return 'WordPress';
  if(/notion/i.test(value))return 'Notion';
  for(const key of ['threads','facebook','instagram','pixnet','ptt','vocus']){
    if(value.includes(key))return canonicalImportSourceName(key);
  }
  return String(fileName).replace(/\.[a-z0-9]+$/i,'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-')||'import';
}
