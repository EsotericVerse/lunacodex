import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GALAXY_ABLE_KEYS,galaxyAble,prepareGalaxyInsertRows,privateGalaxySource} from '../app/loc/galaxy-able.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const allFalse=flags=>assert.deepEqual(Object.values(flags),GALAXY_ABLE_KEYS.map(()=>false));

test('MCP and GitHub PR imports always become private even with explicit legacy public flags',()=>{
  for(const row of [
    {site:'mcp',uid:'1234ABcd',search:true,list:true},
    {site:'GitHub',site_id:'EsotericVerse/moon-runes-pwa#1073',uid:'1234ABcd',able:{list:true,search:true}},
    {site:'github',title:'LOC｜PR #1073｜White login',uid:'1234ABcd',search:true},
  ]){
    assert.equal(privateGalaxySource(row),true);
    allFalse(galaxyAble(row));
    const inserted=prepareGalaxyInsertRows('silver.lo3rwang_galaxy',[row])[0];
    for(const key of GALAXY_ABLE_KEYS)assert.equal(inserted[key],false,key);
  }
});
test('normal non-private imports preserve eight independent explicit values',()=>{
  const flags=galaxyAble({site:'facebook',search:true,list:false,keyword:false});
  assert.equal(flags.search,true);
  assert.equal(flags.list,false);
  assert.equal(flags.keyword,false);
  assert.equal(flags.culture,true);
  assert.equal(privateGalaxySource({site:'github',site_id:'github:docs/README.md',title:'公開文件'}),false);
});
test('management bulk tool checks Scope permissions and never offers unrestricted table writes',()=>{
  const api=read('app/loc/providers/kysely-management.mjs');
  const view=read('app/loc/BulkGalaxyVisibility.jsx');
  assert.match(api,/bulk_update_galaxy_able/);
  assert.match(api,/canManageLoc\(trx,'scope',scope\)/);
  assert.match(api,/Private MCP and GitHub sources cannot be publicly enabled/);
  assert.match(api,/p_expected_count!==matching/);
  assert.match(api,/limit>500/);
  assert.match(api,/order by g.createtime asc/);
  assert.doesNotMatch(api,/order by g.uid/);
  assert.match(view,/useEditDockForm/);
  assert.match(view,/預覽待更新筆數/);
  assert.match(view,/p_expected_count:remaining/);
  assert.match(read('app/loc/ManagementImportPanel.jsx'),/<BulkGalaxyVisibility scopeId=\{scopeId\}\/>/);
});
test('RLS migration protects all eight flags in both Scopes',()=>{
  const sql=read('supabase/migrations/20261106035500_private_mcp_pr_galaxy_visibility.sql');
  for(const scope of ['lo3rwang','lrunes']){
    assert.match(sql,new RegExp('ALTER TABLE silver\\.'+scope+'_galaxy'));
    assert.match(sql,new RegExp('\\$policy_'+scope+'\\$'));
  }
  assert.match(sql,/PR\[\[:space:\]\]\*#/);
  assert.match(sql,/coalesce\(site,''\)\)='mcp'/);
  assert.equal((sql.match(/COMMIT;/g)||[]).length,1);
});
