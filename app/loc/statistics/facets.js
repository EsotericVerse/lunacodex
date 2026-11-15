/**
 * Pure, Scope-independent statistics dimensions for Galaxy Media metadata.
 * No image/audio files or lyrics are loaded. Each media row counts at most once
 * in a platform/type bucket, and once per distinct style tag.
 */
function plainText(value){return String(value??'').trim();}
function tagKey(value){return plainText(value).normalize('NFKC').toLocaleLowerCase();}
export function mediaDay(value){
  const source=plainText(value);
  const day=source.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
  if(source.length===10)return day;
  const timestamp=new Date(source);
  if(!Number.isFinite(timestamp.getTime()))return day;
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(timestamp);
  const formatted=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return formatted.year+'-'+formatted.month+'-'+formatted.day;
}
function isHost(host,domain){return host===domain||host.endsWith('.'+domain);}
// A check-in place is not a publishing platform. Classify media only from
// its URL host/path; neither type nor location can prove a platform.
const UNKNOWN_MEDIA_PLATFORM='其他／無法辨識';
export function mediaPlatform(row={}){
  const raw=plainText(row.url);
  if(!raw)return UNKNOWN_MEDIA_PLATFORM;
  try{
    const url=new URL(/^https?:\/\//iu.test(raw)?raw:'https://'+raw);
    const host=url.hostname.toLowerCase();
    const path=url.pathname.toLowerCase();
    if(isHost(host,'instagram.com'))return /^\/reels?\//u.test(path)?'IG Reels':/^\/p\//u.test(path)?'IG 貼文':'Instagram';
    if(isHost(host,'vocus.cc'))return 'Vocus';
    if(isHost(host,'suno.com')||isHost(host,'suno.ai'))return 'Suno';
    if(isHost(host,'youtube.com'))return /^\/shorts\//u.test(path)?'YouTube Shorts':'YouTube';
    if(isHost(host,'youtu.be'))return 'YouTube';
    if(isHost(host,'facebook.com')||isHost(host,'fb.watch'))return 'Facebook';
    if(isHost(host,'threads.net')||isHost(host,'threads.com'))return 'Threads';
    if(isHost(host,'tiktok.com'))return 'TikTok';
    if(isHost(host,'open.spotify.com'))return 'Spotify';
    if(isHost(host,'soundcloud.com'))return 'SoundCloud';
    if(host&&host.includes('.'))return host.replace(/^www\./u,'');
  }catch{
    // Invalid URL is not evidence of a publishing platform.
  }
  return UNKNOWN_MEDIA_PLATFORM;
}
export function mediaStyleTags(value){
  const pieces=Array.isArray(value)?value:plainText(value).split(/[,，、;；\n\r|]+/u);
  const unique=new Map();
  for(const piece of pieces){
    const tag=plainText(piece);
    const key=tagKey(tag);
    if(key&&!unique.has(key))unique.set(key,tag);
  }
  return [...unique.values()];
}
export function mediaFacetDaily(rows=[],dimension='media_platform'){
  const entries=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const day=mediaDay(row?.createtime);
    if(!day)continue;
    let categories=[];
    if(dimension==='media_type')categories=[plainText(row.type)||'未分類'];
    else if(dimension==='media_style')categories=mediaStyleTags(row.description);
    else if(dimension==='media_platform')categories=[mediaPlatform(row)];
    else throw new Error('Unsupported media statistics dimension: '+dimension);
    if(dimension==='media_style'&&!categories.length)categories=['沒有內容描述'];
    for(const category of categories){
      const key=day+'\u0000'+tagKey(category);
      const existing=entries.get(key);
      if(existing)existing.item_count++;
      else entries.set(key,{day,category,item_count:1});
    }
  }
  return [...entries.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}

// Data-driven, Scope-local cross-tag statistics for Galaxy Media.
// The only predefined genres are optional initial selections, not a taxonomy.

const keyOf=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase();
const isPopDefault=key=>/^(mandopop|mando pop|mandarin pop|j-pop|j pop|jpop|japanese pop|k-pop|k pop|kpop|korean pop)$/u.test(key);

export function mediaCrossTagCatalog(rows=[]){
  const media=new Map();
  const catalog=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const id=String(row?.uid||'').trim();
    if(!id)continue;
    const tags=mediaStyleTags(row.description);
    if(!tags.length)continue;
    let entry=media.get(id);
    if(!entry){
      entry={id,day:mediaDay(row.createtime),tags:new Set()};
      media.set(id,entry);
    }
    for(const label of tags){
      const key=keyOf(label);
      if(!key||entry.tags.has(key))continue;
      entry.tags.add(key);
      if(!catalog.has(key))catalog.set(key,{key,label,count:0});
      catalog.get(key).count++;
    }
  }
  const options=[...catalog.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  return {options,media:[...media.values()]};
}
export function defaultMediaCrossAxes(catalog){
  const options=catalog?.options||[];
  const left=options.filter(item=>isPopDefault(item.key)).map(item=>item.key);
  const selected=new Set(left);
  return {left,right:options.filter(item=>!selected.has(item.key)).map(item=>item.key)};
}
export function mediaCrossIntersections(catalog,left=[],right=[]){
  const labels=new Map((catalog?.options||[]).map(x=>[x.key,x.label]));
  const leftSet=new Set(left.filter(x=>labels.has(x)));
  const rightSet=new Set(right.filter(x=>labels.has(x)));
  const pairMap=new Map();
  for(const item of catalog?.media||[]){
    const x=[...item.tags].filter(tag=>leftSet.has(tag));
    const y=[...item.tags].filter(tag=>rightSet.has(tag));
    for(const a of x)for(const b of y){
      if(a===b)continue;
      const id=a+'\u0000'+b;
      let result=pairMap.get(id);
      if(!result){
        result={key:id,left:a,right:b,leftLabel:labels.get(a),rightLabel:labels.get(b),count:0,days:new Map()};
        pairMap.set(id,result);
      }
      result.count++;
      if(item.day)result.days.set(item.day,(result.days.get(item.day)||0)+1);
    }
  }
  return [...pairMap.values()].sort((a,b)=>b.count-a.count||a.leftLabel.localeCompare(b.leftLabel)||a.rightLabel.localeCompare(b.rightLabel));
}

// Reuse the existing Keyword Library Class → Group → Item → Keywords contract.
// Statistics work only with published media metadata, never song lyrics or audio.

const normalize=value=>String(value??'').trim().normalize('NFKC').toLocaleLowerCase();

export function styleTreeClasses(treeRows=[]){
  return [...new Set((Array.isArray(treeRows)?treeRows:[])
    .map(row=>String(row?.class_name||'').trim()).filter(Boolean))].sort();
}

export function mediaStyleTreeDaily(mediaRows=[],treeRows=[],level='class',classFilter=''){
  if(!['class','group','item'].includes(level))throw new Error('Unsupported Style Tree dimension');
  const rows=Array.isArray(treeRows)?treeRows:[];
  const catalog=rows.map(row=>{
    const className=String(row?.class_name||'').trim();
    const group=String(row?.class_group||'').trim();
    const item=String(row?.item_name||'').trim();
    const terms=[...(Array.isArray(row?.keywords)?row.keywords:[]),item];
    const keys=new Set(terms.map(normalize).filter(Boolean));
    return {className,group,item,keys};
  }).filter(row=>row.className&&row.group&&row.item&&row.keys.size
    &&(!classFilter||normalize(row.className)===normalize(classFilter)));
  const totals=new Map();
  for(const media of Array.isArray(mediaRows)?mediaRows:[]){
    const day=mediaDay(media?.createtime);
    if(!day)continue;
    const tags=new Set(mediaStyleTags(media?.description).map(normalize));
    if(!tags.size)continue;
    const labels=new Set();
    for(const row of catalog){
      if(![...row.keys].some(key=>tags.has(key)))continue;
      labels.add(level==='class'?row.className
        :level==='group'?row.className+' / '+row.group
          :row.className+' / '+row.group+' / '+row.item);
    }
    for(const category of labels){
      const key=day+'\u0000'+normalize(category);
      const record=totals.get(key);
      if(record)record.item_count++;
      else totals.set(key,{day,category,item_count:1});
    }
  }
  return [...totals.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.category.localeCompare(b.category));
}

/** Shared media statistics capability object: base, intersections and taxonomy extensions. */
export const StatisticsFacets=Object.freeze({
  base:Object.freeze({mediaDay,mediaPlatform,mediaStyleTags,mediaFacetDaily}),
  cross:Object.freeze({mediaCrossTagCatalog,defaultMediaCrossAxes,mediaCrossIntersections}),
  style:Object.freeze({styleTreeClasses,mediaStyleTreeDaily})
});
