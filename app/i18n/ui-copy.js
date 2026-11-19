// Route-local interface copy. Each page.jsx owns four sibling i18n JSON files.
// Web fetches exactly one selected page JSON; Capacitor serves the same copied
// assets from its bundled filesystem. Never prefetch a different language.
export const UI_LOCALE='zh-Hant';
export const UI_LOCALE_OPTIONS=Object.freeze([
  Object.freeze({value:'zh-Hant',label:'繁體中文'}),
  Object.freeze({value:'zh-Hans',label:'简体中文'}),
  Object.freeze({value:'en',label:'English'}),
  Object.freeze({value:'ja',label:'日本語'})
]);
const FILE_FOR_LOCALE=Object.freeze({
  'zh-Hant':'zh_tw','zh-Hans':'zh_cn',en:'en',ja:'ja'
});

// A tiny synchronous Traditional Chinese shell seed for the first paint.
// Page-local dictionaries are fetched only for the page actually requested.
const SEED={
  common:{save:'儲存',saving:'儲存中…',cancel:'取消',title:'標題',body:'內容',
    language:'語系',theme:'主題',systemTheme:'系統預設',settings:'設定',
    management:'管理',loading:'載入中…',hiddenFromSearch:'不列入搜尋'},
  nav:{aria:'網站導覽',home:'首頁',lunarunes:'月之符文',author:'作者',
    search:'搜尋',searchAria:'搜尋文字',contact:'聯絡'},
  features:{
    statics:{title:'統計'},culture:{title:'文化'},trace:{title:'痕跡'},
    search:{title:'搜尋'},admin:{title:'系統管理'},manage:{title:'管理'},
    setting:{title:'設定'}
  },
  scope:{loc:{statics:'統計',culture:'文化',trace:'痕跡',search:'搜尋'},
    author:{search:'搜尋'}},
  culture:{allTime:'全部時間'},
  search:{externalLink:'外部連結',mediaLink:'媒體連結'},
  statistics:{item:'項目',chart:'圖表'},
  formatMessages:{searchScope:'搜尋 {label}',result:'{label}：{query}',
    more:'',end:'',relatedText:'相關文字',link:'連結',songLink:'歌曲連結',
    period:'期間',selected:'已選取：'},
  fields:{},uiExtra:{dataSourceStatus:{
    detailsTitle:'資料來源',localTitle:'本機資料',localActive:'本機資料庫',
    unavailable:'資料來源無法使用',backup:'備援',primary:'主要'
  }},featureCopy:{}
};
function interpolate(template,values={}){
  return String(template||'').replace(/\{(label|query)\}/g,(_,key)=>String(values[key]??''));
}
function withFormat(core,page){
  const f=core.formatMessages||SEED.formatMessages;
  const content={...core,...page,
    uiExtra:{...(core.uiExtra||{}),...(page.uiExtra||{})},
    featureCopy:{...(page.featureCopy||{})}};
  content.format=Object.freeze({
    searchScope:label=>interpolate(f.searchScope,{label}),
    searchResult:({label,query,hasMore,partial=''})=>
      interpolate(f.result,{label,query})+(hasMore?f.more:f.end)+partial,
    relatedText:index=>f.relatedText+' '+index,
    link:index=>f.link+' '+index,
    songLink:index=>f.songLink+' '+index,
    period:index=>f.period+' '+index,
    selected:value=>f.selected+value
  });
  return content;
}
export const UI_COPY=withFormat(SEED,{});
const EMPTY_COPY=withFormat(SEED,{});
export const UI_DICTIONARIES={};
const sharedCache=new Map();
const loadedPages=new Map();
const inFlight=new Map();
const loadErrors=new Map();
let activeKey='';
let sectionVersion=0;
const listeners=new Set();
const MAX_PAGE_DICTIONARIES=12;

export function normalizeUiLocale(locale){
  const value=String(locale||'').trim();
  return Object.hasOwn(FILE_FOR_LOCALE,value)?value:UI_LOCALE;
}
export function pageLocaleRoute(pathname='/'){
  const path=String(pathname||'/').split('?')[0].split('#')[0]
    .replace(/\/index\.html$/i,'').replace(/\/+$/,'');
  if(!path||path==='/')return 'index';
  const parts=path.split('/').filter(Boolean);
  // An unknown/non-page route must not be allowed to read arbitrary assets.
  if(parts.some(part=>!/^[a-zA-Z0-9_-]+$/.test(part)))return 'index';
  return parts.join('/');
}
function localeKey(locale,pathname){
  return normalizeUiLocale(locale)+'|'+pageLocaleRoute(pathname);
}
function assetUrl(locale,pathname){
  return '/i18n/pages/'+pageLocaleRoute(pathname)+'/'+FILE_FOR_LOCALE[normalizeUiLocale(locale)]+'.json';
}
async function readJson(url){
  const response=await fetch(url,{credentials:'same-origin',cache:'default'});
  if(!response.ok)throw new Error('Interface locale asset '+url+' failed (HTTP '+response.status+')');
  const data=await response.json();
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('Invalid interface locale JSON: '+url);
  return data;
}
function sharedFor(locale){
  const key=normalizeUiLocale(locale);
  if(!sharedCache.has(key)){
    sharedCache.set(key,readJson('/i18n/shared/'+FILE_FOR_LOCALE[key]+'.json')
      .catch(error=>{sharedCache.delete(key);throw error;}));
  }
  return sharedCache.get(key);
}
function notify(){
  sectionVersion++;
  for(const listener of listeners)listener();
}
export function subscribeSectionVersion(listener){
  listeners.add(listener);
  return ()=>listeners.delete(listener);
}
function activate(key,copy){
  if(key!==activeKey)return;
  const locale=key.split('|')[0];
  for(const name of Object.keys(UI_COPY))delete UI_COPY[name];
  Object.assign(UI_COPY,copy);
  UI_DICTIONARIES[locale]=copy;
  notify();
}
function retain(key,copy){
  loadedPages.delete(key);
  loadedPages.set(key,copy);
  while(loadedPages.size>MAX_PAGE_DICTIONARIES){
    const oldest=loadedPages.keys().next().value;
    if(oldest===activeKey&&loadedPages.size>1){
      const current=loadedPages.get(oldest);
      loadedPages.delete(oldest);loadedPages.set(oldest,current);continue;
    }
    loadedPages.delete(oldest);
  }
}
export function isUiLocaleLoaded(locale=UI_LOCALE,pathname='/'){
  return loadedPages.has(localeKey(locale,pathname));
}
export function uiLocaleLoadError(locale=UI_LOCALE,pathname='/'){
  return loadErrors.get(localeKey(locale,pathname))||null;
}
export function loadUiLocale(locale=UI_LOCALE,pathname='/'){
  const normalized=normalizeUiLocale(locale),key=localeKey(normalized,pathname);
  activeKey=key;
  if(loadedPages.has(key)){
    const copy=loadedPages.get(key);
    retain(key,copy);activate(key,copy);
    return Promise.resolve(copy);
  }
  if(!inFlight.has(key)){
    loadErrors.delete(key);
    const pending=Promise.all([sharedFor(normalized),readJson(assetUrl(normalized,pathname))])
      .then(([shared,page])=>{
        const copy=withFormat(shared,page);
        retain(key,copy);
        inFlight.delete(key);
        activate(key,copy);
        return copy;
      }).catch(error=>{inFlight.delete(key);loadErrors.set(key,error);notify();throw error;});
    inFlight.set(key,pending);
  }
  return inFlight.get(key);
}
export function uiCopy(locale=UI_LOCALE,pathname='/'){
  const key=localeKey(locale,pathname);
  return loadedPages.get(key)||UI_DICTIONARIES[normalizeUiLocale(locale)]||EMPTY_COPY;
}
export function featureSection(locale,section,defaults={}){
  return uiCopy(locale).featureCopy?.[section]||defaults;
}
export function translateUiField(locale,text){
  const original=String(text??'');
  const translated=UI_DICTIONARIES[normalizeUiLocale(locale)]?.fields?.[original];
  return typeof translated==='string'&&translated?translated:original;
}
