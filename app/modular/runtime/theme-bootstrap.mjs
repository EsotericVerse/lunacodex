import {SCOPE_ROUTE_INDEX} from '../routing/scope-route-index.js';
import {PUBLISHED_THEME_META} from '../published-theme-meta.js';

const AUTO_DAY_THEME_ID='theme-7';
const AUTO_NIGHT_THEME_ID='theme-1';
const GAME_BOOTSTRAP_THEME_ID='theme-4';
// Each HTML document owns its own palette and native navigation bootstrap.
export const NATIVE_STATIC_ROUTE_SCRIPT=`(()=>{try{
  if(window.location.protocol!=='capacitor:')return;
  const {pathname,search,hash}=window.location;
  // Device-local lease checks run even on static homepages; no React shell.
  try{
    const key='loc-device-local-core-until-v1';
    const saved=window.localStorage.getItem(key);
    const now=Date.now(),deadline=Number(saved);
    const active=saved!==null&&Number.isSafeInteger(deadline)&&
      deadline>now&&deadline<=now+3600000;
    const local=pathname.startsWith('/local/')||pathname.startsWith('/my-phone/');
    if(active&&!local){window.location.replace('/local/index.html');return;}
    if(saved!==null&&!active&&local){
      window.localStorage.removeItem(key);
      window.location.replace('/index.html');return;
    }
  }catch{}
  if(!/\\/index\\.html$/.test(pathname))return;
  window.history.replaceState(window.history.state,'',pathname.slice(0,-'index.html'.length)+search+hash);
}catch{}})();`;
// All eight published palettes are linked by the authored HTML build before first
// paint. Their selectors are mutually exclusive by data-theme-id; switching the
// theme only changes the selected root attribute, never inserts/removes CSS.
const PUBLISHED_THEME_SCHEMES=Object.fromEntries(PUBLISHED_THEME_META.map(row=>[row[0],row[2]]));
export const INITIAL_THEME_SCRIPT=`(()=>{try{
  let hour=new Date().getHours();
  try{
    const part=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).find(x=>x.type==='hour');
    if(part)hour=Number(part.value);
  }catch{}
  const auto=hour>=6&&hour<18?'theme-7':'theme-1';
  const schemes=${JSON.stringify(PUBLISHED_THEME_SCHEMES)};
  const root=document.documentElement;
  root.dataset.themeId=auto;
  root.dataset.theme=schemes[auto]||'light';
  root.style.colorScheme=root.dataset.theme;
  root.dataset.themeBootstrap='correct-id';
  // A system-chosen theme number is a hint, never a saved manual override.
  try{window.sessionStorage.setItem('loc-default-theme-id-v1',auto);}catch{}
}catch{}})();`;
