// Explicit PUBLIC content publishing only. Never call from prebuild or on a visit.
// Run npm run sync:public after authorized public content/config/theme edits,
// review generated files, commit and deploy normally (no build-time SQL).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createKyselyPublicClient} from '../app/loc/providers/kysely-browser.mjs';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {scopeConfigColumns} from '../app/loc/scope-config-fields.mjs';
import {isLocBlockPage,locAnchorToBlock} from '../app/loc/loc-block-anchor.mjs';
import {publishPublicFiles} from './publish-public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validScope=/^[a-z][a-z0-9]{0,14}$/;
const validPage=/^[a-z0-9_-]+$/;
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
// Explicit public publication projects the existing Scope Anchor From tree.
// This reads published Anchor source snapshots without scanning Galaxy articles.
const {data:globalList,error:globalError}=await db.from('loc')
  .select('ArticleTag').eq('id','loc').maybeSingle();
if(globalError||!globalList||!Array.isArray(globalList.ArticleTag))throw Error('Cannot publish LOC ArticleTag');
const systemNames=[...new Set([...globalList.ArticleTag,'Others'].map(x=>String(x).trim()).filter(Boolean))];
const allBlocks=new Map(),routeConfigs=[];
const cols='uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image';
for(const row of routes){
  const id=row.scope_id,table=id;
  const {data:config,error:configError}=await db.from(table)
    .select(scopeConfigColumns(id))
    .eq('id',id).limit(1).maybeSingle();
  if(configError||!config)throw Error('Missing published Scope Config for '+id);
  routeConfigs.push({scope_id:id,domain:row.domain||null,directory:row.directory||null,active:true,config});
  // Keep the unrelated paginated Block publication change from latest main.
  const blocks=[];
  const pageSize=1000;
  for(let start=0;start<65535;start+=pageSize){
    const end=Math.min(65534,start+pageSize-1);
    const loc=id==='loc';
    const {data:page,error:blocksError}=await db.from(loc?'loc_anchor':id+'_blocks')
      .select(loc?'uid,type,title,description,invisible,attr,num':cols)
      .order(loc?'num':'block_order').order('uid').range(start,end);
    if(blocksError)throw Error('Blocks unavailable for '+id+': '+blocksError.message);
    blocks.push(...(loc?(page||[])
      .filter(row=>isLocBlockPage(row.type)&&row.invisible===false)
      .map(locAnchorToBlock):(page||[])));
    if(!page||page.length<end-start+1)break;
  }
  for(const block of blocks){
    const page=String(block.page_name||'').trim().toLowerCase();
    if(!validPage.test(page))throw Error('Invalid published page '+id+': '+page);
    const key=id+'/'+page;
    if(!allBlocks.has(key))allBlocks.set(key,[]);
    allBlocks.get(key).push(block);
  }
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
  return ':root[data-theme-id="theme-'+id+'"]{\n  color-scheme:'+(theme.scheme==='dark'?'dark':'light')+';\n'+declarations.join('\n')+'\n}';
});
const themeMeta=themes.map(t=>({theme_id:t.theme_id,theme_name:t.theme_name,theme_order:t.theme_order}));
const bootstrap={scope_id:'loc',page_name:'index',registry:site.registry,
  page_copy:site.page_copy||[],scope_birthdays:site.scope_birthdays||{},
  theme_list:themeMeta,themes:[],blocks:[]};
const entries=[
  ['app/modular/scope-route-index.js','// PUBLIC Scope routing + Config; explicit publication only.\nexport const SCOPE_ROUTE_INDEX=Object.freeze('+encode(routeConfigs)+');\n'],
  ['app/modular/published-source-taxonomy.js',"// Fixed LOC ArticleTag; no Source Anchor tree.\\nimport {sourceTaxonomyFromArrays} from '../loc/source-classification.mjs';\\nexport const PUBLISHED_LOC_ARTICLE_TAGS=Object.freeze("+encode(systemNames)+");\\nexport const PUBLISHED_SOURCE_LISTS=Object.freeze({loc:{system:PUBLISHED_LOC_ARTICLE_TAGS,personal:[]}});\\nexport const PUBLISHED_SOURCE_ENTRIES=Object.freeze({});\\nexport const PUBLISHED_SOURCE_DOMAINS=Object.freeze({});\\nconst taxonomy=Object.freeze(sourceTaxonomyFromArrays(PUBLISHED_LOC_ARTICLE_TAGS));\\nexport const publishedSourceTaxonomy=()=>taxonomy;\\nexport const publishedSourceCategoryCatalog=()=>({categories:taxonomy.categories,aliases:taxonomy.aliases});\\n"],
  ...themes.map(t=>['app/modular/themes/theme-'+t.theme_id+'.json',JSON.stringify(t,null,2)+'\n']),
  ['app/modular/published-site-bootstrap.js','// PUBLIC navigation metadata; theme palettes are loaded by selected ID only.\nexport const PUBLISHED_SITE_BOOTSTRAP=Object.freeze({...'+encode(bootstrap)+',themes:[]});\n']
  ['app/modular/published-theme-meta.js','// Published Theme metadata (palettes are CSS).\nexport const PUBLISHED_THEME_META='+encode(themes.map(t=>['theme-'+t.theme_id,t.theme_name,t.scheme,t.style_key]))+';\n'],
  ['app/styles/published-themes.css','/* Published Theme palette; explicit publication only. */\n'+palettes.join('\n\n')+'\n']
];
const manifest=[];
for(const [key,blocks] of [...allBlocks].sort(([a],[b])=>a.localeCompare(b))){
  const [scope,page]=key.split('/');
  entries.push(['app/modular/published-blocks/'+key+'.js',
    '// Public '+key+' Blocks.\nexport default '+encode(blocks)+';\n']);
  manifest.push('  '+JSON.stringify(scope+':'+page)+':()=>import(\'./'+key+'.js\')');
}
entries.push(['app/modular/published-blocks/index.js',
  '// Page-level lazy-load manifest; no runtime database reads.\nconst LOADERS={\n'+manifest.join(',\n')+'\n};\n'+
  'export async function loadPublishedBlocks(scopeId,pageName=\'index\'){\n'+
  '  const key=String(scopeId||\'\')+\':\'+String(pageName||\'index\');\n'+
  '  const load=Object.prototype.hasOwnProperty.call(LOADERS,key)?LOADERS[key]:null;\n'+
  '  return load?(await load()).default:[];\n}\n']);
// Generate all files in staging; if installation fails, roll back each moved
// file and the entire Blocks directory. No partial publication survives errors.
publishPublicFiles(root,entries);
console.log('[public] '+routes.length+' Scope routes + Config, '+allBlocks.size+' page JS modules, '+themes.length+' CSS palettes. Commit generated files before deploying.');
