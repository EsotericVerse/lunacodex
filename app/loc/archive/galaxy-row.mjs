// Map records from the shared archive scanner to Galaxy's existing text contract.
// Source adapters are hints; every row still needs real text and a stable identity.
import {facebookArchiveGalaxyRow,facebookArchiveUid} from './facebook-place.mjs';
import {repairMojibakeText} from '../content/content-policy.js';
import {extractImportCoordinates,importMapUrlCoordinates} from '../import/geocoordinates.mjs';
import {facebookPostPlace} from './geo-objects.mjs';
import {isArchiveMediaUrl} from './media-evidence.mjs';

export const platformLabel={facebook:'Facebook',threads:'Threads',instagram:'Instagram',chatgpt:'ChatGPT',claude:'Claude',
  messenger:'Messenger',x:'X',document:'Document',meta:'Archive'};
const label=platformLabel;
const urlOf=value=>{
  if(typeof value!=='string')return '';
  try{
    const u=new URL(value.trim());
    return ['https:','http:'].includes(u.protocol)&&!isArchiveMediaUrl(u.href)&&!importMapUrlCoordinates(u.href)?u.href:'';
  }catch{return ''}
};
const titleFor=(text,source)=>text.split(/\r?\n/)[0].trim().slice(0,120)||source+' 匯入紀錄';

export function archiveGalaxyRow(record){
  if(!record||record.kind==='unmapped'||!record.key)return null;
  const platform=String(record.platform||'meta').toLowerCase();
  const source=label[platform]||platform.slice(0,64)||'Archive';
  // Followers, likes, and other social graph exports are not authored
  // Threads articles, even when their payload contains a username/title.
  if(platform==='threads'&&!['post','media','story'].includes(String(record.kind||'')))
    return null;
  // Coordinates belong to the source JSON, not to LOC's optional location text.
  const facebookPlace=platform==='facebook'?facebookPostPlace(record.raw):null;
  const coordinates=platform==='facebook'?facebookPlace?.__importCoordinates:extractImportCoordinates(record.raw);
  if(platform==='facebook'){
    const row=facebookArchiveGalaxyRow(record);
    if(!row)return null;
    const url=urlOf(record.url);
    return {...row,site:'Facebook',...(row.location?{__importCheckin:true}:{}),
      ...(record.siteId?{site_id:record.siteId}:{}),...(url?{url}:{}),...(coordinates?{__importCoordinates:coordinates,
      ...(facebookPlace?.location?{__importPlaceName:facebookPlace.location}:{}),
      ...(facebookPlace?.address?{__importPlaceAddress:facebookPlace.address}:{}),
      ...(facebookPlace?.placeUrl?{__importPlaceUrl:facebookPlace.placeUrl}:{})}:{} )};
  }
  const content=repairMojibakeText(String(record.text||'').trim());
  if(!content)return null;
  const location=repairMojibakeText(String(record.sourcePlace||'').trim());
  const url=urlOf(record.url);
  return {
    uid:facebookArchiveUid('archive:'+record.key),
    title:platform==='threads'?Array.from(content).slice(0,10).join('')
      :repairMojibakeText(String(record.title||'').trim()).slice(0,300)||titleFor(content,source),
    content,createtime:record.createdAt||null,
    site:source,
    ...(record.siteId?{site_id:record.siteId}:{}),
    ...(location?{location:location}:{}),
    ...(coordinates?{__importCoordinates:coordinates}:{}),
    ...(url?{url}:{})
  };
}
