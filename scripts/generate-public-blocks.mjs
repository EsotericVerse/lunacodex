// Explicit PUBLIC content publishing only. Never call from prebuild or on a visit.
// Run npm run sync:public after authorized public content/config/theme edits,
// review generated files, commit and deploy normally (no build-time SQL).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {scopeConfigColumns} from '../app/loc/scope/scope-config-fields.mjs';
import {sourceTaxonomyFromAnchors} from '../app/loc/source/classification.mjs';
import {publishPublicFiles} from './publish-public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validScope=/^[a-z][a-z0-9]{0,14}$/;
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
// Explicit public publication uses the existing Kysely Pages reader directly.
// No ISR or background data reads are required by static output.
const db=createKyselyPublicClient({role:'anon',
  fetch:(route,options)=>fetch(new URL(route,'https://loc.lo3rwang.cc').href,options)
}).schema('silver');
const publication=await db.publicAction('read_app_bootstrap',
  {p_scope_id:'loc',p_page_name:'index'});
if(publication.error)throw new Error('Cannot publish public Bootstrap');
const site=publication.data;
if(!site||!Array.isArray(site.registry))throw new Error('Invalid public Bootstrap');
console.log('[public] Source: primary');
const routes=site.registry.filter(x=>x.active!==false&&x.scope_kind!=='system');
if(!routes.length||routes.some(x=>!validScope.test(x.scope_id)))throw Error('Invalid public Scope list');
// Publish typed SiteAnchor nodes; neither LOC nor Scope ArticleTag is needed.
const {data:sourceRows,error:sourceError}=await db.from('loc_anchor')
  .select('uid,type,title,invisible,attr')
  .in('type',['universe','galaxy','domain','from'])
  .order('uid').range(0,999);
if(sourceError||!Array.isArray(sourceRows)||!sourceRows.length||sourceRows.length>=1000)
  throw Error('Cannot publish LOC SiteAnchor source hierarchy');
const sourceTaxonomy=sourceTaxonomyFromAnchors(sourceRows);
if(!sourceTaxonomy.categories.length)
  throw Error('LOC SiteAnchor source hierarchy has no typed categories');

// Route configuration remains part of the existing publication contract.
const routeConfigs=[];
for(const row of routes){
  const id=row.scope_id,table=id;
  const {data:config,error:configError}=await db.from(table)
    .select(scopeConfigColumns(id))
    .eq('id',id).limit(1).maybeSingle();
  if(configError||!config)throw Error('Missing published Scope Config for '+id);
  routeConfigs.push({scope_id:id,domain:row.domain||null,directory:row.directory||null,active:true,config});
}
const {data:locThemes,error:themesError}=await db.from('loc')
  .select('theme').eq('id','loc').maybeSingle();
const themes=Array.isArray(locThemes?.theme)
  ?locThemes.theme.slice().sort((a,b)=>Number(a.theme_order)-Number(b.theme_order))
  :[];
if(themesError||themes.length!==8)throw Error('Cannot publish eight complete LOC Themes');
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
