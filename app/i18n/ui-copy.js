import DEFAULT_TRADITIONAL_CHINESE from './shared/zh_tw.json';
import {EMPTY_PAGE_LOCALES,PAGE_LOCALE_ALIASES} from './page-locale-manifest.js';
// Route-local interface copy uses shared source bundles declared in
// page-locale-sources.json. Web fetches only the selected page/language asset;
// native packaging can include the same generated assets when needed.
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

// A tiny neutral, synchronous bootstrap contract for module-level UI_COPY
// references. It is not a Traditional Chinese dictionary or a fetched fallback.
const SEED={
  common:{save:'Save',saving:'Saving…',cancel:'Cancel',title:'Title',body:'Body',
    language:'Language',theme:'Theme',systemTheme:'System',settings:'Settings',
    management:'Manage',loading:'Loading…',hiddenFromSearch:'Hidden from search'},
  nav:{aria:'Site navigation',home:'Home',lunarunes:'LunaRunes',author:'Author',
    search:'Search',searchAria:'Search text',contact:'Contact'},
  features:{
    statics:{title:'Statistics'},culture:{title:'Culture'},trace:{title:'Trace'},
    search:{title:'Search'},admin:{title:'Admin'},manage:{title:'Manage'},
    setting:{title:'Settings'}
  },
  scope:{loc:{statics:'Statistics',culture:'Culture',trace:'Trace',search:'Search'},
    author:{search:'Search'}},
  culture:{allTime:'All time'},
  search:{externalLink:'External link',mediaLink:'Media link'},
  statistics:{item:'Item',chart:'Chart'},
  formatMessages:{searchScope:'Searching {label}',result:'{label}: {query}',
    more:'',end:'',relatedText:'Related',link:'Link',songLink:'Song',
    period:'Period',selected:'Selected: '},
  fields:{},uiExtra:{dataSourceStatus:{}},featureCopy:{}
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
// The public shell must always have its base language synchronously.
 // This immutable released JSON is bundled with the app rather than fetched
 // before painting the frame. Dynamic page JSON remains independently loaded.
const BASE_COPY=withFormat({
  ...SEED,...DEFAULT_TRADITIONAL_CHINESE,
  common:{...SEED.common,...DEFAULT_TRADITIONAL_CHINESE.common},
  nav:{...SEED.nav,...DEFAULT_TRADITIONAL_CHINESE.nav},
  features:{...SEED.features,...DEFAULT_TRADITIONAL_CHINESE.features}
},{});
export const UI_COPY={...BASE_COPY};
const EMPTY_COPY=BASE_COPY;
export const UI_DICTIONARIES={[UI_LOCALE]:BASE_COPY};
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
  const key=pageLocaleRoute(pathname)+'/'+FILE_FOR_LOCALE[normalizeUiLocale(locale)];
  return '/i18n/pages/'+(PAGE_LOCALE_ALIASES[key]||key)+'.json';
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
  // A request for the default language is never a prerequisite for the frame.
  if(key===UI_LOCALE)return Promise.resolve(DEFAULT_TRADITIONAL_CHINESE);
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
    const pageAsset=pageLocaleRoute(pathname)+'/'+FILE_FOR_LOCALE[normalized];
    const pageRequest=EMPTY_PAGE_LOCALES.has(pageAsset)
      ?Promise.resolve({}):readJson(assetUrl(normalized,pathname));
    const pending=Promise.all([sharedFor(normalized),pageRequest])
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
  // A previously visited route's dictionary must never become another route's
  // temporary copy while its own JSON is loading. Reuse only the common,
  // synchronously published base until the exact page key is ready.
  return loadedPages.get(key)||EMPTY_COPY;
}
export function featureSection(locale,section,defaults={}){
  return uiCopy(locale).featureCopy?.[section]||defaults;
}
export function translateUiField(locale,text){
  const original=String(text??'');
  const translated=UI_DICTIONARIES[normalizeUiLocale(locale)]?.fields?.[original];
  return typeof translated==='string'&&translated?translated:original;
}
