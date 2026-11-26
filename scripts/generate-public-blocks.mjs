// Explicit publication for routing/feature metadata, Themes and SiteAnchor JS.
// Mutable page copy and authored Blocks are R2/SQL runtime data and do not
// require a generated release file, deployment or build-time database access.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {directMcpKysely,closeLocDatabase} from '../app/loc/db/native-kysely.mjs';
import {portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {scopeConfigColumnList} from '../app/loc/scope/scope-config-fields.mjs';
import {ANCHOR_TYPE_GROUPS} from '../packages/zenstack/anchor-hierarchy.mjs';
import {publishPublicFiles} from './publish-public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validScope=/^[a-z][a-z0-9]{0,14}$/;
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
// Publication is an explicit local operator command using the configured DB URI.
// It does not expose a public query endpoint or use a browser SQL gateway.
const port=await directMcpKysely(process.env);
const db=port.db;
const table=name=>portableRelation(name,port.engine,port.namespace);
try{
const site=PUBLISHED_SITE_BOOTSTRAP;
if(!Array.isArray(site.registry))throw new Error('Invalid published Scope registry');
console.log('[public] Source: primary');
const routes=site.registry.filter(x=>x.active!==false&&x.scope_kind!=='system');
if(!routes.length||routes.some(x=>!validScope.test(x.scope_id)))throw Error('Invalid public Scope list');
// Route configuration remains part of the existing publication contract.
const routeConfigs=[];
const tableForScope=id=>table(id);
for(const row of routes){
  const id=row.scope_id;
  const config=await db.selectFrom(tableForScope(id))
    .select(scopeConfigColumnList(id))
    .where('id','=',id).executeTakeFirst();
  if(!config)throw Error('Missing published Scope Config for '+id);
  // Mutable copy stays in SQL (and the private homepage R2 projection), not
  // in the deployed route JS. Keep only route and runtime feature metadata.
  const runtimeConfig=Object.fromEntries(Object.entries(config).filter(([key])=>
    !['display_name','search_intro','search_aliases'].includes(key)));
  routeConfigs.push({scope_id:id,domain:row.domain||null,
    directory:row.directory||null,active:true,config:runtimeConfig});
}
const locThemes=await db.selectFrom(table('loc')).select('theme')
  .where('id','=','loc').executeTakeFirst();
const themes=Array.isArray(locThemes?.theme)
  ?locThemes.theme.slice().sort((a,b)=>Number(a.theme_order)-Number(b.theme_order))
  :[];
if(themes.length!==8)throw Error('Cannot publish eight complete LOC Themes');
const palettes=themes.map(theme=>{
  const id=Number(theme.theme_id);
  if(!Number.isInteger(id)||id<1||id>8)throw Error('Invalid Theme ID');
  const declarations=THEME_TOKEN_KEYS.map(key=>{
    const value=String(theme[key.slice(2).replaceAll('-','_')]??'').trim();
    if(!value||/[;{}<>\\]/.test(value)||/url\s*\(|@import|!important/i.test(value)||/[\x00-\x1f]/.test(value))
      throw Error('Unsafe Theme token '+id+' '+key);
    return '  '+key+':'+value+';';
  });
  return {id,css:':root[data-theme-id="theme-'+id+'"][data-theme]{\n  color-scheme:'+(theme.scheme==='dark'?'dark':'light')+';\n'+declarations.join('\n')+'\n}'};
});
const themeMeta=themes.map(t=>({theme_id:t.theme_id,theme_name:t.theme_name,theme_order:t.theme_order}));
// Publish every visible SiteAnchor UID (Universe/Galaxy/Domain/From) into the
// resident JS snapshot. This SQL read runs only during explicit sync:public;
// pages and feature requests consume the generated module without SQL.
const siteAnchors=await db.selectFrom(table('loc_anchor'))
  .select(['uid','type','title','attr','invisible'])
  .where('type','in',ANCHOR_TYPE_GROUPS.source)
  .where('invisible','=',false)
  .orderBy('uid','asc')
  .execute();
if(!siteAnchors.length)throw new Error('Cannot publish an empty SiteAnchor catalogue');
// Only routing/authority snapshots, Theme data and immutable SiteAnchor JS
// belong in the release bundle. Mutable page copy and Home Blocks are served
// through the private R2 binding with a fixed SQL fallback at runtime.
const bootstrap={scope_id:'loc',page_name:'index',
  registry:site.registry.map(row=>Object.fromEntries(Object.entries(row)
    .filter(([key])=>key!=='display_name'))),
  scope_birthdays:site.scope_birthdays||{},theme_list:themeMeta,
  site_anchors:siteAnchors,themes:[]};
const entries=[
  ['app/modular/routing/scope-route-index.js','// PUBLIC Scope routing + non-copy Config; explicit publication only.\nexport const SCOPE_ROUTE_INDEX=Object.freeze('+encode(routeConfigs)+');\n'],
  ...themes.map(t=>['app/modular/themes/theme-'+t.theme_id+'.json',JSON.stringify(t,null,2)+'\n']),
  ['app/modular/published-site-bootstrap.js','// PUBLIC navigation metadata; theme palettes are loaded by selected ID only.\nexport const PUBLISHED_SITE_BOOTSTRAP=Object.freeze('+encode(bootstrap)+');\n'],
  ['app/modular/published-theme-meta.js','// Published Theme metadata (palettes are CSS).\nexport const PUBLISHED_THEME_META='+encode(themes.map(t=>['theme-'+t.theme_id,t.theme_name,t.scheme,t.style_key]))+';\n'],
  ...palettes.map(({id,css})=>[
    'public/themes/theme-'+id+'.css',
    '/* LOC Theme '+id+'; generated by sync:public. */\n'+css+'\n'
  ])
];
// Install the remaining explicitly published assets atomically.
publishPublicFiles(root,entries);
console.log('[public] '+routes.length+' Scope routes + Config, '+themes.length+' CSS palettes. Commit generated files before deploying.');
}finally{
  await closeLocDatabase(port);
}
