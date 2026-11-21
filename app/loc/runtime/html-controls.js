import {loadUiLocale,normalizeUiLocale} from '../../i18n/ui-copy.js';
import {PUBLISHED_THEME_META} from '../../modular/published-theme-meta.js';
import {activatePublishedTheme} from '../../modular/theme-registry.js';

const localeLabels={home:'首頁',culture:'文化',statics:'統計',trace:'痕跡',search:'搜尋',settings:'設定'};
async function changeTheme(id,scope){
  const allowed=new Set(PUBLISHED_THEME_META.map(item=>item[0]));
  if(id!=='system-default'&&!allowed.has(id))return;
  try{
    const key='loc-user-theme-selection-v1';
    const values=JSON.parse(sessionStorage.getItem(key)||'{}');
    if(id==='system-default')delete values[scope];
    else values[scope]=Number(id.slice(6));
    sessionStorage.setItem(key,JSON.stringify(values));
  }catch{}
  if(id==='system-default'){window.location.reload();return;}
  sessionStorage.setItem('loc-active-theme-id-v1',id);
  await activatePublishedTheme(id);
}
async function changeLocale(requested){
  const locale=normalizeUiLocale(requested);
  const copy=await loadUiLocale(locale,location.pathname);
  window.__locHtmlLocale=locale;
  document.documentElement.lang=locale;
  const text=(selector,value)=>{
    if(!value)return;
    for(const item of document.querySelectorAll(selector))item.textContent=value;
  };
  text('[data-loc-home-link]',copy.nav?.home||'首頁');
  text('[data-loc-label="theme"]',copy.common?.theme||'主題');
  text('[data-loc-label="language"]',copy.common?.language||'語系');
  for(const element of document.querySelectorAll('[data-loc-feature-link]')){
    const key=element.dataset.locFeatureLink;
    const translated=key==='home'?copy.nav?.home:key==='settings'?copy.common?.settings:copy.features?.[key]?.title;
    if(translated)text('[data-loc-feature-link="'+key+'"] [data-loc-feature-label]',translated);
  }
  for(const el of document.querySelectorAll('[data-loc-scope-link]')){
    const key=el.dataset.locScopeLink;
    if(key==='lrunes')el.textContent=copy.nav?.lunarunes||'月之符文';
    if(key==='lo3rwang')el.textContent=copy.nav?.author||'政德';
  }
  window.dispatchEvent(new CustomEvent('loc-html-locale-changed',{detail:{locale}}));
}
export async function applyHtmlPreference(kind,value,scope='loc'){
  if(kind==='theme')return changeTheme(value,scope);
  if(kind==='locale')return changeLocale(value);
}