import {UI_COPY} from '../i18n/ui-copy.js';
import {SCOPE_ROUTE_INDEX} from './scope-route-index.js';

// Current Scope registry.
export const FEATURES=Object.freeze([
  Object.freeze({id:'statics',label:UI_COPY.features.statics.title,path:'statics'}),
  Object.freeze({id:'culture',label:UI_COPY.features.culture.title,path:'culture'}),
  Object.freeze({id:'trace',label:UI_COPY.features.trace?.title||'痕跡',path:'trace'}),
  Object.freeze({id:'search',label:UI_COPY.features.search.title,path:'search'})
]);

export const SCOPES=Object.freeze({
  loc:Object.freeze({
    id:'loc',
    default:true,
    aggregateChildren:true,
    featureSubtitles:Object.freeze({
      statics:UI_COPY.scope.loc.statics,
      culture:UI_COPY.scope.loc.culture,
      trace:UI_COPY.scope.loc.trace,
      search:UI_COPY.scope.loc.search
    }),
    nav:Object.freeze({position:'after',order:2,label:UI_COPY.nav.home}),
    theme:Object.freeze({mode:'auto'})
  }),

  lrunes:Object.freeze({
    id:'lrunes',
    featureSubtitles:Object.freeze({
      statics:'查看月之符文相關資料的數量、來源與時間變化。',
      culture:'把月之符文相關紀錄放回時間順序，觀察不同時期的變化。',
      trace:'查看月之符文相關的空間位置與定錨示例。',
      search:'從符文名稱、關鍵字或相關文字找到對應內容。'
    }),
    nav:Object.freeze({position:'before',order:1,label:UI_COPY.nav.lunarunes}),
    searchKind:'runes'
  }),

  lo3rwang:Object.freeze({
    id:'lo3rwang',
    featureSubtitles:Object.freeze({search:UI_COPY.scope.author.search}),
    nav:Object.freeze({position:'after',order:1,label:UI_COPY.nav.author})
  }),

  admin:Object.freeze({
    id:'admin',
    featureScope:'loc',
    theme:Object.freeze({mode:'auto'})
  }),

  // Private, device-local content (future: MSN/Twitter-style personal
  // archive imports, parsed into an on-device SQLite store -- never
  // remote Gateway). nativeOnly marks it for useScopeRuntime: outside the native
  // App this id must resolve exactly like an unmatched path, not like a
  // known-but-restricted one. No `nav` key on purpose: it never appears in
  // the built-in Scope switcher (NAV_SCOPES in AppShell.jsx filters on
  // `scope.nav`, same reason `admin` above stays out of it); reachable only
  // by an explicit link from Settings, and optionally pinned to My
  // Favorites the same way `admin`-adjacent MOBILE_HOME_ID already is.
  local:Object.freeze({
    id:'local',
    nativeOnly:true,
    featureSubtitles:Object.freeze({
      statics:'查看本機私人匯入資料的數量、來源與時間變化。',
      culture:'把本機私人匯入的紀錄放回時間順序，觀察不同時期的變化。',
      search:'從本機私人匯入的文章找到對應內容。'
    })
  })
});

const DEFAULT_SCOPE_ID=Object.values(SCOPES).find(scope=>scope.default)?.id||Object.keys(SCOPES)[0];
const GENERIC_SCOPE_HOST='loc.lo3rwang.cc';
const GENERIC_SCOPE_PATH='/scope-shell';
const SCOPE_ID_PATTERN=/^[a-z][a-z0-9]{0,14}$/;

export const DUPLICATE_DOMAIN_MESSAGE='網域名稱重複，拒絕建立。';
export function duplicateDomainLabelError(scopeId,mode='domain'){
  if(mode!=='domain')return '';
  const domain=String(scopeId||'').trim().toLowerCase()+'.lo3rwang.cc';
  const labels=domain.split('.').filter(Boolean);
  return new Set(labels).size===labels.length?'':DUPLICATE_DOMAIN_MESSAGE;
}

export function normalizeScopeId(value=''){
  const id=String(value||'').trim().toLowerCase();
  return SCOPE_ID_PATTERN.test(id)?id:'';
}

export function isKnownScope(id){
  return Boolean(SCOPES[normalizeScopeId(id)]);
}

function genericScope(id){
  return Object.freeze({
    id,
    label:id,
    searchTitle:id,
    dynamic:true,
    featureSubtitles:Object.freeze({}),
    theme:Object.freeze({mode:'auto'})
  });
}

function cleanHost(host=''){
  return String(host||'').toLowerCase().split(':')[0];
}

function cleanPath(pathname='/'){
  const value='/' + String(pathname||'/')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean)
    .join('/');
  return value==='/'?'/':value;
}

// Resolve all public Scope URLs from the generated JS snapshot, not the
// bootstrap RPC. This is ready before hydration, without SQL/ISR round trips.
// Updates are made by regenerating scope-route-index.js after an admin edit.
const registryRouteRows=new Map(SCOPE_ROUTE_INDEX
  .filter(row=>row.active!==false)
  .map(row=>[row.scope_id,{
    domain:String(row.domain||'').trim().toLowerCase(),
    directory:String(row.directory||'').trim()
  }]));
const LOC_FALLBACK_HOST='loc.lo3rwang.cc';
export function resolveScope(host='',pathname='/'){
  const h=cleanHost(host);
  const path=cleanPath(pathname);
  const segments=path.split('/').filter(Boolean);
  // System Admin is a protected LOC feature route, not a published Scope.
  // Keep the same canonical LOC Scope through navigation, hydration and
  // EditDock; independent global authorization still gates the page.
  if((path==='/admin'||path.startsWith('/admin/'))&&
      (!h||h===LOC_FALLBACK_HOST||h==='localhost'||h==='127.0.0.1'))
    return 'loc';
  // Directory routes MUST precede the parent's catch-all Domain route:
  // loc.lo3rwang.cc/lo3rwang/ is lo3rwang, not loc.
  for(const [id,row] of registryRouteRows){
    if(!row.directory||h!==LOC_FALLBACK_HOST)continue;
    const base=cleanPath(row.directory);
    if(path===base||path.startsWith(base+'/'))return id;
  }
  // The published LOC origin also carries a real /lrunes/* Next.js mount.
  // This is an explicit built-in application alias, NOT an inferred Scope
  // Directory: it must resolve to lrunes for theme, editor and permissions
  // even while the canonical registered Domain is lrunes.lo3rwang.cc.
  if(h===LOC_FALLBACK_HOST&&(path==='/lrunes'||path.startsWith('/lrunes/')))
    return 'lrunes';
  for(const [id,row] of registryRouteRows){
    if(row.domain&&row.domain===h)return id;
  }
  // The native static shell has filesystem paths even without public domains.
  // Never override a declared public Domain with a guessed directory.
  if(segments[0]&&segments[0]!=='loc'&&SCOPES[segments[0]]){
    const row=registryRouteRows.get(segments[0]);
    if(!row?.domain||h==='localhost'||h==='127.0.0.1'||!h)return segments[0];
  }
  return DEFAULT_SCOPE_ID;
}

export function getScope(id){
  const scopeId=normalizeScopeId(id)||DEFAULT_SCOPE_ID;
  // Static Registry stores route identity only; display_name lives in PostgreSQL.
  if(SCOPES[scopeId])return {...SCOPES[scopeId],label:scopeId,searchTitle:scopeId};
  return genericScope(scopeId);
}

export function scopeOrigin(scopeId){
  const id=normalizeScopeId(scopeId);
  const row=registryRouteRows.get(id);
  // The generated JS route index is authoritative before any network read.
  return row?.domain?'https://'+row.domain:'https://'+LOC_FALLBACK_HOST;
}

function scopeBaseHref(scopeId){
  const id=normalizeScopeId(scopeId);
  if(id&&!SCOPES[id])return 'https://'+LOC_FALLBACK_HOST+GENERIC_SCOPE_PATH;
  const row=registryRouteRows.get(id);
  if(row?.domain)return 'https://'+row.domain;
  if(row?.directory)return 'https://'+LOC_FALLBACK_HOST+cleanPath(row.directory);
  if(id===DEFAULT_SCOPE_ID)return 'https://'+LOC_FALLBACK_HOST;
  return 'https://'+LOC_FALLBACK_HOST+'/'+id;
}

export function scopeHref(scopeId,localPath=''){
  const id=normalizeScopeId(scopeId)||DEFAULT_SCOPE_ID;
  const untrimmed=scopeBaseHref(id);
  const base=untrimmed.endsWith('/')?untrimmed.slice(0,-1):untrimmed;
  const raw=String(localPath||'');
  const hashIndex=raw.indexOf('#');
  const hash=hashIndex>=0?raw.slice(hashIndex):'';
  const withoutHash=hashIndex>=0?raw.slice(0,hashIndex):raw;
  const queryIndex=withoutHash.indexOf('?');
  const routePart=queryIndex>=0?withoutHash.slice(0,queryIndex):withoutHash;
  const query=queryIndex>=0?withoutHash.slice(queryIndex+1):'';
  const path=routePart.split('/').filter(Boolean).join('/');
  const pathname=path?'/'+path+'/':'/';
  if(SCOPES[id])return base+pathname+(query?'?'+query:'')+hash;
  const params=new URLSearchParams(query);
  params.set('scopeid',id);
  return base+pathname+'?'+params.toString()+hash;
}

export function featureHref(scopeId,featureId){
  const feature=FEATURES.find(item=>item.id===featureId);
  if(!feature)throw new Error('Unknown feature: '+featureId);
  return scopeHref(scopeId,feature.path);
}

export function featureIdForPath(pathname='/'){
  // Deep routes retain the correct parent feature in the shared dock.
  // Management routes remain independent of the Trace feature.
  const segments=String(pathname||'/').split('?')[0].split('/').filter(Boolean);
  return FEATURES.find(item=>segments.includes(item.path))?.id||null;
}

// Static-export iOS bundle contains local /lrunes and /lo3rwang mounts.
// External canonical Scope hosts must not eject the iOS app into Safari.
export function navigationHref(scopeId='loc',localPath='',native=false){
  if(!native)return scopeHref(scopeId,localPath);
  const id=normalizeScopeId(scopeId)||'loc';
  const part=String(localPath||'').split('/').filter(Boolean).join('/');
  const prefix=id==='loc'?'':isKnownScope(id)?'/'+id:'/scope-shell';
  const path=(prefix+'/'+(part?part+'/':'')).replace(/\/+/g,'/');
  // Capacitor iOS serves bundled files by their explicit .html path; extension-
  // less feature routes can fall back to the root index.html instead of the
  // nested Next static export. Keep website canonical paths unchanged.
  const nativeFile=path+'index.html';
  return isKnownScope(id)?nativeFile:nativeFile+'?scopeid='+encodeURIComponent(id);
}
