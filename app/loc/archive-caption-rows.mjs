// Facebook album photos with their own text become pic_text rows (one picture each);
// media are Galaxy Media records and never hold text.
// Structural parents represent actual platform media posts but are not user prose.
import {JSONPath} from 'jsonpath-plus';
import {archiveGalaxyRow,platformLabel} from './archive-galaxy-row.mjs';
import {facebookArchiveUid} from './facebook-backup-place.mjs';
import {repairMojibakeText} from './content-policy.js';
import {archiveAttachmentReferences} from './archive-media-evidence.mjs';
import {parseImportCreatedTime} from './import-batch.mjs';

const clean=value=>repairMojibakeText(String(value||'').trim());
// Facebook auto-labels album/upload metadata, not anything the user wrote.
const GENERIC_FACEBOOK_TITLES=new Set(['行動上傳','Mobile uploads','Mobile upload','Timeline Photos','動態時報相片']);
const authoredText=value=>{
  const text=clean(value);
  return GENERIC_FACEBOOK_TITLES.has(text)?'':text;
};

// Some exports (any platform) have no post text at all; the only text is
// nested somewhere inside the record — label_values[].media[], attachments
// [].data[].media[], extended_entities.media[], or anything else a given
// export shape happens to use. media never holds text, so each such photo
// becomes its own pic_text. Rather than guess container key names and a
// fixed depth, this asks for every object anywhere in the record (any
// depth, any key) that itself looks like a media leaf.
const MEDIA_FIELD_KEYS=['uri','src','media_uri','mediaUri','url','media_url','mediaUrl',
  'media_url_https','image_url','video_url','download_url','downloadUrl'];
const MEDIA_LEAF_QUERY='$..[?(@ && ('+MEDIA_FIELD_KEYS.map(key=>'@.'+key).join(' || ')+'))]';
const MAX_NESTED_MEDIA=200;
function nestedMediaItems(raw){
  if(!raw||typeof raw!=='object')return [];
  let matches;
  try{matches=JSONPath({path:MEDIA_LEAF_QUERY,json:raw,resultType:'value',wrap:true});}
  catch{return [];}
  const found=[],seenKeys=new Set();
  for(const item of matches||[]){
    if(!item||typeof item!=='object'||Array.isArray(item))continue;
    const dedupeKey=MEDIA_FIELD_KEYS.map(key=>item[key]).find(value=>typeof value==='string'&&value.trim());
    if(!dedupeKey||seenKeys.has(dedupeKey))continue;
    seenKeys.add(dedupeKey);
    found.push(item);
    if(found.length>=MAX_NESTED_MEDIA)break;
  }
  return found;
}
export function archiveGalaxyRows(record){
  if(record?.kind==='post'&&!archiveGalaxyRow(record)){
    const nested=nestedMediaItems(record.raw);
    const platform=String(record?.platform||'meta').toLowerCase();
    const source=platformLabel[platform]||platform.slice(0,64)||'Archive';
    const postFbid=record.siteId||(record.raw?.fbid!=null?String(record.raw.fbid):null);
    if(nested.length){
      const looseAttachments=[];
      const captions=nested.flatMap((item,index)=>{
        const title=authoredText(item?.title),description=authoredText(item?.description);
        // Facebook's auto label ("行動上傳" etc.) is not authored text.
        const text=[...new Set([title,description].filter(Boolean))].join('\n\n');
        const attachments=archiveAttachmentReferences(item);
        if(!text||!attachments.length){looseAttachments.push(...attachments);return [];}
        const uid=facebookArchiveUid('archive:nested-caption:'+record.sourcePath+':'+record.key+':'+
          String(item.uri||index));
        return [{
          row:{uid,title:Array.from(description||title).slice(0,120).join(''),
            content:text,createtime:parseImportCreatedTime(item.creation_timestamp)||record.createdAt||null,
            site:source,site_id:postFbid?postFbid+':'+index:null},
          attachments
        }];
      });
      // A photo without its own text here has no article to attach to (the
      // post itself has no text), so it is left for the ordinary media scan.
      if(captions.length)return captions;
    }
  }
  const album=record?.platform==='facebook'&&record?.kind==='media'&&
    /(?:^|\/)posts\/album\/[^/]+\.json$/.test(String(record.sourcePath||''))?
    record.raw:null;
  if(album&&Array.isArray(album.photos)){
    const name=clean(album.name)||'Facebook 相簿';
    const description=clean(album.description);
    const parentUid=facebookArchiveUid('archive:album:'+record.sourcePath);
    // The album's own creation time when the export has one, otherwise its
    // earliest photo (stable when photos are added later), then last modified.
    const photoTimes=album.photos.map(photo=>parseImportCreatedTime(photo?.creation_timestamp))
      .filter(Boolean).sort();
    const albumTime=parseImportCreatedTime(album.creation_timestamp??album.created_timestamp??
      album.create_timestamp)||photoTimes[0]||parseImportCreatedTime(album.last_modified_timestamp)||null;
    const looseAttachments=[];
    const captions=album.photos.flatMap((photo,index)=>{
      // A photo's own text is its title and its description (both are in the export).
      const photoTitle=authoredText(photo?.title),photoDescription=authoredText(photo?.description);
      const text=[...new Set([photoTitle,photoDescription].filter(Boolean))].join('\n\n');
      const attachments=archiveAttachmentReferences(photo);
      // A picture without its own text hangs on the album; one with text hangs
      // only on its own pic_text, so a pic_text always has exactly one picture.
      if(!text||!attachments.length){looseAttachments.push(...attachments);return [];}
      const uid=facebookArchiveUid('archive:album-caption:'+record.sourcePath+':'+
        String(photo.uri||index));
      return [{
        row:{uid,title:Array.from(photoTitle||photoDescription).slice(0,120).join(''),
          content:text,createtime:parseImportCreatedTime(photo.creation_timestamp)||albumTime,
          site:'Facebook',site_id:null,source_id:parentUid},
        attachments
      }];
    });
    const parent={
      uid:parentUid,title:name,content:description||name,createtime:albumTime,
      // The 'album:' prefix marks an album so imports compare it with albums only.
      site:'Facebook',site_id:albumTime?'album:'+albumTime:null,
      statics:Boolean(description),culture:Boolean(description),search:Boolean(description),
        trace:Boolean(description),list:Boolean(description),keyword:Boolean(description),others:true,extract:true,
      ...(captions.length?{target_id:captions.map(entry=>entry.row.uid)}:{})
    };
    return [{row:parent,attachments:looseAttachments},...captions];
  }
  const original=archiveGalaxyRow(record);
  if(!original)return [];
  // An Instagram caption belongs to the whole post, not to one picture. It stays
  // in the post's own text and every picture hangs on that post's media_link.
  return [{row:original,attachments:Array.isArray(record.attachments)?record.attachments:[]}];
}
