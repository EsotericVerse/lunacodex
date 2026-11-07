import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/loc/scope-data.js',import.meta.url),'utf8');

async function createHarness({emptyPageBlocks=false}={}){
  const calls=[],database=[],actionCalls=[],moduleLoads=[];
  let pageReads=0;
  const context=vm.createContext({
    Promise,process:{env:{NEXT_PUBLIC_LOC_ISR_ORIGIN:'https://isr.lo3rwang.cc'}},
    fetch:async(url)=>{calls.push(String(url));throw Error('Retired ISR request '+url);}
  });
  const publicClient={schema:()=>({publicAction:async(name)=>{
    actionCalls.push(name);
    if(name==='read_app_bootstrap')
      return {data:{version:99,registry:[],blocks:[]},error:null};
    if(name==='page_blocks'){
      pageReads++;
      return {data:emptyPageBlocks?[]:[{uid:pageReads===1?'public-block':'editor-latest'}],error:null};
    }
    return {data:[],error:null};
  }})};
  const mocks={
    './db-query.mjs':{
      DB_QUERY_BATCH_SIZE:100,
      selectRows:async table=>{
        database.push(table);
        return {rows:[{id:'lo3rwang',uid:'editor-latest'}]};
      }
    },
    './scope-config-fields.mjs':{
      scopeConfigColumns:()=> 'id,display_name',
      scopeFeatureEnabled:()=>true
    },
    './db-client.mjs':{dbPublicClient:publicClient,dbConfiguredPublicClient:publicClient},
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>false}},
    '../modular/scope-route-index.js':{SCOPE_ROUTE_INDEX:[
      {scope_id:'loc',config:{id:'loc',theme:'theme-7'}},
      {scope_id:'lo3rwang',config:{id:'lo3rwang',theme:'theme-8'}}
    ]},
    '../modular/published-site-bootstrap.js':{
      PUBLISHED_SITE_BOOTSTRAP:{version:1,registry:[],blocks:[]}
    },
    '../modular/published-blocks/index.js':{
      loadPublishedBlocks:async(id,page)=>{
        moduleLoads.push(id+':'+page);
        return [{uid:'published-fallback'}];
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
    calls,database,actionCalls,moduleLoads,
    selectPublicSiteBootstrap:mod.namespace.selectPublicSiteBootstrap,
    revalidateServerMetadata:mod.namespace.revalidateServerMetadata,
    selectScopeConfig:mod.namespace.selectScopeConfig,
    selectScopeBlocks:mod.namespace.selectScopeBlocks,
    invalidateScopeBlockPage:mod.namespace.invalidateScopeBlockPage,
    invalidatePublicScopeMetadata:mod.namespace.invalidatePublicScopeMetadata,
    locPublicIsrUrl:mod.namespace.locPublicIsrUrl
  };
}

test('published site JS and bounded Scope Config / Blocks reads remain independently cached',async()=>{
  const h=await createHarness();
  const [site,config,blocks]=await Promise.all([
    h.selectPublicSiteBootstrap(),h.selectScopeConfig('lo3rwang'),
    h.selectScopeBlocks('lo3rwang','index')
  ]);
  assert.equal(site.version,1);
  assert.equal(config.id,'lo3rwang');
  assert.equal(blocks[0].uid,'public-block');
  await Promise.all([
    h.selectPublicSiteBootstrap(),h.selectScopeConfig('lo3rwang'),
    h.selectScopeBlocks('lo3rwang','index')
  ]);
  assert.deepEqual(h.database,['silver.lo3rwang']);
  assert.deepEqual(h.actionCalls,['page_blocks']);
  assert.deepEqual(h.moduleLoads,[]);
  assert.deepEqual(h.calls,[]);
});

test('Block editor invalidation reads that page once again without an ISR Worker',async()=>{
  const h=await createHarness();
  assert.equal((await h.selectScopeBlocks('lo3rwang','index'))[0].uid,'public-block');
  h.invalidateScopeBlockPage('lo3rwang','index');
  assert.equal((await h.selectScopeBlocks('lo3rwang','index'))[0].uid,'editor-latest');
  assert.deepEqual(h.actionCalls,['page_blocks','page_blocks']);
  assert.deepEqual(h.database,[]);
  assert.deepEqual(h.calls,[]);
});

test('remote ISR revalidation remains disabled while published site JS is available',async()=>{
  const h=await createHarness();
  assert.equal((await h.selectPublicSiteBootstrap()).version,1);
  assert.equal(await h.revalidateServerMetadata(),false);
  assert.equal((await h.selectPublicSiteBootstrap()).version,1);
  assert.deepEqual(h.actionCalls,[]);
  assert.deepEqual(h.calls,[]);
});

test('empty live Page Blocks fall back to published Blocks without a worker',async()=>{
  const h=await createHarness({emptyPageBlocks:true});
  const first=await h.selectScopeBlocks('lo3rwang','index');
  assert.equal(first[0].uid,'published-fallback');
  assert.deepEqual(h.actionCalls,['page_blocks']);
  assert.deepEqual(h.moduleLoads,['lo3rwang:index']);
  assert.deepEqual(h.calls,[]);
});

test('editor metadata invalidation refreshes the site snapshot through one SQL public action',async()=>{
  const h=await createHarness();
  await h.selectPublicSiteBootstrap();
  h.invalidatePublicScopeMetadata();
  assert.equal((await h.selectPublicSiteBootstrap()).version,99);
  assert.deepEqual(h.actionCalls,['read_app_bootstrap']);
  assert.deepEqual(h.database,[]);
  assert.deepEqual(h.calls,[]);
});

test('legacy ISR origins cannot redirect public Scope requests',async()=>{
  const h=await createHarness();
  assert.equal(h.locPublicIsrUrl('/api/loc/revalidate'),'/api/loc/revalidate');
  await h.selectScopeBlocks('lo3rwang','index');
  assert.deepEqual(h.actionCalls,['page_blocks']);
  assert.deepEqual(h.calls,[]);
});
