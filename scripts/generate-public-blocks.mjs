// Explicit PUBLIC content publishing only. Never call from prebuild or on a visit.
// Run npm run sync:public after authorized public content/config/theme edits,
// review generated files, commit and deploy normally (no build-time SQL).
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicNumericSources} from '../app/api/loc/_server.js';
import {readPublishedBootstrap} from '../app/api/loc/_numeric-failover.mjs';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {classNames} from '../app/loc/source-classification.mjs';
import {PUBLISHED_SOURCE_ENTRIES} from '../app/modular/published-source-taxonomy.js';
import {scopeConfigColumns} from '../app/loc/scope-config-fields.mjs';
import {publishPublicFiles} from './publish-public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validScope=/^[a-z][a-z0-9]{0,14}$/;
const validPage=/^[a-z0-9_-]+$/;
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const publication=await readPublishedBootstrap(publicNumericSources());
const db=publication.client,site=publication.data;
console.log('[public] Source: '+publication.source);
const routes=site.registry.filter(x=>x.active!==false&&x.scope_kind!=='system');
if(!routes.length||routes.some(x=>!validScope.test(x.scope_id)))throw Error('Invalid public Scope list');
// Explicit public publication projects the existing Scope Anchor From tree.
// This never reads obsolete ArticleTag/txt_class or scans Galaxy articles.
const {data:globalList,error:globalError}=await db.from('loc')
  .select('DefaultArticleClass').eq('id','loc').maybeSingle();
if(globalError||!globalList)throw Error('Cannot publish LOC DefaultArticleClass');
const systemNames=classNames(globalList.DefaultArticleClass);
const publishedSourceLists={},publishedSourceEntries={};
const allBlocks=new Map(),routeConfigs=[];
const cols='uid,page_name,block_eyebrow,block_title,block_subtitle,block_text,block_order,block_entity,block_image';
for(const row of routes){
  const id=row.scope_id,table=id;
  const {data:config,error:configError}=await db.from(table)
    .select(scopeConfigColumns(id))
    .eq('id',id).limit(1).maybeSingle();
  if(configError||!config)throw Error('Missing published Scope Config for '+id);
  routeConfigs.push({scope_id:id,domain:row.domain||null,directory:row.directory||null,active:true,config});
  // The catalogue is reviewed and exported by an authorized Scope editor
  // before this explicit publication. The public publishing client is anon:
  // it must never bypass Scope isolation to read unpublished From nodes.
  const entries=PUBLISHED_SOURCE_ENTRIES[id]||[];
  if(id!=='loc'&&!Array.isArray(PUBLISHED_SOURCE_ENTRIES[id]))
    throw Error('Authorized Source Anchor snapshot missing for '+id);
  if(entries.some(item=>!/^[A-Za-z0-9]{8}$/.test(String(item.uid))||!item.name))
    throw Error('Invalid published source UID or site in '+id);
  publishedSourceEntries[id]=entries;
  publishedSourceLists[id]={system:systemNames,personal:entries.map(item=>item.label)};
  // Keep the unrelated paginated Block publication change from latest main.
  const blocks=[];
  const pageSize=1000;
  for(let start=0;start<65535;start+=pageSize){
    const end=Math.min(65534,start+pageSize-1);
    const {data:page,error:blocksError}=await db.from(id+'_blocks')
      .select(cols).order('block_order').order('uid').range(start,end);
    if(blocksError)throw Error('Blocks unavailable for '+id+': '+blocksError.message);
    blocks.push(...(page||[]));
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
  return ':root[data-theme-id="theme-'+id+'"],.game-shell[data-game-theme="theme-'+id+'"]{\n  color-scheme:'+(theme.scheme==='dark'?'dark':'light')+';\n'+declarations.join('\n')+'\n}';
});
const themeMeta=themes.map(t=>({theme_id:t.theme_id,theme_name:t.theme_name,theme_order:t.theme_order}));
const bootstrap={scope_id:'loc',page_name:'index',registry:site.registry,
  page_copy:site.page_copy||[],scope_birthdays:site.scope_birthdays||{},
  theme_list:themeMeta,themes:[],blocks:[]};
const entries=[
  ['app/modular/scope-route-index.js','// PUBLIC Scope routing + Config; explicit publication only.\nexport const SCOPE_ROUTE_INDEX=Object.freeze('+encode(routeConfigs)+');\n'],
  ['app/modular/published-source-taxonomy.js',"// PUBLIC Source Anchor catalogue; updated only by explicit sync:public.\nimport {sourceTaxonomyFromCatalog,sourceTreeFromArrays} from '../loc/source-classification.mjs';\nexport const PUBLISHED_SOURCE_LISTS=Object.freeze("+encode(publishedSourceLists)+");\nexport const PUBLISHED_SOURCE_ENTRIES=Object.freeze("+encode(publishedSourceEntries)+");\nexport const PUBLISHED_SOURCE_TAXONOMY=Object.freeze(Object.fromEntries(Object.entries(PUBLISHED_SOURCE_LISTS).map(([id,lists])=>{const entries=PUBLISHED_SOURCE_ENTRIES[id]||[];const taxonomy=sourceTaxonomyFromCatalog(lists.system,entries);return [id,{...taxonomy,tree:sourceTreeFromArrays(lists.system,lists.personal,{universe:'Eosteric',galaxy:'LOC'})}];})));\nexport function publishedSourceTaxonomy(scopeId){return Object.prototype.hasOwnProperty.call(PUBLISHED_SOURCE_TAXONOMY,scopeId)?PUBLISHED_SOURCE_TAXONOMY[scopeId]:null;}\nexport function publishedSourceCategoryCatalog(scopeId){const taxonomy=publishedSourceTaxonomy(scopeId);if(!taxonomy)return null;return {categories:[...taxonomy.categories,...taxonomy.groups.map(row=>({category_code:row.group_code,display_name:row.display_name,enabled:row.enabled}))],aliases:[...taxonomy.aliases,...taxonomy.groupAliases.map(row=>({source_key:row.source_key,category_code:row.group_code}))]};}\n"],
  ['app/modular/published-theme-catalog.json',JSON.stringify(themes,null,2)+'\n'],
  ['app/modular/published-site-bootstrap.js','// PUBLIC navigation metadata and published Theme JSON; no visit-time SQL.\nimport publishedThemes from \'./published-theme-catalog.json\';\nexport const PUBLISHED_SITE_BOOTSTRAP=Object.freeze({...'+encode(bootstrap)+',themes:publishedThemes});\n'],
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
