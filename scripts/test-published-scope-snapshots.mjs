import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
const read=p=>readFileSync(path.join(root,p),'utf8');
test('normal builds never query the database to publish Bootstrap/Config/Blocks',()=>{
  assert.doesNotMatch(JSON.parse(read('package.json')).scripts.prebuild,/generate-public-blocks/);
  assert.doesNotMatch(read('scripts/build-static-export.mjs'),/\brun\(npm,\['run','sync:public'\]/);
});
test('Scope public configuration shares its JS module with routing',()=>{
  const routes=read('app/modular/scope-route-index.js');
  assert.match(routes,/SCOPE_ROUTE_INDEX/);
  assert.match(routes,/"config":/);
});
test('each published Block is page-split into an actual lazy JS module',()=>{
  const index=read('app/modular/published-blocks/index.js');
  const paths=[...index.matchAll(/import\('\.\/([^']+\.js)'\)/g)].map(x=>x[1]);
  assert.ok(paths.length>=10);
  for(const p of paths)assert.ok(existsSync(path.join(root,'app/modular/published-blocks',p)),p);
  assert.doesNotMatch(read('app/loc/scope-data.js'),/site-bootstrap\.json|\/blocks\/.*\.json/);
});
test('published Theme JSON contains eight complete palettes matching the CSS',async()=>{
  const catalog=JSON.parse(read('app/modular/published-theme-catalog.json'));
  const css=read('app/styles/published-themes.css');
  const {THEME_TOKEN_KEYS}=await import('../app/modular/theme-registry.js');
  assert.equal(catalog.length,8);
  for(const [index,row] of catalog.entries()){
    assert.equal(Number(row.theme_id),index+1);
    const start=css.indexOf(':root[data-theme-id="theme-'+row.theme_id+'"]');
    assert.ok(start>=0);
    const end=css.indexOf(':root[data-theme-id="theme-',start+1);
    const cssBlock=css.slice(start,end<0?undefined:end);
    for(const key of THEME_TOKEN_KEYS){
      const value=String(row[key.slice(2).replaceAll('-','_')]||'').trim();
      assert.ok(value,'missing '+row.theme_id+' '+key);
      assert.ok(cssBlock.includes('  '+key+':'+value+';'),'JSON and CSS differ for '+row.theme_id+' '+key);
    }
  }
  const bootstrap=read('app/modular/published-site-bootstrap.js');
  assert.match(bootstrap,/import publishedThemes from '\.\/published-theme-catalog\.json'/);
  assert.match(bootstrap,/themes:publishedThemes/);
});

test('CSS contains eight published Theme palettes',()=>{
  const css=read('app/styles/published-themes.css');
  for(let id=1;id<=8;id++){
    assert.ok(css.includes('[data-theme-id="theme-'+id+'"]'));
    assert.ok(css.includes('.game-shell[data-game-theme="theme-'+id+'"]'));
    assert.equal(css.split('--loc-panel-2:').length-1,8);
  }
});

test('Culture classification is a published JS module, not a mandatory four-query startup',()=>{
  const taxonomy=read('app/modular/published-source-taxonomy.js');
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(taxonomy,/PUBLISHED_SOURCE_TAXONOMY/);
  for(const id of ['loc','lrunes','lo3rwang']){
    assert.ok(taxonomy.includes(id+':{system:')||taxonomy.includes('"'+id+'":{"system":'),
      'published classification missing '+id);
  }
  assert.match(taxonomy,/PUBLISHED_SOURCE_LISTS/);
  assert.doesNotMatch(taxonomy,/statistics_source_categories|statistics_scope_others_groups/);
  assert.match(culture,/const publishedTaxonomy=useMemo\(\(\)=>publishedSourceTaxonomy\(scopeId\)/);
  assert.match(culture,/enabled:!publishedTaxonomy&&!isAggregateScope/);
  assert.match(culture,/const sourceTaxonomy=publishedTaxonomy\|\|sourceTaxonomyQuery.data/);
  assert.match(culture,/openCultureRoots\.length>0/);
  // Stage parent lanes on a single direct numeric RPC; child expansion must
  // filter those aggregates locally rather than reviving the suspended ISR.
  assert.match(culture,/culture-period-roots/);
  assert.ok(culture.includes('selectScopeDailyCounts(scopeData'));
  assert.ok(culture.includes('selectCultureRiverChildren(sourceRootQuery.data.numericRows'));
  assert.doesNotMatch(culture,/readNumericIsr|usesNumericIsr/);
  assert.ok(culture.includes("selectedRiverGroup+'|source|'"));
});

test('public LOC Culture reads published Group membership without private api.manage transport',()=>{
 const culture=read('app/loc/culture-query.js');
 const begin=culture.indexOf("if(id==='loc'){",culture.indexOf('export async function selectScopeCultureData'));
 const end=culture.indexOf('const bundles=await mapBounded(managedScopes',begin);
 assert.ok(begin>=0&&end>begin);
 const flow=culture.slice(begin,end);
 assert.match(flow,/selectScopeGroupMemberIds\('loc','culture'\)/);
 assert.match(flow,/PUBLISHED_SITE_BOOTSTRAP\.registry/);
 assert.match(flow,/defaultScopeData\(entry\.scope_id\)/);
 assert.doesNotMatch(flow,/selectManagedScopes\(/);
});

test('public single-Scope Culture time timeline uses published routing, not private Manage reads',()=>{
  const culture=read('app/loc/culture-query.js');
  const start=culture.indexOf('export async function selectScopeCultureData');
  const end=culture.indexOf('export async function selectScopePeriodSourceSnapshot',start);
  assert.ok(start>=0&&end>start);
  const block=culture.slice(start,end);
  assert.doesNotMatch(block,/selectManagedScope\(/);
  assert.match(block,/publishedScope\?defaultScopeData\(id\):null/);
});

test('Culture public Time Anchors are paged below the browser Data API limit',()=>{
  const source=read('app/loc/culture-query.js');
  const begin=source.indexOf('export async function selectCultureTimeRows');
  const end=source.indexOf('function openPeriodRangeFromRows',begin);
  assert.ok(begin>=0&&end>begin);
  const reader=source.slice(begin,end);
  assert.match(reader,/pageSize=Math\.min\(DB_QUERY_BATCH_SIZE,1000\)/);
  assert.match(reader,/offset\+=pageSize/);
  assert.match(reader,/limit:pageSize,offset,maxLimit:pageSize/);
  assert.doesNotMatch(reader,/limit:DB_QUERY_BATCH_SIZE,offset:0/);
});
