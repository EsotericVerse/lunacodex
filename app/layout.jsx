import './globals.css';
import AppShell from './AppShell';
import {LOC_ORIGIN} from './seo/metadata';
import {faviconForScope} from './site-favicons';
import {SCOPE_ROUTE_INDEX} from './modular/scope-route-index.js';
import {PUBLISHED_THEME_META} from './modular/published-theme-meta.js';

// The public shell is static. Only Culture/Statistics numeric APIs use ISR.
export const dynamic='force-static';

export const metadata = {
  metadataBase:new URL(LOC_ORIGIN),
  title:'LOC 月典',
  description:'月典是一套語言建構框架工具，用來整理文字、作品與時間脈絡。',
  applicationName:'LOC 月典',
  icons:{icon:[{url:faviconForScope('loc'),type:'image/png'}]},
  referrer:'origin-when-cross-origin'
};

// Expose real cutout insets to the Capacitor WebView so iPhone Dynamic Island
// is never allowed to overlap the favorites row.
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover'};

const AUTO_DAY_THEME_ID='theme-7';
const AUTO_NIGHT_THEME_ID='theme-1';
const GAME_BOOTSTRAP_THEME_ID='theme-4';
// The exact canonical palette and per-Scope default are loaded on demand in AppShell.
const NATIVE_STATIC_ROUTE_SCRIPT=`(()=>{try{
  if(window.location.protocol!=='capacitor:')return;
  const {pathname,search,hash}=window.location;
  if(!/\\/index\\.html$/.test(pathname))return;
  window.history.replaceState(window.history.state,'',pathname.slice(0,-'index.html'.length)+search+hash);
}catch{}})();`;
// Tiny, public identity/colour-scheme map only: the full eight palette JSON
// modules remain lazy; published CSS applies the correct one at first paint.
const PUBLISHED_THEME_BY_SCOPE=Object.fromEntries(SCOPE_ROUTE_INDEX.map(row=>
  [row.scope_id,String(row.config?.theme||'')]));
const PUBLISHED_THEME_SCHEMES=Object.fromEntries(PUBLISHED_THEME_META.map(row=>[row[0],row[2]]));
const INITIAL_THEME_SCRIPT=`(()=>{try{
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
    selected=String(prefs?.[scope]||(admin?window.sessionStorage.getItem('loc-active-theme-id-v1'):null)||'');
  }catch{}
  if(!Object.hasOwn(schemes,selected))selected='';
  const themeId=selected||(game?'${GAME_BOOTSTRAP_THEME_ID}':defaults[scope]||auto);
  const scheme=schemes[themeId]||schemes[auto]||'light';
  const root=document.documentElement;
  root.dataset.theme=scheme;
  root.dataset.themeId=themeId;
  root.style.colorScheme=scheme;
  root.dataset.themeBootstrap='correct-id';
}catch{}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script id="loc-native-static-route" dangerouslySetInnerHTML={{__html:NATIVE_STATIC_ROUTE_SCRIPT}} />
        <script id="loc-theme-bootstrap" dangerouslySetInnerHTML={{__html:INITIAL_THEME_SCRIPT}} />
      </head>
      <body className="loc-app-shell">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
