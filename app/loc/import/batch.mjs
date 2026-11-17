// One format contract for JSON Import and Source Refresh. No database authority lives here.
// Archive size limits are configuration, not proof of successful large-file import E2E.
import {MAX_ROWS,MAX_ARCHIVE_BYTES,MAX_JSON_BYTES} from '../query/query-batch-size.mjs';
import {unwrapArchiveArrayRows} from '../archive/array-layout.mjs';
import {runeDrawText} from '../runes/rune-draw-text.mjs';
import {sourceImportModel} from '../../../packages/zenstack/import-source-models.mjs';
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
export function normalizeImportMedia(value,{title='',createtime=null,location='',article_uid='',defaultMediaType=''}={}){
  const references=[],records=[],seen=new Set();
  for(const [index,item] of parseMediaArray(value).entries()){
    const source=typeof item==='string'?{url:item}:item;
    if(!source||typeof source!=='object')continue;
    const explicitId=String(source.uid||'').trim();
    const rawUrl=String(source.media_url||source.mediaUrl||source.image_url||source.video_url||source.download_url||source.downloadUrl||source.source_url||source.thumbnail_url||
      source.external?.url||source.file?.url||source.image?.url||
      source.url||source.uri||source.href||source.link||'').trim();
    if(explicitId&&!IMPORT_MEDIA_UID.test(explicitId))throw new Error('媒體 uid 必須為 8 碼英數字。');
    if((typeof item==='string'&&IMPORT_MEDIA_UID.test(item))||(explicitId&&!rawUrl&&!source.media_type&&!source.type&&!source.title&&!source.name&&!source.description)){
      references.push(typeof item==='string'?item:explicitId);
      continue;
    }
    const external=/^https?:\/\//i.test(rawUrl)?rawUrl:null;
    if(!external&&!rawUrl&&!source.media_type&&!source.type&&!source.mime_type&&!source.title&&!source.name&&!source.description&&source.rune_references==null)continue;
    const hint=String(source.type||'').toLowerCase();
    const media_type=importMediaType(rawUrl,source.media_type||
      (hint==='external'||hint==='file'?'':source.type)||
      defaultMediaType||source.mime_type||
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
  if(!segments.includes('*'))return segments.reduce((value,segment)=>{
    if(value===null||value===undefined||typeof value!=='object')return undefined;
    return Object.prototype.hasOwnProperty.call(value,segment)?value[segment]:undefined;
  },row);
  // An explicit array wildcard is a bounded projection, NOT recursive
  // discovery. It preserves every Notion rich-text span in source order.
  let values=[row];
  for(const segment of segments){
    const next=[];
    for(const value of values){
      if(segment==='*'&&Array.isArray(value))next.push(...value);
      else if(value&&typeof value==='object'&&Object.hasOwn(value,segment))
        next.push(value[segment]);
      if(next.length>2048)throw new Error('來源陣列欄位超過 2048 筆，請縮小資料路徑。');
    }
    values=next;
    if(!values.length)return undefined;
  }
  return values;
}

export function mappedImportValue(row,field,fieldMap={},source=''){
  const custom=String(fieldMap?.[field]||'').trim();
  const profile=source&&typeof source==='object'&&source.fields?
    source:sourceImportModel(source,row);
  // Explicit operator mapping wins. Otherwise use the selected SOURCE ZModel's
  // paths before generic Galaxy aliases. No CMS-specific converter or parser.
  const paths=custom?custom.split(/[\n,，]/g).map(value=>value.trim()).filter(Boolean):
    [...(profile?.fields[field]||[]),...(IMPORT_FIELD_ALIASES[field]||[])];
  for(const key of paths){
    let value=pathValue(row,key);
    if(Array.isArray(value)&&['content','title'].includes(field)&&
        value.every(part=>typeof part==='string'))value=value.join('');
    if(value===undefined||value===null||(typeof value==='string'&&!value.trim()))continue;
    // Do not turn REST structured fields into literal "[object Object]" text,
    // IDs or dates. Operators may still import structured media separately.
    if(['content','title','site_id','createtime','url'].includes(field)&&
        typeof value==='object')continue;
    return value;
  }
  return '';
}

// One source-model-directed record selection boundary for standalone JSON.
// Explicit operator path wins. Ambiguous collections fail visibly instead of
// choosing the first generic key (e.g. metadata.data instead of posts).
// Exact, one-level joins declared by the selected ZModel. Keep WordPress
// duplicate meta_key rows intact, and append only direct Notion page blocks.
// Do not recursively traverse CMS trees or create any SQL relation.
function projectImportSourceRelations(rows,payload,source=''){
  const profile=sourceImportModel(source);
  if(!profile?.relations?.length||!payload||typeof payload!=='object'||
      Array.isArray(payload))return rows;
  const validId=value=>(typeof value==='string'||typeof value==='number')
    ?String(value).trim():'';
  const joins=profile.relations.flatMap(rule=>{
    const related=payload[rule.collection];
    if(!Array.isArray(related))return [];
    const byParent=new Map();
    for(const child of related){
      if(!child||typeof child!=='object'||Array.isArray(child))continue;
      const key=validId(pathValue(child,rule.foreignKey));
      if(!key)continue;
      if(!byParent.has(key))byParent.set(key,[]);
      byParent.get(key).push(child);
    }
    return [{rule,byParent}];
  });
  if(!joins.length)return rows;
  return rows.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))return row;
    let projected=row;
    for(const {rule,byParent} of joins){
      const key=validId(pathValue(row,rule.primaryKey));
      const children=key?byParent.get(key):null;
      if(!children?.length)continue;
      if(rule.mode==='attach'){
        const original=projected[rule.target];
        // A source-native object is already authoritative; don't overwrite it.
        if(original!=null&&!Array.isArray(original))continue;
        projected={...projected,[rule.target]:[
          ...(Array.isArray(original)?original:[]),...children]};
      }else if(rule.mode==='append-text'){
        const parts=children.map(child=>mappedImportValue(child,rule.field,{},profile))
          .filter(value=>typeof value==='string'&&value.trim());
        if(!parts.length)continue;
        const previous=typeof projected[rule.target]==='string'?
          projected[rule.target].trim():'';
        projected={...projected,[rule.target]:[previous,...parts].filter(Boolean).join('\n\n')};
      }else if(rule.mode==='collect-media'){
        const candidates=children.flatMap(child=>{
          const kind=String(pathValue(child,rule.typeField)||'').trim();
          if(rule.allowedTypes&&!rule.allowedTypes.includes(kind))return [];
          const raw=mappedImportValue(child,rule.field,{},profile);
          const items=Array.isArray(raw)?raw:[raw];
          return items.flatMap(item=>{
            if(!item)return [];
            if(typeof item==='string')return [{url:item,media_type:kind}];
            if(typeof item==='object'&&!Array.isArray(item))
              return [{...item,media_type:kind}];
            return [];
          });
        });
        if(!candidates.length)continue;
        const existing=projected[rule.target];
        projected={...projected,[rule.target]:[
          ...(Array.isArray(existing)?existing:existing?[existing]:[]),...candidates]};
      }
    }
    return projected;
  });
}

export function importRowsFromJson(payload,recordPath='',source=''){
  const selected=String(recordPath||'').trim();
  const container=selected?pathValue(payload,selected):payload;
  if(selected&&container===undefined)throw new Error('找不到資料陣列路徑：'+selected);
  if(Array.isArray(container))return projectImportSourceRelations(
    unwrapArchiveArrayRows(container),payload,source);
  if(container&&typeof container==='object'){
    if(selected)return [container];
    // A singular CMS post can contain its own media/data arrays. Never
    // promote those arrays to article rows just because they are called data.
    const strongRowKeys=['post_content','post_title','message_body','object_type',
      'properties','paragraph','contentText','message_id','item_id','dm_id',
      'session_id','caption','threadsPostId','fbPostId','igMediaId'];
    if(strongRowKeys.some(key=>Object.hasOwn(container,key)))return [container];

    const profile=sourceImportModel(source);
    const generic=['items','posts','data','records','results','blocks','pages',
      'messages','wp_posts','status_updates','your_posts',
      'text_post_app_text_posts','threads_posts','thread_posts',
      'threads_and_replies','array'];
    const roots=profile?.recordPaths?.length?profile.recordPaths:generic;
    const relationRoots=new Set(profile?.relations?.map(rule=>rule.collection)||[]);
    const populatedPrimary=roots.filter(key=>Array.isArray(container[key])&&
      !relationRoots.has(key));
    const candidates=roots.filter(key=>Array.isArray(container[key])&&
      (!relationRoots.has(key)||!populatedPrimary.length));
    const populated=candidates.filter(key=>container[key].length>0);
    const matches=populated.length?populated:candidates;
    if(matches.length>1)
      throw new Error('找到多個資料陣列（'+matches.join('、')+
        '）；請在進階格式設定選擇資料路徑，避免匯入錯誤內容。');
    if(matches.length===1)return projectImportSourceRelations(
      unwrapArchiveArrayRows(container[matches[0]]),payload,source);
    // Generic title/description fields can also describe an export envelope.
    // They only identify a standalone row after collection roots are excluded.
    if(['content','body','text','message','description','title','uid']
      .some(key=>Object.hasOwn(container,key)))return [container];

    // Retain the existing one-property Meta array envelope, without
    // recursively walking unrelated CMS blocks or nested post contents.
    if(container.array&&typeof container.array==='object'&&
        !Array.isArray(container.array)&&Object.keys(container).length===1)
      return importRowsFromJson(container.array,'',source);
  }
  throw new Error('找不到所選來源可匯入的資料列；請核對來源或在進階格式指定資料路徑。');
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
