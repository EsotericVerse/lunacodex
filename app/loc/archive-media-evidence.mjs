// Preserve ZIP media references and private EXIF evidence without keeping image bytes.
const MAX_MEDIA_PER_RECORD=200;
const URI_KEYS=['uri','src','media_uri','mediaUri','path','relative_path','relativePath'];
const URL_KEYS=['media_url','mediaUrl','image_url','video_url','download_url','downloadUrl','media_url_https','url','display_url'];
const CHILD_KEYS=['photos','videos','audio_files','attachments','media','data','items','array','label_values','image_versions2','image','video','photo','candidates','video_versions','thumbnail_resources','carousel_media','children','images','thumbnail'];
const HTTP=/^https?:\/\/[^/\s]+/i;
const MEDIA_EXT=/\.(?:jpe?g|png|gif|webp|heic|avif|tiff?|mp4|mov|mkv|webm|mp3|m4a|wav|ogg|flac)(?:[?#]|$)/i;
const rawPath=value=>String(value||'').trim().replace(/\\/g,'/');
const pathValue=value=>rawPath(value).replace(/^\.\//,'');
const validRef=value=>Boolean(value&&value.length<=2048&&
  !/[\u0000-\u001f]/u.test(value)&&
  (HTTP.test(value)||(!value.startsWith('/')&&!value.split('/').includes('..'))));
const publicUrl=value=>HTTP.test(value)&&validRef(value)?value:null;
export const isArchiveMediaUrl=value=>typeof value==='string'&&Boolean(publicUrl(value.trim()))&&MEDIA_EXT.test(value);
export function archiveMediaType(uri,hint=''){
  const text=String(hint||'').toLowerCase();
  if(/image|photo/.test(text))return 'image';
  if(/video/.test(text))return 'video';
  if(/audio|voice/.test(text))return 'audio';
  const path=String(uri||'').toLowerCase().split(/[?#]/)[0];
  return /\.(?:jpe?g|png|gif|webp|heic|avif|tiff?)$/.test(path)?'image':
    /\.(?:mp4|mov|mkv|webm)$/.test(path)?'video':
    /\.(?:mp3|m4a|wav|ogg|flac)$/.test(path)?'audio':'attachment';
}
// Count literal nested "url" attributes by the parent object's role.
// An attachment or a place URL must never become the original post URL.
export function auditArchiveUrlAttributes(raw,{maxNodes=1800}={}){
  const counts={total:0,article:0,media:0,place:0,other:0,truncated:false};
  if(!raw||typeof raw!=='object')return counts;
  const queue=[{node:raw,kind:'article',depth:0}],seen=new WeakSet();
  const mediaKeys=new Set(['attachments','media','photos','videos','audio_files','image','video','photo',
    'image_versions2','extended_entities','media_items']);
  const placeKeys=new Set(['place','places','location','checkin','check_in','venue','geo']);
  const postKeys=new Set(['post','post_data','thread','status','tweet','noteTweet','core']);
  let examined=0;
  for(let cursor=0;cursor<queue.length;cursor++){
    if(examined++>=maxNodes){counts.truncated=true;break;}
    const {node,kind,depth}=queue[cursor];
    if(!node||typeof node!=='object'||seen.has(node)||depth>12)continue;
    seen.add(node);
    if(Array.isArray(node)){
      for(const child of node)if(child&&typeof child==='object')
        queue.push({node:child,kind,depth:depth+1});
      continue;
    }
    const ownKind=kind==='place'?'place':
      /^(image|photo|video|audio)/i.test(String(node.media_type||node.type||''))||
      typeof node.uri==='string'&&MEDIA_EXT.test(node.uri)?'media':kind;
    if(Object.prototype.hasOwnProperty.call(node,'url')){
      counts.total++;
      counts[ownKind]++;
    }
    for(const [key,child] of Object.entries(node)){
      if(!child||typeof child!=='object')continue;
      const nextKind=placeKeys.has(key)?'place':
        mediaKeys.has(key)?'media':
        postKeys.has(key)?'article':
        key==='data'||key==='array'||key==='items'||key==='label_values'||key==='dict'
          ?ownKind:'other';
      queue.push({node:child,kind:nextKind,depth:depth+1});
    }
  }
  return counts;
}
// Return only actual media references. Do not confuse post permalinks with image URLs.
export function archiveAttachmentReferences(record){
  if(!record||typeof record!=='object')return [];
  const roots=[record.photos,record.videos,record.audio_files,record.attachments,record.media,record.data,record.array,record.label_values,
    ...(Array.isArray(record.data)?record.data.flatMap(item=>
      [item?.attachments,item?.media,item?.photos,item?.videos].filter(Boolean)):[])];
  if((typeof record.uri==='string'&&MEDIA_EXT.test(record.uri))||
       /^(image|photo|video|audio)/i.test(String(record.media_type||''))||
       [record.url,record.media_url,record.mediaUrl,record.image_url,record.video_url,record.download_url,record.media_url_https]
         .some(isArchiveMediaUrl)||
       [record.media_url,record.mediaUrl,record.image_url,record.video_url,record.media_url_https]
         .some(value=>typeof value==='string'&&Boolean(publicUrl(value))))roots.push(record);
  const queue=roots.filter(Boolean).map(value=>({value,depth:0,hint:'',originUri:''}));
  const visited=new WeakSet(),found=new Map();
  // Cursor-based breadth-first traversal avoids shifting every pending node
  // (and preserves discovery order and the 3000-node safety ceiling).
  let examined=0,cursor=0;
  while(cursor<queue.length&&examined<3000&&found.size<MAX_MEDIA_PER_RECORD){
    const {value,depth,hint:parentHint,originUri}=queue[cursor++];examined++;
    if(!value||typeof value!=='object')continue;
    if(visited.has(value))continue;
    visited.add(value);
    if(Array.isArray(value)){for(const item of value)queue.push({value:item,depth,hint:parentHint,originUri});continue;}
    const hint=String(value.media_type||value.type||value.mime_type||(value.image_url?'image':value.video_url?'video':parentHint));
    // No temporary map/filter arrays for every object in a large export.
    const paths=[],allUrls=[];
    for(const key of URI_KEYS){
      const valueAtKey=value[key];
      if(typeof valueAtKey!=='string')continue;
      const path=pathValue(valueAtKey);
      if(validRef(path))paths.push(path);
    }
    for(const key of URL_KEYS){
      const valueAtKey=value[key];
      if(typeof valueAtKey==='string')allUrls.push(rawPath(valueAtKey));
    }
    for(const maybePath of allUrls)if(!HTTP.test(maybePath)&&MEDIA_EXT.test(maybePath)&&
        validRef(maybePath))paths.push(maybePath);
    const urls=allUrls.filter(v=>publicUrl(v));
    // Explicit media URL fields win over generic links on the same media item.
    // Generic URLs are accepted only when they look like media or are labelled as media.
    const mediaUrl=URL_KEYS.slice(0,7).map(key=>value[key]).find(v=>publicUrl(v));
    const genericUrl=urls.find(v=>isArchiveMediaUrl(v))||
      (/^(image|photo|video|audio)/i.test(hint)?
        urls.find(v=>!/(?:instagram\.com\/(?:p|reel|stories)\/|threads\.net\/.*\/post\/|facebook\.com\/(?:posts|permalink\.php))/i.test(v)):null);
    const directUrl=publicUrl(mediaUrl)||genericUrl||paths.find(v=>HTTP.test(v))||null;
    const relative=paths.filter(v=>!HTTP.test(v));
    for(const uri of relative.length?relative:directUrl?[originUri||directUrl]:[]){
      const mediaType=archiveMediaType(uri,hint);
      const existing=found.get(uri);
      if(!existing||(!existing.url&&directUrl))
        found.set(uri,{uri,mediaType,url:publicUrl(directUrl)});
    }
    if(depth<6)for(const key of CHILD_KEYS)if(value[key]!=null){
      const childHint=/^(?:image_versions2|image|photo|photos|images|thumbnail|thumbnail_resources)$/i.test(key)?'image':
        /^(?:video_versions|video|videos)$/i.test(key)?'video':hint;
      queue.push({value:value[key],depth:depth+1,hint:childHint,originUri:relative[0]||originUri});
    }
  }
  return [...found.values()];
}
function platformFromPath(path){
  const p=String(path).toLowerCase();
  if(/(?:^|\/)(?:threads|threads_and_replies)(?:\/|$)/.test(p))return 'threads';
  if(/(?:^|\/)(?:facebook|your_facebook_activity)(?:\/|$)/.test(p))return 'facebook';
  if(/(?:^|\/)(?:instagram|your_instagram_activity)(?:\/|$)/.test(p))return 'instagram';
  return '';
}
export function createArchiveEvidenceCollector(){
  const records=new Map();
  function locate(raw){
    const path=pathValue(raw);
    if(!validRef(path))return null;
    if(!records.has(path))records.set(path,{
      entry_path:path,platform:platformFromPath(path),media_type:archiveMediaType(path),
      galaxy_uids:new Set(),source_files:new Set(),url:publicUrl(path),
      latitude:null,longitude:null,camera_local_time:null,found_in_zip:false,referenced_by_post:false
    });
    return records.get(path);
  }
  return {
    onRecord(record,galaxyUid){
      for(const attachment of record?.attachments||[]){
        const item=locate(attachment.uri);
        if(!item)continue;
        item.referenced_by_post=true;
        item.platform=String(record.platform||item.platform||'').slice(0,32);
        item.media_type=attachment.mediaType||item.media_type;
        item.url=publicUrl(attachment.url)||item.url;
        if(galaxyUid)item.galaxy_uids.add(galaxyUid);
        if(record.sourcePath)item.source_files.add(record.sourcePath);
      }
    },
    onMediaEntry({path}){
      const item=locate(path);
      if(item)item.found_in_zip=true;
    },
    onExif({path,metadata}){
      if(!metadata)return;
      const lat=metadata.latitude,lng=metadata.longitude;
      const coordinates=Number.isFinite(lat)&&Number.isFinite(lng)&&
        Math.abs(lat)<=90&&Math.abs(lng)<=180;
      if(!coordinates&&!metadata.cameraLocalTime)return;
      const item=locate(path);
      if(!item)return;
      item.found_in_zip=true;
      if(coordinates){item.latitude=lat;item.longitude=lng;}
      item.camera_local_time=String(metadata.cameraLocalTime||'').slice(0,64)||null;
    },
    rows({scopeId,archiveName,archiveSize}){
      const archiveId=String(archiveName||'archive').slice(0,260)+':'+String(archiveSize);
      // Match a suffix only when it maps to exactly one archive entry. Filename-only
      // guesses are forbidden: two similar photos may belong to different posts.
      const present=[...records.values()].filter(row=>row.found_in_zip);
      const suffixes=new Map();
      for(const image of present){
        const parts=image.entry_path.split('/');
        for(let start=0;start<parts.length;start++){
          const key=parts.slice(start).join('/');
          if(!suffixes.has(key))suffixes.set(key,image);
          else if(suffixes.get(key)!==image)suffixes.set(key,null);
        }
      }
      for(const ref of [...records.values()]){
        if(ref.found_in_zip||HTTP.test(ref.entry_path))continue;
        const image=suffixes.get(ref.entry_path);
        if(!image)continue;
        for(const uid of ref.galaxy_uids)image.galaxy_uids.add(uid);
        for(const file of ref.source_files)image.source_files.add(file);
        if(ref.url&&!image.url)image.url=ref.url;
        if(ref.platform&&!image.platform)image.platform=ref.platform;
        records.delete(ref.entry_path);
      }
      return [...records.values()]
        .filter(item=>Boolean(publicUrl(item.url))||
          (item.found_in_zip&&item.referenced_by_post)||
          (Number.isFinite(item.latitude)&&Number.isFinite(item.longitude))||
          Boolean(item.camera_local_time))
        .map(item=>({
        scope_id:scopeId,archive_id:archiveId,entry_path:item.entry_path,
        platform:item.platform||null,media_type:item.media_type,
        galaxy_uids:[...item.galaxy_uids],source_files:[...item.source_files],
        url:item.url,latitude:item.latitude,longitude:item.longitude,
        camera_local_time:item.camera_local_time,found_in_zip:item.found_in_zip,
        referenced_by_post:item.referenced_by_post
      }));
    },
    count(){return records.size;}
  };
}
// A stable UUID prevents re-importing the same archive path into duplicate media.
export function archiveMediaUid(scopeId,archiveId,entryPath){
  const input=String(scopeId)+'\u0000'+String(archiveId)+'\u0000'+String(entryPath);
  const seeds=[2166136261,338855925,2654435761,2246822519];
  const hex=seeds.map((seed,i)=>{
    let value=seed>>>0;
    for(const ch of input){value=Math.imul(value^ch.codePointAt(0),i%2?2246822519:16777619);}
    return (value>>>0).toString(16).padStart(8,'0');
  }).join('');
  const uuid=hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+
    '-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
  return (BigInt('0x'+uuid.replaceAll('-',''))%(36n**8n)).toString(36).toUpperCase().padStart(8,'0');
}
export function prepareArchiveMedia(evidence=[],knownUids=new Set(),articleTimes=new Map(),
  articleTitles=new Map(),articleContents=new Map()){
  const media=[],exif=[],mediaLinks=[];
  for(const entry of evidence){
    const id=archiveMediaUid(entry.scope_id,entry.archive_id,entry.entry_path);
    const owners=(entry.galaxy_uids||[]).filter(uid=>knownUids.has(uid));
    const type=entry.media_type||archiveMediaType(entry.entry_path);
    // A ZIP attachment has no independent publish time. If linked, use the
    // earliest known source article time; never substitute EXIF/local/import time.
    const linkedTimes=owners.map(uid=>articleTimes.get(uid))
      .filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
      .sort();
    const articleTime=linkedTimes[0]||null;
    const row={
      uid:id,type,url:publicUrl(entry.url),
      title:owners.map(uid=>String(articleTitles.get(uid)||'').trim()).find(Boolean)||
        ({image:'圖片',video:'影片',audio:'音訊'}[type]||'媒體'),
      meta_tags:owners.map(uid=>String(articleContents.get(uid)||'').trim()).find(Boolean)||null,
      createtime:articleTime,location:null
    };
    const hasUrl=Boolean(row.url);
    // A ZIP file proved to exist and explicitly linked by a saved article is
    // valid media evidence, even without an external URL. We save metadata and
    // the canonical UID relation, never the local path as a playable URL.
    // Standalone/orphan ZIP files are NOT manufactured into empty media rows.
    const linkedZipMedia=!hasUrl&&Boolean(entry.found_in_zip)&&
      Boolean(entry.referenced_by_post)&&owners.length>0&&
      ['image','video','audio'].includes(type);
    if(hasUrl||linkedZipMedia){
      media.push({...row,__article_uid:owners[0]||null});
      for(const uid of owners)mediaLinks.push({uid,media_uid:id});
    }
    if((Number.isFinite(entry.latitude)&&Number.isFinite(entry.longitude))||entry.camera_local_time)
      exif.push({
        media_uid:hasUrl||linkedZipMedia?id:null,archive_id:entry.archive_id,entry_path:entry.entry_path,
        platform:entry.platform||null,latitude:entry.latitude,
        longitude:entry.longitude,camera_local_time:entry.camera_local_time
      });
  }
  return {media,exif,mediaLinks};
}
