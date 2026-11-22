import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {block_list} from '../app/loc/providers/kysely-public.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('LOC governance and homepage read their existing loc_anchor types',async()=>{
  const seen=[];
  const rows=await block_list({},'loc',{readLocAnchors:async types=>{
    seen.push(types);
    return [
      {uid:'AAAABBBB',type:'index',title:'New homepage',
        description:'Edited content',num:1,attr:{eyebrow:'LanguageCodex'}},
      {uid:'CCCCDDDD',type:'governance',title:'治理原則',
        description:'Existing principles',num:1,attr:{}}
    ];
  }});
  assert.deepEqual(seen,[['index','governance']]);
  assert.deepEqual(rows.map(row=>row.page_name),['governance','index']);
  assert.equal(rows.find(row=>row.page_name==='index').block_eyebrow,'LanguageCodex');
});

test('LOC governance management panel uses its persisted type, not Trace or loc_blocks',()=>{
  const page=source('app/loc/search/SearchManagement.jsx');
  assert.match(page,/isLocAdmin&&activeSection==='trace'\?<ScopeEditableBlocks[\s\S]*?page="governance"/);
  const scope=source('app/loc/scope/scope-data.js');
  assert.match(scope,/\['index','governance'\]\.includes\(name\)/);
  assert.match(scope,/nativePublicContent\('block_list',id\)/);
  const provider=source('app/loc/providers/kysely-public.mjs');
  assert.match(provider,/blockRelation\('loc_anchor'/);
  assert.doesNotMatch(provider,/blockRelation\('loc_blocks'/);
});

test('public homepage and feature Hero read live fixed Blocks instead of stale JS copy',()=>{
  const scope=source('app/loc/scope/scope-data.js');
  const editable=source('app/loc/blocks/ScopeEditableBlocks.jsx');
  const bootstrap=source('app/loc/runtime/app-bootstrap.js');
  const ui=source('app/modular/ui.jsx');
  assert.match(scope,/if\(id==='loc'\|\|name==='index'\)return selectLiveScopeBlocks\(id,name\)/);
  assert.match(editable,/=>selectLiveScopeBlocks\(scopeId,pageName\)/);
  assert.doesNotMatch(editable,/loadPublishedBlocks/);
  assert.match(bootstrap,/\?selectScopeBlocks\(id,page\)/);
  assert.doesNotMatch(bootstrap,/loadPublishedBlocks/);
  assert.match(ui,/=>hero_block\(\[groupHeroPage,scopeHeroPage\]\)/);
  assert.doesNotMatch(ui,/PUBLISHED_HERO_ROWS/);
});
