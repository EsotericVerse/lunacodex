import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/loc/scope-data.js',import.meta.url),'utf8');

async function createHarness({offline=false,emptyPublished=false}={}){
  const calls=[],database=[],moduleLoads=[];
  let editorReads=0;
  const context=vm.createContext({
    Promise,URLSearchParams,process:{env:{NEXT_PUBLIC_LOC_ISR_ORIGIN:'https://isr.lo3rwang.cc'}},
    fetch:async url=>{
      const value=String(url);
      calls.push(value);
      if(offline)throw Error('Native database disconnected');
      const kind=new URL(value,'https://loc.lo3rwang.cc').searchParams.get('kind');
      if(kind==='config')
        return {ok:true,json:async()=>({data:{id:'lo3rwang',display_name:'LIVE'}})};
      if(kind==='blocks'){
        editorReads++;
        return {ok:true,json:async()=>({data:[{uid:'editor-'+editorReads,block_order:1}]})};
      }
      return {ok:true,json:async()=>({data:[]})};
    }
  });
  const mocks={
    './db-query.mjs':{
      DB_QUERY_BATCH_SIZE:100,
      selectRows:async table=>{
        database.push(table);
        return {rows:[{id:'lo3rwang',uid:'legacy-management-read'}]};
      }
    },
    './scope-config-fields.mjs':{
      scopeConfigColumns:()=> 'id,display_name',
      scopeFeatureEnabled:()=>true
    },
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>false}},
    '../modular/scope-route-index.js':{SCOPE_ROUTE_INDEX:[
      {scope_id:'loc',active:true,config:{id:'loc',theme:'theme-7'}},
      {scope_id:'lo3rwang',active:true,config:{id:'lo3rwang',theme:'theme-8'}}
    ]},
    '../modular/published-site-bootstrap.js':{
      PUBLISHED_SITE_BOOTSTRAP:{version:1,registry:[],blocks:[]}
    },
    '../modular/published-blocks/index.js':{
      loadPublishedBlocks:async(id,page)=>{
        moduleLoads.push(id+':'+page);
        return emptyPublished?[]:[{uid:'published-'+id+'-'+page}];
      }
    }
  };
  const stubs=new Map(Object.entries(mocks).map(([id,values])=>[
    id,new vm.SyntheticModule(Object.keys(values),function(){
      for(const [key,value] of Object.entries(values))this.setExport(key,value);
    },{context,identifier:id})
  ]));
  const mod=new vm.SourceTextModule(source,{context,identifier:'scope-data.js'});
  await mod.link(id=>{
    const dependency=stubs.get(id);
    if(!dependency)throw Error('Unexpected import '+id);
    return dependency;
  });
  await mod.evaluate();
  return {
    calls,database,moduleLoads,
    selectPublicSiteBootstrap:mod.namespace.selectPublicSiteBootstrap,
    revalidateServerMetadata:mod.namespace.revalidateServerMetadata,
    selectScopeConfig:mod.namespace.selectScopeConfig,
    selectScopeBlocks:mod.namespace.selectScopeBlocks,
    selectLiveScopeBlocks:mod.namespace.selectLiveScopeBlocks,
    invalidateScopeBlockPage:mod.namespace.invalidateScopeBlockPage,
    invalidatePublicScopeMetadata:mod.namespace.invalidatePublicScopeMetadata,
    locPublicIsrUrl:mod.namespace.locPublicIsrUrl
  };
}

test('guest published page requires zero database reads',async()=>{
  const h=await createHarness();
  const [site,blocks]=await Promise.all([
    h.selectPublicSiteBootstrap(),h.selectScopeBlocks('lo3rwang','index')]);
  assert.equal(site.version,1);
  assert.equal(blocks[0].uid,'published-lo3rwang-index');
  assert.deepEqual(h.calls,[]);
  assert.deepEqual(h.database,[]);
  assert.deepEqual(h.moduleLoads,['lo3rwang:index']);
});

test('a live feature config calls the native Kysely application once',async()=>{
  const h=await createHarness();
  assert.equal((await h.selectScopeConfig('lo3rwang')).display_name,'LIVE');
  assert.equal((await h.selectScopeConfig('lo3rwang')).display_name,'LIVE');
  assert.equal(h.calls.length,1);
  assert.match(h.calls[0],/kind=config/);
  assert.deepEqual(h.database,[]);
});

test('unavailable Kysely must not blank the published config or homepage',async()=>{
  const h=await createHarness({offline:true});
  const [config,blocks]=await Promise.all([
    h.selectScopeConfig('lo3rwang'),h.selectScopeBlocks('lo3rwang','index')]);
  assert.equal(config.theme,'theme-8');
  assert.equal(blocks[0].uid,'published-lo3rwang-index');
  assert.deepEqual(h.database,[]);
});

test('live editor homepage Block SELECT is handled by the native Kysely app',async()=>{
  const h=await createHarness();
  assert.equal((await h.selectLiveScopeBlocks('lo3rwang','index'))[0].uid,'editor-1');
  assert.equal(h.calls.length,1);
  assert.match(h.calls[0],/kind=blocks/);
  assert.deepEqual(h.database,[]);
});

test('editor invalidation republishes no content and does not call an ISR Worker',async()=>{
  const h=await createHarness();
  assert.equal((await h.selectScopeBlocks('lo3rwang','index'))[0].uid,'published-lo3rwang-index');
  h.invalidateScopeBlockPage('lo3rwang','index');
  assert.equal((await h.selectScopeBlocks('lo3rwang','index'))[0].uid,'published-lo3rwang-index');
  assert.equal(h.moduleLoads.length,2);
  assert.deepEqual(h.calls,[]);
});

test('when a page has no published asset it can load its native live rows',async()=>{
  const h=await createHarness({emptyPublished:true});
  assert.equal((await h.selectScopeBlocks('lo3rwang','index'))[0].uid,'editor-1');
  assert.equal(h.calls.length,1);
  assert.deepEqual(h.database,[]);
});

test('public metadata invalidation reloads the published snapshot, not a retired RPC',async()=>{
  const h=await createHarness();
  await h.selectPublicSiteBootstrap();
  h.invalidatePublicScopeMetadata();
  assert.equal((await h.selectPublicSiteBootstrap()).version,1);
  assert.deepEqual(h.calls,[]);
});

test('legacy ISR origins cannot redirect any public Scope requests',async()=>{
  const h=await createHarness();
  assert.equal(h.locPublicIsrUrl('/api/loc/revalidate'),'/api/loc/revalidate');
  assert.equal(await h.revalidateServerMetadata(),false);
  await h.selectScopeBlocks('lo3rwang','index');
  assert.deepEqual(h.calls,[]);
});
