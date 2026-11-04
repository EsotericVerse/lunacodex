// UI dictionaries: one module per language. Galaxy/rune/authored content is never translated.
// Traditional Chinese is the default. Other language dictionaries are
// imported only for the selected language (loadUiLocale).
import zhTw from './zh_tw.js';

function interpolate(template,values={}){
  return String(template||'').replace(/\{(label|query)\}/g,(_,key)=>String(values[key]??''));
}

function withFormat(content){
  const f=content.formatMessages;
  // Not frozen: feature/scope-owned sections (search, statistics, culture, …)
  // are merged into this same object on demand by registerDefaultSection/
  // mergeLoadedSection below, long after the per-locale dictionary first
  // loads. Leaf values stay exactly what the source file provided.
  return {...content,format:Object.freeze({
    searchScope:label=>interpolate(f.searchScope,{label}),
    searchResult:({label,query,hasMore,partial=''})=>
      interpolate(f.result,{label,query})+(hasMore?f.more:f.end)+partial,
    relatedText:index=>f.relatedText+' '+index,
    link:index=>f.link+' '+index,
    songLink:index=>f.songLink+' '+index,
    period:index=>f.period+' '+index,
    selected:value=>f.selected+value
  })};
}

const zhHant=withFormat(zhTw);

export const UI_LOCALE='zh-Hant';
export const UI_LOCALE_OPTIONS=Object.freeze([
  Object.freeze({value:'zh-Hant',label:'繁體中文'}),
  Object.freeze({value:'zh-Hans',label:'简体中文'}),
  Object.freeze({value:'en',label:'English'}),
  Object.freeze({value:'ja',label:'日本語'})
]);
export const UI_COPY=zhHant;
// Filled in by loadUiLocale; until a language is loaded its lookups fall back
// to the default dictionary.
export const UI_DICTIONARIES={'zh-Hant':zhHant};
const LOADERS={
  'zh-Hans':()=>import('./zh_cn.js'),
  en:()=>import('./en.js'),
  ja:()=>import('./ja.js')
};
const pending={};
export function isUiLocaleLoaded(locale){return Boolean(UI_DICTIONARIES[locale]);}
export function loadUiLocale(locale){
  const value=String(locale||'').trim();
  if(UI_DICTIONARIES[value])return Promise.resolve(UI_DICTIONARIES[value]);
  if(!Object.hasOwn(LOADERS,value))return Promise.resolve(zhHant);
  // Only fetch the selected language; other locales stay out of the bundle.
  pending[value]??=LOADERS[value]().then(mod=>{
    UI_DICTIONARIES[value]=withFormat(mod.default);
    return UI_DICTIONARIES[value];
  }).catch(error=>{
    delete pending[value]; // A transient chunk failure must not block retries.
    throw error;
  });
  return pending[value];
}

// Strings that belong to lazily loaded features (keyword library, private
// files, timeline editor, item confluence, daily-rune analytics). They live in
// features.<language>.js and are fetched on demand, not bundled into the shell.
// Feature copy is split by language AND feature; never load all features for one page.
const FEATURE_LOADERS={
  "zh-Hant":{
    dailyRune:()=>import('./feature-sections/dailyRune.zh_tw.js'),
    privateFiles:()=>import('./feature-sections/privateFiles.zh_tw.js'),
    itemConfluence:()=>import('./feature-sections/itemConfluence.zh_tw.js')
  },
  "zh-Hans":{
    dailyRune:()=>import('./feature-sections/dailyRune.zh_cn.js'),
    privateFiles:()=>import('./feature-sections/privateFiles.zh_cn.js'),
    itemConfluence:()=>import('./feature-sections/itemConfluence.zh_cn.js')
  },
  "en":{
    dailyRune:()=>import('./feature-sections/dailyRune.en.js'),
    privateFiles:()=>import('./feature-sections/privateFiles.en.js'),
    itemConfluence:()=>import('./feature-sections/itemConfluence.en.js')
  },
  "ja":{
    dailyRune:()=>import('./feature-sections/dailyRune.ja.js'),
    privateFiles:()=>import('./feature-sections/privateFiles.ja.js'),
    itemConfluence:()=>import('./feature-sections/itemConfluence.ja.js')
  }
};
const featureCopy={};
const featurePending={};
export function isFeatureCopyLoaded(locale,section){
  return Object.hasOwn(featureCopy[locale]||{},section);
}
export function loadFeatureCopy(locale,section){
  const loader=FEATURE_LOADERS[locale]?.[section];
  if(!loader)return Promise.resolve(null);
  featureCopy[locale]??={};
  if(isFeatureCopyLoaded(locale,section))return Promise.resolve(featureCopy[locale][section]);
  const key=locale+'::'+section;
  featurePending[key]??=loader().then(mod=>{
    featureCopy[locale][section]=mod.default;
    delete featurePending[key];
    return mod.default;
  }).catch(error=>{delete featurePending[key];throw error;});
  return featurePending[key];
}
export function featureSection(locale,section,defaults){
  return featureCopy[locale]?.[section]||defaults;
}

// Sections split out of the per-locale dictionaries themselves (as opposed
// to FEATURE_LOADERS above, which covers whole standalone feature files).
// A section is addressed by a dotted path such as 'search' or
// 'uiExtra.editBlocks'. The feature file that owns a section statically
// imports its own Traditional Chinese copy and registers it with
// registerDefaultSection — so the default locale never performs a network
// fetch and a lookup can never read `undefined` — while the other three
// locales fetch their copy on demand via loadSection. Either way the result
// is merged into the same per-locale dictionary object that uiCopy()
// returns, so every existing lookup style (`copy.search.x`,
// `<UiText id="search.x"/>`, `<UiText id="uiExtra.editBlocks.x"/>`) keeps
// working unchanged once the section has arrived.


const SECTION_LOADERS={
  'zh-Hans':{
    'search':()=>import('./sections/search.zh_cn.js'),
    'statistics':()=>import('./sections/statistics.zh_cn.js'),
    'culture':()=>import('./sections/culture.zh_cn.js'),
    'management':()=>import('./sections/management.zh_cn.js'),
    'admin':()=>import('./sections/admin.zh_cn.js'),
    'uiExtra.scopeGroup':()=>import('./sections/uiExtra.scopeGroup.zh_cn.js'),
    'uiExtra.genericScope':()=>import('./sections/uiExtra.genericScope.zh_cn.js'),
    'uiExtra.keywords':()=>import('./sections/uiExtra.keywords.zh_cn.js'),
    'uiExtra.scopeSettings':()=>import('./sections/uiExtra.scopeSettings.zh_cn.js'),
    'uiExtra.searchUI':()=>import('./sections/uiExtra.searchUI.zh_cn.js'),
    'uiExtra.statisticsUI':()=>import('./sections/uiExtra.statisticsUI.zh_cn.js'),
    'uiExtra.importUI':()=>import('./sections/uiExtra.importUI.zh_cn.js'),
    'uiExtra.statisticsView':()=>import('./sections/uiExtra.statisticsView.zh_cn.js'),
    'uiExtra.chartTypes':()=>import('./sections/uiExtra.chartTypes.zh_cn.js'),
    'uiExtra.chartLabels':()=>import('./sections/uiExtra.chartLabels.zh_cn.js'),
    'uiExtra.globalSettings':()=>import('./sections/uiExtra.globalSettings.zh_cn.js'),
    'uiExtra.editBlocks':()=>import('./sections/uiExtra.editBlocks.zh_cn.js'),
    'uiExtra.sourceCategory':()=>import('./sections/uiExtra.sourceCategory.zh_cn.js'),
    'uiExtra.sharing':()=>import('./sections/uiExtra.sharing.zh_cn.js'),
    'uiExtra.publisher':()=>import('./sections/uiExtra.publisher.zh_cn.js'),
    'uiExtra.pagination':()=>import('./sections/uiExtra.pagination.zh_cn.js'),
    'uiExtra.adminView':()=>import('./sections/uiExtra.adminView.zh_cn.js'),
    'uiExtra.cultureView':()=>import('./sections/uiExtra.cultureView.zh_cn.js'),
    'uiExtra.cultureTimeline':()=>import('./sections/uiExtra.cultureTimeline.zh_cn.js'),
    'uiExtra.selfIntersection':()=>import('./sections/uiExtra.selfIntersection.zh_cn.js'),
    'uiExtra.dataErrors':()=>import('./sections/uiExtra.dataErrors.zh_cn.js'),
    'uiExtra.frameEditor':()=>import('./sections/uiExtra.frameEditor.zh_cn.js'),
    'fields':()=>import('./sections/fields.zh_cn.js'),
    'uiExtra.feature':()=>import('./sections/uiExtra.feature.zh_cn.js'),
    'uiExtra.dataSourceStatus':()=>import('./sections/uiExtra.dataSourceStatus.zh_cn.js'),
  },
  'en':{
    'search':()=>import('./sections/search.en.js'),
    'statistics':()=>import('./sections/statistics.en.js'),
    'culture':()=>import('./sections/culture.en.js'),
    'management':()=>import('./sections/management.en.js'),
    'admin':()=>import('./sections/admin.en.js'),
    'uiExtra.scopeGroup':()=>import('./sections/uiExtra.scopeGroup.en.js'),
    'uiExtra.genericScope':()=>import('./sections/uiExtra.genericScope.en.js'),
    'uiExtra.keywords':()=>import('./sections/uiExtra.keywords.en.js'),
    'uiExtra.scopeSettings':()=>import('./sections/uiExtra.scopeSettings.en.js'),
    'uiExtra.searchUI':()=>import('./sections/uiExtra.searchUI.en.js'),
    'uiExtra.statisticsUI':()=>import('./sections/uiExtra.statisticsUI.en.js'),
    'uiExtra.importUI':()=>import('./sections/uiExtra.importUI.en.js'),
    'uiExtra.statisticsView':()=>import('./sections/uiExtra.statisticsView.en.js'),
    'uiExtra.chartTypes':()=>import('./sections/uiExtra.chartTypes.en.js'),
    'uiExtra.chartLabels':()=>import('./sections/uiExtra.chartLabels.en.js'),
    'uiExtra.globalSettings':()=>import('./sections/uiExtra.globalSettings.en.js'),
    'uiExtra.editBlocks':()=>import('./sections/uiExtra.editBlocks.en.js'),
    'uiExtra.sourceCategory':()=>import('./sections/uiExtra.sourceCategory.en.js'),
    'uiExtra.sharing':()=>import('./sections/uiExtra.sharing.en.js'),
    'uiExtra.publisher':()=>import('./sections/uiExtra.publisher.en.js'),
    'uiExtra.pagination':()=>import('./sections/uiExtra.pagination.en.js'),
    'uiExtra.adminView':()=>import('./sections/uiExtra.adminView.en.js'),
    'uiExtra.cultureView':()=>import('./sections/uiExtra.cultureView.en.js'),
    'uiExtra.cultureTimeline':()=>import('./sections/uiExtra.cultureTimeline.en.js'),
    'uiExtra.selfIntersection':()=>import('./sections/uiExtra.selfIntersection.en.js'),
    'uiExtra.dataErrors':()=>import('./sections/uiExtra.dataErrors.en.js'),
    'uiExtra.frameEditor':()=>import('./sections/uiExtra.frameEditor.en.js'),
    'fields':()=>import('./sections/fields.en.js'),
    'uiExtra.feature':()=>import('./sections/uiExtra.feature.en.js'),
    'uiExtra.dataSourceStatus':()=>import('./sections/uiExtra.dataSourceStatus.en.js'),
  },
  'ja':{
    'search':()=>import('./sections/search.ja.js'),
    'statistics':()=>import('./sections/statistics.ja.js'),
    'culture':()=>import('./sections/culture.ja.js'),
    'management':()=>import('./sections/management.ja.js'),
    'admin':()=>import('./sections/admin.ja.js'),
    'uiExtra.scopeGroup':()=>import('./sections/uiExtra.scopeGroup.ja.js'),
    'uiExtra.genericScope':()=>import('./sections/uiExtra.genericScope.ja.js'),
    'uiExtra.keywords':()=>import('./sections/uiExtra.keywords.ja.js'),
    'uiExtra.scopeSettings':()=>import('./sections/uiExtra.scopeSettings.ja.js'),
    'uiExtra.searchUI':()=>import('./sections/uiExtra.searchUI.ja.js'),
    'uiExtra.statisticsUI':()=>import('./sections/uiExtra.statisticsUI.ja.js'),
    'uiExtra.importUI':()=>import('./sections/uiExtra.importUI.ja.js'),
    'uiExtra.statisticsView':()=>import('./sections/uiExtra.statisticsView.ja.js'),
    'uiExtra.chartTypes':()=>import('./sections/uiExtra.chartTypes.ja.js'),
    'uiExtra.chartLabels':()=>import('./sections/uiExtra.chartLabels.ja.js'),
    'uiExtra.globalSettings':()=>import('./sections/uiExtra.globalSettings.ja.js'),
    'uiExtra.editBlocks':()=>import('./sections/uiExtra.editBlocks.ja.js'),
    'uiExtra.sourceCategory':()=>import('./sections/uiExtra.sourceCategory.ja.js'),
    'uiExtra.sharing':()=>import('./sections/uiExtra.sharing.ja.js'),
    'uiExtra.publisher':()=>import('./sections/uiExtra.publisher.ja.js'),
    'uiExtra.pagination':()=>import('./sections/uiExtra.pagination.ja.js'),
    'uiExtra.adminView':()=>import('./sections/uiExtra.adminView.ja.js'),
    'uiExtra.cultureView':()=>import('./sections/uiExtra.cultureView.ja.js'),
    'uiExtra.cultureTimeline':()=>import('./sections/uiExtra.cultureTimeline.ja.js'),
    'uiExtra.selfIntersection':()=>import('./sections/uiExtra.selfIntersection.ja.js'),
    'uiExtra.dataErrors':()=>import('./sections/uiExtra.dataErrors.ja.js'),
    'uiExtra.frameEditor':()=>import('./sections/uiExtra.frameEditor.ja.js'),
    'fields':()=>import('./sections/fields.ja.js'),
    'uiExtra.feature':()=>import('./sections/uiExtra.feature.ja.js'),
    'uiExtra.dataSourceStatus':()=>import('./sections/uiExtra.dataSourceStatus.ja.js'),
  },
};

const loadedSectionPaths={'zh-Hant':new Set(),'zh-Hans':new Set(),en:new Set(),ja:new Set()};
const sectionPending={};
let sectionVersion=0;
const sectionListeners=new Set();
function bumpSectionVersion(){
  sectionVersion+=1;
  for(const listener of sectionListeners)listener();
}
// Lets ui-locale.jsx force a context re-render whenever any section finishes
// loading anywhere, so already-mounted UiText/FieldText/useUiCopy consumers
// pick up the freshly merged data without each needing its own plumbing.
export function subscribeSectionVersion(listener){
  sectionListeners.add(listener);
  return ()=>sectionListeners.delete(listener);
}

function setAtPath(target,path,value){
  const keys=path.split('.');
  let node=target;
  for(let i=0;i<keys.length-1;i++){
    const key=keys[i];
    if(typeof node[key]!=='object'||node[key]===null)node[key]={};
    node=node[key];
  }
  node[keys[keys.length-1]]=value;
}
function getAtPath(source,path){
  return path.split('.').reduce((value,key)=>value?.[key],source);
}

export function isSectionLoaded(locale,path){
  return locale==='zh-Hant'||Boolean(loadedSectionPaths[locale]?.has(path));
}
// Called at module-evaluation time by the feature file that owns this
// section (before that file's component function ever runs), so the
// default locale's copy of the section is always present synchronously —
// both for `copy.<path>` style reactive reads and for any direct
// `UI_COPY.<path>` static read in the same file.
export function registerDefaultSection(path,value){
  if(loadedSectionPaths['zh-Hant'].has(path))return;
  setAtPath(zhHant,path,value);
  loadedSectionPaths['zh-Hant'].add(path);
  bumpSectionVersion();
}
export function loadSection(locale,path){
  if(locale==='zh-Hant')return Promise.resolve(getAtPath(zhHant,path));
  if(loadedSectionPaths[locale]?.has(path))return Promise.resolve(getAtPath(UI_DICTIONARIES[locale],path));
  const loader=SECTION_LOADERS[locale]?.[path];
  if(!loader)return Promise.resolve(getAtPath(zhHant,path));
  const key=locale+'::'+path;
  sectionPending[key]??=loadUiLocale(locale).then(()=>loader()).then(mod=>{
    setAtPath(UI_DICTIONARIES[locale],path,mod.default);
    loadedSectionPaths[locale].add(path);
    bumpSectionVersion();
    return mod.default;
  }).catch(error=>{
    delete sectionPending[key];
    throw error;
  });
  return sectionPending[key];
}

export function normalizeUiLocale(locale){
  const value=String(locale||'').trim();
  return Object.hasOwn(LOADERS,value)||value===UI_LOCALE?value:UI_LOCALE;
}

// One authoritative dictionary for both key-based UI copy and authored
// interface labels that still use legacy field names.
export function translateUiField(locale,text){
  const value=String(text??'');
  const translated=UI_DICTIONARIES[locale]?.fields?.[value];
  return translated||(locale==='ja'?UI_DICTIONARIES.en?.fields?.[value]:null)||value;
}

export function uiCopy(locale=UI_LOCALE){
  return UI_DICTIONARIES[normalizeUiLocale(locale)]||zhHant;
}
