import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {SCOPE_ROUTE_INDEX} from '../app/modular/routing/scope-route-index.js';
import {
  PUBLIC_HOME_PAGE_COPY_KEY,PUBLIC_LOC_HOME_BLOCKS_KEY,
  PUBLIC_LOC_HOME_BLOCKS_PREFIX,moveLegacyLocHomeBlockObjects,
  publicHomeKeysForWrite,publicScopeBlocksKey,readPublicHomeObject,
  validPublicHomeBlockRows,validPublicHomePageCopy,
  writePublicHomeObject,invalidatePublicHomeObjects
} from '../app/loc/blocks/public-home-r2.mjs';

function fakeBucket(){
  const values=new Map();
  const etag=body=>String(body.length)+':'+body;
  return {
    values,
    async get(key){
      if(!values.has(key))return null;
      const body=values.get(key);
      return {size:new TextEncoder().encode(body).byteLength,
        etag:etag(body),httpMetadata:{contentType:'application/json'},
        async text(){return body;},body};
    },
    async put(key,body,options){
      if(options?.httpMetadata)
        assert.match(options.httpMetadata.contentType,/^application\/json(?:; charset=utf-8)?$/);
      if(options?.onlyIf?.etagDoesNotMatch==='*'&&values.has(key))return null;
      const text=typeof body==='string'?body:String(body);
      values.set(key,text);
      return {size:new TextEncoder().encode(text).byteLength,etag:etag(text)};
    },
    async head(key){
      if(!values.has(key))return null;
      const body=values.get(key);
      return {size:new TextEncoder().encode(body).byteLength,etag:etag(body)};
    },
    async list({prefix}){
      return {objects:[...values].filter(([key])=>key.startsWith(prefix))
        .map(([key,body])=>({key,size:new TextEncoder().encode(body).byteLength,
          etag:etag(body)})),truncated:false};
    },
    async delete(key){values.delete(key);}
  };
}

test('R2 object paths keep public blocks separate from SiteAnchor taxonomy',()=>{
  assert.equal(publicScopeBlocksKey('loc','index'),PUBLIC_LOC_HOME_BLOCKS_KEY);
  assert.equal(publicScopeBlocksKey('loc','governance'),PUBLIC_LOC_HOME_BLOCKS_KEY);
  assert.equal(publicScopeBlocksKey('loc','scope_culture'),
    PUBLIC_LOC_HOME_BLOCKS_PREFIX+'scope_culture.json');
  assert.equal(publicScopeBlocksKey('lo3rwang','index'),
    'loc/public-home/v1/scope-blocks/lo3rwang/index.json');
  for(const type of ['universe','galaxy','domain','from'])
    assert.equal(publicScopeBlocksKey('loc',type),null);
  assert.equal(publicScopeBlocksKey('admin','index'),null);
});

test('legacy LOC R2 block objects move to Lucus keys and are verified before deletion',async()=>{
  const bucket=fakeBucket();
  const oldKey='loc/public-home/v1/loc-anchor-blocks/scope_culture.json';
  const newKey=PUBLIC_LOC_HOME_BLOCKS_PREFIX+'scope_culture.json';
  const body=JSON.stringify([{uid:'Abc12345',page_name:'scope_culture',block_order:1}]);
  bucket.values.set(oldKey,body);
  const moved=await moveLegacyLocHomeBlockObjects(bucket);
  assert.deepEqual(moved,[{from:oldKey,to:newKey,alreadyPresent:false}]);
  assert.equal(bucket.values.has(oldKey),false);
  assert.equal(bucket.values.get(newKey),body);
});

test('legacy R2 move refuses to overwrite a different Lucus object',async()=>{
  const bucket=fakeBucket();
  bucket.values.set('loc/public-home/v1/loc-anchor-blocks/home.json','old');
  bucket.values.set(PUBLIC_LOC_HOME_BLOCKS_PREFIX+'home.json','new');
  await assert.rejects(moveLegacyLocHomeBlockObjects(bucket),/different content/);
  assert.equal(bucket.values.get('loc/public-home/v1/loc-anchor-blocks/home.json'),'old');
  assert.equal(bucket.values.get(PUBLIC_LOC_HOME_BLOCKS_PREFIX+'home.json'),'new');
});

test('legacy R2 move uses a create-only write and preserves concurrent destination content',async()=>{
  const bucket=fakeBucket();
  const oldKey='loc/public-home/v1/loc-anchor-blocks/home.json';
  const newKey=PUBLIC_LOC_HOME_BLOCKS_PREFIX+'home.json';
  bucket.values.set(oldKey,'source');
  const put=bucket.put.bind(bucket);
  bucket.put=async(key,body,options)=>{
    if(key===newKey)bucket.values.set(newKey,'concurrent writer');
    return put(key,body,options);
  };
  await assert.rejects(moveLegacyLocHomeBlockObjects(bucket),/destination conflicts/);
  assert.equal(bucket.values.get(oldKey),'source');
  assert.equal(bucket.values.get(newKey),'concurrent writer');
});

test('legacy R2 move can finish when a concurrent writer already stored the same object',async()=>{
  const bucket=fakeBucket();
  const oldKey='loc/public-home/v1/loc-anchor-blocks/home.json';
  const newKey=PUBLIC_LOC_HOME_BLOCKS_PREFIX+'home.json';
  bucket.values.set(oldKey,'same content');
  const put=bucket.put.bind(bucket);
  bucket.put=async(key,body,options)=>{
    if(key===newKey)bucket.values.set(newKey,'same content');
    return put(key,body,options);
  };
  const moved=await moveLegacyLocHomeBlockObjects(bucket);
  assert.deepEqual(moved,[{from:oldKey,to:newKey,alreadyPresent:false}]);
  assert.equal(bucket.values.has(oldKey),false);
  assert.equal(bucket.values.get(newKey),'same content');
});

test('release JS keeps routing and SiteAnchor but contains no mutable homepage copy',()=>{
  assert.equal(Object.hasOwn(PUBLISHED_SITE_BOOTSTRAP,'page_copy'),false);
  assert.equal(Object.hasOwn(PUBLISHED_SITE_BOOTSTRAP,'blocks'),false);
  assert.ok(PUBLISHED_SITE_BOOTSTRAP.site_lucus.length>0);
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
    p_table:'silver.lo3rwang_lucus',p_operation:'update',p_values:{title:'詞'}
  }]}),[]);
});
