'use client';

const MOJIBAKE_HINT=/[ÃÂâæåçèéïð]|[\u0080-\u009f]/u;

function mojibakeScore(value){
  const text=String(value??'');
  return (text.match(/[ÃÂâæåçèéïð]/gu)||[]).length
    +(text.match(/[\u0080-\u009f]/gu)||[]).length*2
    +(text.match(/�/gu)||[]).length*4;
}

export function repairMojibakeText(value){
  const source=String(value??'');
  if(!source||!MOJIBAKE_HINT.test(source))return source;
  const chars=Array.from(source);
  if(chars.some(char=>char.codePointAt(0)>255))return source;
  try{
    const bytes=Uint8Array.from(chars,char=>char.codePointAt(0));
    const repaired=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return repaired!==source&&mojibakeScore(repaired)<mojibakeScore(source)?repaired:source;
  }catch{
    return source;
  }
}

export function hasIrrecoverableEncoding(value){
  return String(value??'').includes('�');
}

export function isPureUrlContent(value){
  return /^https?:\/\/\S+$/iu.test(String(value??'').trim());
}

export function normalizeGalaxyContent(value){
  return repairMojibakeText(value).trim();
}

export function normalizeRelationIds(value){
  const values=Array.isArray(value)?value:String(value||'').split(/[,，]/);
  const ids=[...new Set(values.map(item=>String(item||'').trim()).filter(Boolean))];
  return ids.length?ids:null;
}


export async function requireGalaxyContent(value){
  const content=normalizeGalaxyContent(value);
  const {hasBlockNoteContent}=await import('./blocknote-content.mjs');
  if(!content||!hasBlockNoteContent(content))throw new Error('Galaxy 文字作品必須有正文；純媒體請使用多媒體管理功能。');
  if(hasIrrecoverableEncoding(content))throw new Error('正文含不可逆的編碼錯誤字元，請先還原原始文字再寫入。');
  if(isPureUrlContent(content))throw new Error('純 URL 不算文字正文；請使用多媒體管理功能。');
  return content;
}

export function resolveGalaxyTitle(title,content){
  const explicit=repairMojibakeText(title).trim();
  if(explicit)return explicit;
  const text=normalizeGalaxyContent(content).replace(/\s+/g,' ');
  return Array.from(text).filter((_,index)=>index<12).join('');
}


export function publicContentFilters(filters=[]){
  return [
    ...(Array.isArray(filters)?filters:[]),
    {column:'content',operator:'neq',value:''}
  ];
}

export function analysisContentFilters(filters=[]){
  return [
    ...(Array.isArray(filters)?filters:[]),
    {column:'statics',operator:'eq',value:'true'},
    {column:'content',operator:'neq',value:''}
  ];
}

// Galaxy metadata must stay plain text; rich HTML belongs to content only.
const TAG=/<\/?[A-Za-z][A-Za-z0-9:-]*(?=[\s/>])[^>]*>|<!--[\s\S]*?-->|<![Dd][Oo][Cc][Tt][Yy][Pp][Ee][^>]*>|<\?[A-Za-z][^>]*\?>/;
const ENTITY_LT=/&(?:lt|#0*60|#x0*3c);/gi;
const ENTITY_GT=/&(?:gt|#0*62|#x0*3e);/gi;

export function hasHtmlTag(value){
  if(typeof value!=='string')return false;
  const decoded=value.replace(ENTITY_LT,'<').replace(ENTITY_GT,'>');
  return TAG.test(decoded);
}

export function assertPlainGalaxyAttributes(attributes){
  for(const [field,value] of Object.entries(attributes||{})){
    const texts=Array.isArray(value)?value:[value];
    if(texts.some(hasHtmlTag)){
      throw new Error('文章屬性 '+field+' 只能使用純文字，不可包含 HTML 標籤。');
    }
  }
  return attributes;
}

// Shared interaction guard for homepage Blocks and Search/Culture articles.
// Interactive visualisations and native controls must retain their own clicks;
// only non-interactive text/card areas can enter the existing BlockNote editor.
const INTERACTIVE_CONTENT_SELECTOR=[
  'a','button','input','select','textarea','summary',
  '[role="button"]','[role="link"]','[role="tab"]','[role="slider"]',
  '[role="checkbox"]','[role="switch"]','[contenteditable="true"]',
  '[data-no-inline-edit]','[data-chart-interactive]',
  '.recharts-wrapper','.recharts-responsive-container',
  '.vis-timeline','.vis-network','.vis-item',
  'svg','canvas','iframe','video','audio'
].join(',');

export function isInteractiveContentTarget(target,boundary=null){
  const interactive=target?.closest?.(INTERACTIVE_CONTENT_SELECTOR);
  return Boolean(interactive&&(!boundary||(interactive!==boundary&&boundary.contains(interactive))));
}
