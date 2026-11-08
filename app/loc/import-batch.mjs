// One format contract for JSON Import and Source Refresh. No database authority lives here.
import {MAX_ROWS,MAX_ARCHIVE_BYTES,MAX_JSON_BYTES} from './query-batch-size.mjs';
import {unwrapArchiveArrayRows} from './archive-array-layout.mjs';
import {runeDrawText} from './rune-draw-text.mjs';
// Lightweight file-selection contracts remain separate from parser implementations.
export const UNIVERSAL_IMPORT_ACCEPT='.zip,.json,.md';
export {MAX_ARCHIVE_BYTES as ARCHIVE_MAX_BYTES,MAX_JSON_BYTES as ARCHIVE_JSON_MAX_BYTES};
export const IMPORT_FIELD_ALIASES=Object.freeze({
  uid:['uid'],
  site_id:['site_id','post_id','id_str'],
  content:['content','body','text','message','description'],
  title:['title','name','subject'],
  createtime:['createtime','created_at','create_time','created_time','creation_timestamp','timestamp_ms','timestamp','taken_at','createdAt','createAt','published_at','publishedAt','date'],
  location:['location','place'],
  url:['url'],
  media_link:['media_link'],
  media:['galaxy_media','attachments','media','media_items'],
  media_type:['media_type'],
  galaxy_link:['galaxy_link'],
  description:['description'],
  rune_references:['rune_references'],
  source_id:['source_id'],
  target_id:['target_id'],
  ref_id:['ref_id'],
  searchable:['searchable','search'],
  statistics_able:['statistics_able','statistics']
});


const IMPORT_MEDIA_UID=/^[A-Z0-9]{8}$/i;
function importMediaType(url='',hint=''){
  const type=String(hint||'').trim().toLowerCase();
  if(type)return type;
  const value=String(url||'').toLowerCase();
  if(value.includes('suno.com/'))return 'suno';
  if(/\.(?:png|jpe?g|gif|webp|heic|avif|svg)(?:[?#]|$)/.test(value))return 'image';
  if(/\.(?:mp4|mov|avi|webm|mkv)(?:[?#]|$)/.test(value))return 'video';
  if(/\.(?:mp3|wav|ogg|m4a|flac)(?:[?#]|$)/.test(value))return 'audio';
  return 'url';
}
function parseMediaArray(value){
  if(Array.isArray(value))return value;
  if(value===undefined||value===null||value==='')return [];
  if(typeof value==='object')return [value];
  const text=String(value).trim();
  if(text.startsWith('[')||text.startsWith('{')){
    try{return parseMediaArray(JSON.parse(text))}catch{throw new Error('媒體欄位不是有效的 JSON。')}
  }
  return text.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean);
}
// Preserve references to existing media IDs; prepare new media records without inventing
// accessible URLs for archive-local attachment paths.
export function normalizeImportMedia(value,{title='',createtime=null,location='',article_uid=''}={}){
  const references=[],records=[],seen=new Set();
  for(const [index,item] of parseMediaArray(value).entries()){
    const source=typeof item==='string'?{url:item}:item;
    if(!source||typeof source!=='object')continue;
    const explicitId=String(source.uid||'').trim();
    const rawUrl=String(source.media_url||source.mediaUrl||source.image_url||source.video_url||source.download_url||source.downloadUrl||source.url||source.uri||source.href||source.link||'').trim();
    if(explicitId&&!IMPORT_MEDIA_UID.test(explicitId))throw new Error('媒體 uid 必須為 8 碼英數字。');
    if((typeof item==='string'&&IMPORT_MEDIA_UID.test(item))||(explicitId&&!rawUrl&&!source.media_type&&!source.type&&!source.title&&!source.name&&!source.description)){
      references.push(typeof item==='string'?item:explicitId);
      continue;
    }
    const external=/^https?:\/\//i.test(rawUrl)?rawUrl:null;
    if(!external&&!rawUrl&&!source.media_type&&!source.type&&!source.mime_type&&!source.title&&!source.name&&!source.description&&source.rune_references==null)continue;
    const media_type=importMediaType(rawUrl,source.media_type||source.type||source.mime_type||
      (source.image_url?'image':source.video_url?'video':source.rune_references!=null?'runes':''));
    const record={
      ...(explicitId?{uid:explicitId}:{}),
      __article_uid:article_uid||null,
      location:String(source.location||'').trim()||null,
      media_type,
      title:String(source.title||source.name||title||'').trim()||null,
      url:external,
      description:(()=>{
        const description=source.description;
        if(description===undefined||description===null)return null;
        const normalized=['rune','runes'].includes(media_type)
          ?runeDrawText(description)
          :(typeof description==='string'?description.trim():JSON.stringify(description));
        return normalized||null;
      })(),
      // Article-led LOC: media Anchor creation reference follows the source
      // article's exact createtime. A media-only import uses its own stamp.
      createtime:parseImportCreatedTime(createtime)||
        parseImportCreatedTime(source.createtime??source.created_at??
          source.creation_timestamp??source.taken_at??source.timestamp)||null
    };
    if(source.rune_references!==undefined)record.rune_references=source.rune_references;
    const key=explicitId?'id:'+explicitId:(external?JSON.stringify([external,media_type]):'item:'+index);
    if(!seen.has(key)){seen.add(key);records.push(record);}
  }
  return {references:[...new Set(references)],records};
}

function pathValue(row,path){
  // Accept dotted and Meta bracket paths without evaluating expressions.
  const normalized=String(path||'').trim()
    .replace(/\[\s*["']([a-zA-Z_][\w-]*)["']\s*\]/g,'.$1')
    .replace(/\[\s*(\d+)\s*\]/g,'.$1');
  if(/[\[\]]/.test(normalized))return undefined;
  const segments=normalized.split('.').filter(Boolean);
  if(!segments.length)return undefined;
  return segments.reduce((value,segment)=>{
    if(value===null||value===undefined||typeof value!=='object')return undefined;
    return Object.prototype.hasOwnProperty.call(value,segment)?value[segment]:undefined;
  },row);
}

export function mappedImportValue(row,field,fieldMap={}){
  const custom=String(fieldMap?.[field]||'').trim();
  const paths=custom?custom.split(/[\n,，]/g).map(value=>value.trim()).filter(Boolean):(IMPORT_FIELD_ALIASES[field]||[]);
  for(const key of paths){
    const value=pathValue(row,key);
    if(value!==undefined&&value!==null&&!(typeof value==='string'&&value.trim()===''))return value;
  }
  return '';
}

export function importRowsFromJson(payload,recordPath=''){
  const selected=String(recordPath||'').trim();
  const container=selected?pathValue(payload,selected):payload;
  if(selected&&container===undefined)throw new Error('找不到資料陣列路徑：'+selected);
  if(Array.isArray(container))return unwrapArchiveArrayRows(container);
  if(container&&typeof container==='object'){
    // A Meta export can wrap the actual records in array.array, including
    // arrays of one-property array envelopes. Preserve normal record arrays
    // inside each post (media, data and attachments).
    const keys=['items','posts','data','records','status_updates','your_posts',
      'text_post_app_text_posts','threads_posts','thread_posts','threads_and_replies','array'];
    for(const key of keys){
      if(Array.isArray(container[key]))return unwrapArchiveArrayRows(container[key]);
      if(key==='array'&&container[key]&&typeof container[key]==='object'){
        const nested=importRowsFromJson(container[key]);
        if(nested.length)return nested;
      }
    }
    if(selected||['content','body','text','message','description','title','uid']
      .some(key=>Object.prototype.hasOwnProperty.call(container,key)))return [container];
  }
  throw new Error('找不到可匯入的資料陣列；請在格式設定指定資料路徑。');
}

// Preserve the original timestamp when available. Unix seconds and milliseconds
// must not be confused; a missing/unreadable source timestamp gets import time.
export function parseImportCreatedTime(value){
  if(value===undefined||value===null||value==='')return null;
  const raw=typeof value==='string'?value.trim():value;
  if(raw==='')return null;
  const numeric=typeof raw==='number'?raw:
    typeof raw==='string'&&/^\d{10,13}$/.test(raw)?Number(raw):null;
  const timestamp=numeric===null?raw:
    Math.abs(numeric)<1e11?numeric*1000:numeric;
  const parsed=new Date(timestamp);
  return Number.isNaN(parsed.getTime())?null:parsed.toISOString();
}
// An absent original timestamp is null, never the import clock.
const IMPORT_TIME_KEYS=['createtime','createdAt','createAt','created_at','creation_timestamp','create_time',
  'created_time','timestamp_ms','timestamp','taken_at','published_at','publishedAt','date'];
const IMPORT_TIME_WRAPPERS=['media','data','array','attachments','string_map_data','label_values','core','post','metadata'];
export function extractImportCreatedAt(value,depth=0){
  if(!value||typeof value!=='object'||depth>5)return null;
  if(Array.isArray(value)){
    for(const part of value.slice(0,128)){
      const t=extractImportCreatedAt(part,depth+1);
      if(t)return t;
    }
    return null;
  }
  for(const key of IMPORT_TIME_KEYS){
    const part=value[key];
    if(part==null)continue;
    const t=parseImportCreatedTime(part);
    if(t)return t;
    if(typeof part==='object'){
      const nested=extractImportCreatedAt(part,depth+1);
      if(nested)return nested;
    }
  }
  for(const key of IMPORT_TIME_WRAPPERS){
    if(value[key]&&typeof value[key]==='object'){
      const nested=extractImportCreatedAt(value[key],depth+1);
      if(nested)return nested;
    }
  }
  return null;
}
export function withImportCreatedTime(record,importedAt=new Date().toISOString()){
  return {...record,createtime:parseImportCreatedTime(record?.createtime)||importedAt};
}

// Adjust import write size by observed throughput while keeping requests bounded.
export function createImportBatchSizer({
  initial=256,minimum=128,maximum=1200
}={}){
  const ceiling=Math.min(MAX_ROWS,maximum);
  const floor=Math.min(ceiling,minimum);
  let size=Math.min(ceiling,Math.max(floor,initial));
  let previousRate=0;
  return {
    get size(){return size;},
    observe(rows,elapsedMs){
      if(!rows||!Number.isFinite(elapsedMs)||elapsedMs<0)return size;
      const rate=rows/Math.max(1,elapsedMs);
      if(!previousRate||rate>previousRate*1.08){
        size=Math.min(ceiling,size*2);
      }else if(rate<previousRate*0.8){
        size=Math.max(floor,Math.floor(size/2));
      }
      previousRate=rate;
      return size;
    }
  };
}

// Read-only preview estimate from parsed item counts; not an ETA or a database probe.
// Conservative throughput bands account for date comparison and media linking,
// but actual backend/network latency and existing-record density vary.
export function estimateImportMinutes({articles=0,media=0}={}){
  const articleCount=Math.max(0,Math.floor(Number(articles)||0));
  const mediaCount=Math.max(0,Math.floor(Number(media)||0));
  if(!articleCount&&!mediaCount)return null;
  const min=Math.max(1,Math.ceil(0.5+articleCount/5500+mediaCount/5000));
  const max=Math.max(min+1,Math.ceil(2+articleCount/1200+mediaCount/1200));
  return {min,max};
}

// Only estimate the current measurable stage. Other comparison/write phases
// have independent work and must not be presented as part of this ETA.
export function estimateImportStageMinutes({completed=0,total=0,elapsedMs=0}={}){
  const done=Number(completed),all=Number(total),elapsed=Number(elapsedMs);
  if(!Number.isFinite(done)||!Number.isFinite(all)||!Number.isFinite(elapsed)||
      all<=0||done<=0||done>=all||elapsed<3000||done/all<.1)return null;
  const remainingMs=(elapsed/done)*(all-done);
  if(!Number.isFinite(remainingMs)||remainingMs<0||remainingMs>86400000)return null;
  return {underMinute:remainingMs<60000,minutes:Math.max(1,Math.ceil(remainingMs/60000))};
}

export function validImportBatchSize(){return MAX_ROWS;}

export async function writeImportBatches(records,{writeBatch,onProgress}={}){
  if(!Array.isArray(records))throw new Error('匯入批次資料必須是陣列。');
  if(typeof writeBatch!=='function')throw new Error('匯入寫入函式不存在。');
  const size=MAX_ROWS;
  const total=records.length;
  let completed=0;
  for(let offset=0;offset<total;offset+=size){
    const batch=records.slice(offset,offset+size);
    try{
      const result=await writeBatch(batch,{offset,total});
      if(result&&Number.isInteger(result.count)&&result.count!==batch.length){
        throw new Error('寫入筆數不符：預期 '+batch.length+' 筆，實際 '+result.count+' 筆');
      }
    }catch(error){
      const detail=String(error?.message||error||'未知錯誤');
      throw new Error('第 '+(Math.floor(offset/size)+1)+' 批失敗；已確認完成 '+completed+'／'+total+' 筆。'+detail+'。重新執行前會再次比對已存在 UID。');
    }
    completed+=batch.length;
    onProgress?.({completed,total,percent:Math.round(completed/Math.max(1,total)*100),batch:Math.floor(offset/size)+1,batches:Math.ceil(total/size)});
  }
  return {completed,total,batches:Math.ceil(total/size)};
}
