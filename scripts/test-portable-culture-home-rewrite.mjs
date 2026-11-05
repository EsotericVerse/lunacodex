import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('public homepage reads only its Scope and one index Block document',()=>{
  const scope=file('app/loc/scope-data.js');
  const boot=file('app/loc/app-bootstrap.js');
  assert.match(scope,/pageBlocks\(id,name\)/);
  assert.match(scope,/p_scope_id:id,p_type:name/);
  assert.match(boot,/selectScopeConfig\(id\)/);
  assert.match(boot,/selectScopeBlocks\(id,page\)/);
  assert.doesNotMatch(boot,/read_app_bootstrap/);
});
test('the four features use Scope flags rather than management permissions',()=>{
  const app=file('app/loc/LocApp.jsx');
  assert.match(app,/selectScopeConfig\(scopeId\)/);
  assert.match(app,/scopeFeatureEnabled\(query.data,flag\)/);
  assert.match(app,/query.error\|\|!query.data/);
});
test('culture density and anchors never select Galaxy UID or text',()=>{
  const sql=file('app/loc/providers/kysely-analytics.mjs');
  assert.match(sql,/mode==='culture_anchors'/);
  assert.match(sql,/mode==='culture_density'/);
  assert.match(sql,/\.select\(\['date','site'\]\)/);
  assert.match(sql,/eb\.fn\.countAll\(\)/);
  assert.match(sql,/\.groupBy\(\['date','site'\]\)/);
});
test('only explicit article-list request uses bounded 100-row UID query',()=>{
  const sql=file('app/loc/providers/kysely-analytics.mjs');
  assert.match(sql,/async function cultureListPage/);
  assert.match(sql,/\.select\(\['uid','date','title','list'\]\)/);
  assert.match(sql,/\.where\('culture','=',true\)/);
  assert.match(sql,/\.orderBy\('createtime','desc'\)\.limit\(100\)/);
  assert.match(sql,/row\.list===false[\s\S]*?hidden:true/);
  const view=file('app/loc/views/CulturePublicReader.jsx');
  assert.match(view,/onClick=\{\(\)=>openArticles\(item\.site\)\}/);
  assert.match(view,/setArticleVisible\(20\)/);
  assert.match(view,/Math\.min\(n\+20,articleRows.length\)/);
});
test('opening Culture lists does not preflight management grants; full text enforces list permission on UID SELECT',()=>{
  const culture=file('app/modular/features/Culture.jsx');
  const galaxy=file('app/loc/galaxy-query.js');
  assert.match(culture,/useAccount\(\{enabled:isTimeEditingView\|\|canUseScopeEditor\}\)/);
  assert.match(culture,/const row=await selectGalaxyIdentity\(scopeData,uid\)/);
  assert.match(culture,/const verified=await account\.refresh\(\)/);
  assert.match(galaxy,/filters:\[\{column:'uid',operator:'eq',value:id\},\s*\.\.\.\(!includeHidden\?\[articlePermissionFilter\(current,'list'\)\]:\[\]\)\]/);
  assert.match(galaxy,/if\(!row\|\|\(!includeHidden&&galaxyAble\(row\)\.list===false\)\)return null/);
});

test('Block interfaces are two reads and one transactional save',()=>{
  const publicReader=file('app/loc/providers/kysely-public.mjs');
  const manager=file('app/loc/providers/kysely-management.mjs');
  const editor=file('app/loc/ScopeBlockDraftList.jsx');
  assert.match(publicReader,/action==='page_blocks'\|\|action==='hero_blocks'/);
  assert.match(manager,/name==='save_blocks'/);
  assert.match(editor,/managedAction\('save_blocks'/);
  assert.doesNotMatch(editor,/await updateRows\(table/);
  assert.doesNotMatch(editor,/await insertRows\(table/);
});
test('user preferences key by verified OAuth email; Header/Footer remain available',()=>{
  const store=file('app/loc/loc-user-store.mjs');
  const shell=file('app/AppShell.jsx');
  assert.match(store,/\.eq\('email',verified\)/);
  assert.match(shell,/scope-top-feature-nav/);
  assert.match(shell,/<DataSourceStatus local=\{localWorkspace\}/);
});


test('Culture reuses one FeaturePage Hero and one portable list reader',()=>{
  const view=file('app/loc/views/CulturePublicReader.jsx');
  const ui=file('app/modular/ui.jsx');
  const query=file('app/loc/culture-query.js');
  assert.match(ui,/heroBlocks\(scopeId,featureId\)/);
  assert.doesNotMatch(view,/heroBlocks\(scopeId/);
  assert.match(view,/selectCultureArticleListPage\(scope,/);
  assert.match(query,/p_view:'culture_list'/);
  assert.match(view,/onClick=\{\(\)=>openArticles\(item\.site\)\}/);
  assert.match(view,/resetArticles=site=>/);
  assert.match(view,/setArticleRows\(\[\]\)/);
  assert.match(view,/articleRows\.slice\(0,articleVisible\)/);
});
