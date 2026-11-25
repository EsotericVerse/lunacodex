// Explicit PUBLIC content publishing only. Never call from prebuild or on a visit.
// Run npm run sync:public after authorized public content/config/theme edits,
// review generated files, commit and deploy normally (no build-time SQL).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {directMcpKysely,closeLocDatabase} from '../app/loc/db/native-kysely.mjs';
import {portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {scopeConfigColumns} from '../app/loc/scope/scope-config-fields.mjs';
import {sourceTaxonomyFromAnchors} from '../app/loc/source/classification.mjs';
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
// Publish typed SiteAnchor nodes; neither LOC nor Scope ArticleTag is needed.
const sourceRows=await db.selectFrom(table('loc_anchor'))
  .select(['uid','type','title','invisible','attr'])
  .where('type','in',['universe','galaxy','domain','from'])
  .orderBy('uid','asc').limit(1000).execute();
if(!sourceRows.length||sourceRows.length>=1000)
  throw Error('Cannot publish LOC SiteAnchor source hierarchy');
const sourceTaxonomy=sourceTaxonomyFromAnchors(sourceRows);
if(!sourceTaxonomy.categories.length)
  throw Error('LOC SiteAnchor source hierarchy has no typed categories');

// Route configuration remains part of the existing publication contract.
const routeConfigs=[];
const tableForScope=id=>table(id);
for(const row of routes){
  const id=row.scope_id;
  const config=await db.selectFrom(tableForScope(id))
    .select(scopeConfigColumns(id).split(',').filter(Boolean))
    .where('id','=',id).executeTakeFirst();
  if(!config)throw Error('Missing published Scope Config for '+id);
  routeConfigs.push({scope_id:id,domain:row.domain||null,directory:row.directory||null,active:true,config});
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
const bootstrap={scope_id:'loc',page_name:'index',registry:site.registry,
  page_copy:site.page_copy||[],scope_birthdays:site.scope_birthdays||{},
  theme_list:themeMeta,themes:[],blocks:[]};
const entries=[
  ['app/modular/routing/scope-route-index.js','// PUBLIC Scope routing + Config; explicit publication only.\nexport const SCOPE_ROUTE_INDEX=Object.freeze('+encode(routeConfigs)+');\n'],
  ['app/modular/published-source-taxonomy.js', "// Public SiteAnchor source hierarchy, projected from persisted Anchor types.\nimport {sourceTaxonomyFromAnchors} from '../loc/source/classification.mjs';\nexport const PUBLISHED_SOURCE_ANCHORS=Object.freeze("+encode(sourceRows)+");\nconst taxonomy=Object.freeze(sourceTaxonomyFromAnchors(PUBLISHED_SOURCE_ANCHORS));\nexport const publishedSourceTaxonomy=()=>taxonomy;\nexport const publishedSourceCategoryCatalog=()=>({categories:taxonomy.categories,aliases:taxonomy.aliases});\n"],
  ...themes.map(t=>['app/modular/themes/theme-'+t.theme_id+'.json',JSON.stringify(t,null,2)+'\n']),
  ['app/modular/published-site-bootstrap.js','// PUBLIC navigation metadata; theme palettes are loaded by selected ID only.\nexport const PUBLISHED_SITE_BOOTSTRAP=Object.freeze({...'+encode(bootstrap)+',themes:[]});\n'],
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
