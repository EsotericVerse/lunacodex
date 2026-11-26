import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {SCOPE_ROUTE_INDEX} from '../app/modular/routing/scope-route-index.js';
import {
  PUBLIC_HOME_PAGE_COPY_KEY,PUBLIC_LOC_HOME_BLOCKS_KEY,
  publicHomeKeysForWrite,publicScopeBlocksKey,readPublicHomeObject,
  validPublicHomeBlockRows,validPublicHomePageCopy,
  writePublicHomeObject,invalidatePublicHomeObjects
} from '../app/loc/blocks/public-home-r2.mjs';

function fakeBucket(){
  const values=new Map();
  return {
    values,
    async get(key){
      if(!values.has(key))return null;
      const body=values.get(key);
      return {size:new TextEncoder().encode(body).byteLength,
        async text(){return body;},body:{async cancel(){}}};
    },
    async put(key,body,options){
      assert.equal(options.httpMetadata.contentType,'application/json; charset=utf-8');
      values.set(key,String(body));
    },
    async delete(key){values.delete(key);}
  };
}

test('R2 object paths keep public blocks separate from SiteAnchor taxonomy',()=>{
  assert.equal(publicScopeBlocksKey('loc','index'),PUBLIC_LOC_HOME_BLOCKS_KEY);
  assert.equal(publicScopeBlocksKey('loc','governance'),PUBLIC_LOC_HOME_BLOCKS_KEY);
  assert.equal(publicScopeBlocksKey('loc','scope_culture'),
    'loc/public-home/v1/loc-anchor-blocks/scope_culture.json');
  assert.equal(publicScopeBlocksKey('lo3rwang','index'),
    'loc/public-home/v1/scope-blocks/lo3rwang/index.json');
  for(const type of ['universe','galaxy','domain','from'])
    assert.equal(publicScopeBlocksKey('loc',type),null);
  assert.equal(publicScopeBlocksKey('admin','index'),null);
});

test('release JS keeps routing and SiteAnchor but contains no mutable homepage copy',()=>{
  assert.equal(Object.hasOwn(PUBLISHED_SITE_BOOTSTRAP,'page_copy'),false);
  assert.equal(Object.hasOwn(PUBLISHED_SITE_BOOTSTRAP,'blocks'),false);
  assert.ok(PUBLISHED_SITE_BOOTSTRAP.site_anchors.length>0);
  for(const row of PUBLISHED_SITE_BOOTSTRAP.registry)
    assert.equal(Object.hasOwn(row,'display_name'),false);
  for(const route of SCOPE_ROUTE_INDEX){
    for(const key of ['display_name','search_intro','search_aliases'])
      assert.equal(Object.hasOwn(route.config||{},key),false);
  }
});

test('R2 public projections reject extra/private fields and malformed rows',()=>{
  assert.equal(validPublicHomePageCopy([
    {scope_id:'loc',display_name:'LOC',title_tw:'首頁',desc_tw:'說明'}
  ]),true);
  assert.equal(validPublicHomePageCopy([
    {scope_id:'loc',email:'private@example.test'}
  ]),false);
  assert.equal(validPublicHomeBlockRows([
    {uid:'Abc12345',page_name:'index',block_order:1,block_title:'標題'}
  ]),true);
  assert.equal(validPublicHomeBlockRows([
    {uid:'Abc12345',page_name:'index',block_order:1,email:'private@example.test'}
  ]),false);
});

test('R2 read-through writes, reads, and invalidates fixed JSON objects',async()=>{
  const bucket=fakeBucket();
  const rows=[{uid:'Abc12345',page_name:'scope_culture',block_order:1,
    block_title:'標題'}];
  assert.equal(await writePublicHomeObject(bucket,
    publicScopeBlocksKey('loc','scope_culture'),rows),true);
  const cached=await readPublicHomeObject(bucket,
    publicScopeBlocksKey('loc','scope_culture'),validPublicHomeBlockRows);
  assert.deepEqual(cached,{hit:true,value:rows});
  assert.equal(await invalidatePublicHomeObjects(bucket,
    [publicScopeBlocksKey('loc','scope_culture')]),true);
  assert.deepEqual(await readPublicHomeObject(bucket,
    publicScopeBlocksKey('loc','scope_culture'),validPublicHomeBlockRows),
  {hit:false,value:null});
  assert.equal(await writePublicHomeObject(bucket,PUBLIC_HOME_PAGE_COPY_KEY,
    'x'.repeat(4*1024*1024)),false);
});

test('only homepage writes invalidate their matching R2 projection',()=>{
  assert.deepEqual(publicHomeKeysForWrite({kind:'managed-action',
    name:'save_blocks',args:{p_scope_id:'loc',p_type:'index'}}),
  [PUBLIC_LOC_HOME_BLOCKS_KEY]);
  assert.deepEqual(publicHomeKeysForWrite({kind:'managed-action',
    name:'update_group_member_name',args:{p_group_id:'loc',p_member_id:'lrunes'}}),
  [PUBLIC_HOME_PAGE_COPY_KEY]);
  assert.deepEqual(publicHomeKeysForWrite({kind:'managed-transaction',operations:[{
    p_table:'silver.loc',p_operation:'update',p_values:{title_tw:'新標題'}
  }]}),[PUBLIC_HOME_PAGE_COPY_KEY]);
  assert.deepEqual(publicHomeKeysForWrite({kind:'managed-transaction',operations:[{
    p_table:'silver.lo3rwang_anchor',p_operation:'update',p_values:{title:'詞'}
  }]}),[]);
});
