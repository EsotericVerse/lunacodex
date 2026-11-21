import {SCOPE_ROUTE_INDEX} from '../routing/scope-route-index.js';
import {PUBLISHED_THEME_META} from '../published-theme-meta.js';

const AUTO_DAY_THEME_ID='theme-7';
const AUTO_NIGHT_THEME_ID='theme-1';
const GAME_BOOTSTRAP_THEME_ID='theme-4';
// The exact canonical palette and per-Scope default are loaded on demand in AppShell.
export const NATIVE_STATIC_ROUTE_SCRIPT=`(()=>{try{
  if(window.location.protocol!=='capacitor:')return;
  const {pathname,search,hash}=window.location;
  if(!/\\/index\\.html$/.test(pathname))return;
  window.history.replaceState(window.history.state,'',pathname.slice(0,-'index.html'.length)+search+hash);
}catch{}})();`;
// Static Scope -> Theme ID; bootstrap inserts ONE render-blocking CSS link
// before first paint rather than bundling all eight palettes.
const PUBLISHED_THEME_BY_SCOPE=Object.fromEntries(SCOPE_ROUTE_INDEX.map(row=>
  [row.scope_id,String(row.config?.theme||'')]));
const PUBLISHED_THEME_SCHEMES=Object.fromEntries(PUBLISHED_THEME_META.map(row=>[row[0],row[2]]));
export const INITIAL_THEME_SCRIPT=`(()=>{try{
  const pathname=(window.location.pathname||'/').toLowerCase();
  const hostname=(window.location.hostname||'').toLowerCase();
  const game=/(?:^|\\/)game(?:\\/|$)/.test(pathname);
  const admin=pathname==='/admin'||pathname.startsWith('/admin/');
  const scope=admin?'admin':game?'lrunes':pathname.startsWith('/lo3rwang/')||pathname==='/lo3rwang'
    ?'lo3rwang':pathname.startsWith('/lrunes/')||pathname==='/lrunes'||hostname.startsWith('lrunes.')
    ?'lrunes':hostname.startsWith('lo3rwang.')?'lo3rwang':'loc';
  let hour=new Date().getHours();
  try{
    const part=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).find(x=>x.type==='hour');
    if(part)hour=Number(part.value);
  }catch{}
  const auto=hour>=6&&hour<18?'${AUTO_DAY_THEME_ID}':'${AUTO_NIGHT_THEME_ID}';
  const defaults=${JSON.stringify(PUBLISHED_THEME_BY_SCOPE)};
  const schemes=${JSON.stringify(PUBLISHED_THEME_SCHEMES)};
  let selected='';
  try{
    const prefs=JSON.parse(window.sessionStorage.getItem('loc-user-theme-selection-v1')||'{}');
    const stored=prefs?.[scope];
    selected=/^[1-8]$/.test(String(stored??''))?'theme-'+stored:
      String(stored||(admin?window.sessionStorage.getItem('loc-active-theme-id-v1'):null)||'');
  }catch{}
  if(!Object.hasOwn(schemes,selected))selected='';
  const requested=selected||(game?'${GAME_BOOTSTRAP_THEME_ID}':defaults[scope]||auto);
  const themeId=Object.hasOwn(schemes,requested)?requested:auto;
  const scheme=schemes[themeId]||'light';
  const root=document.documentElement;
  root.dataset.theme=scheme;
  root.dataset.themeId=themeId;
  root.style.colorScheme=scheme;
  root.dataset.themeBootstrap='correct-id';
  // Session stores only Theme ID, never CSS. Insert one stylesheet before
  // first paint; client navigation reuses the existing linked resource.
  const link=document.createElement('link');
  link.id='loc-theme-stylesheet';
  link.rel='stylesheet';
  link.href='/themes/'+themeId+'.css';
  link.dataset.themeId=themeId;
  link.setAttribute('blocking','render');
  link.addEventListener('load',()=>{link.dataset.loaded='true'},{once:true});
  document.head.appendChild(link);
}catch{}})();`;

