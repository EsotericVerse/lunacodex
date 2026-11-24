import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {turnHomeBlocks} from '../app/loc/blocks/home-page-turn.mjs';
import {block_list} from '../app/loc/providers/kysely-public.mjs';
import {publicScopeBlockPage} from '../app/loc/blocks/public-scope-pages.mjs';

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function mockBlocks(rows){
  const calls=[];
  const trx={
    selectFrom(table){
      calls.push(['from',table]);
      return {
        select(columns){
          calls.push(['select',columns]);
          return {
            where(column,operator,value){
              calls.push(['where',column,operator,value]);
              return {
                orderBy(key,direction){
                  calls.push(['orderBy',key,direction]);
                  return {
                    execute:async()=>rows.filter(row=>row.page_name===value)
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  return {trx,calls};
}

test('only guest-visible public Scope Block pages may be read',()=>{
  for(const page of ['index','search','trace','hero','game','culture','statics'])
    assert.equal(publicScopeBlockPage(page),page);
  for(const page of ['manage','scope_manage','admin','setting','internal','scope_admin',''])
    assert.equal(publicScopeBlockPage(page),null);
});

test('scope block_list selects one exact page without mutating anything',async()=>{
  const {trx,calls}=mockBlocks([
    {uid:'SEARCH01',page_name:'search',block_order:1},
    {uid:'INDEX001',page_name:'index',block_order:1}
  ]);
  const rows=await block_list(trx,'lo3rwang',{pageName:'search'});
  assert.deepEqual(rows.map(row=>row.uid),['SEARCH01']);
  assert.deepEqual(calls,[['from','silver.lo3rwang_blocks'],
    ['select',['uid','page_name','block_eyebrow','block_title','block_subtitle',
      'block_text','block_order','block_entity','block_image']],
    ['where','page_name','=','search'],['orderBy','block_order','asc']]);
});

test('block_list keeps legacy homepage default and rejects management pages',async()=>{
  const {trx,calls}=mockBlocks([{uid:'INDEX001',page_name:'index',block_order:1}]);
  const rows=await block_list(trx,'lo3rwang');
  assert.deepEqual(rows.map(row=>row.uid),['INDEX001']);
  assert.equal(calls.find(row=>row[0]==='where')[3],'index');
  await assert.rejects(()=>block_list(trx,'lo3rwang',{pageName:'scope_manage'}),
    /Invalid public Scope Block page/);
  await assert.rejects(()=>block_list(trx,'loc',{pageName:'search'}),
    /Invalid LOC public Block page/);
});

test('Scope edit display uses the feature-owned Blocks query, not arbitrary SELECT',()=>{
  const service=src('app/loc/scope/scope-data.js');
  const browser=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  const server=src('app/loc/server/public-named-transactions.mjs');
  const provider=src('app/loc/providers/kysely-public.mjs');
  assert.match(service,/queryBlocks\('block_list',\{p_scope_id:id,p_page_name:name\}\)/);
  assert.match(service,/p_scope_id:id,p_page_name:name/);
  assert.doesNotMatch(service,/selectAllRows\(`silver\.\$\{id\}_blocks`/);
  assert.match(server,/block_list:\['p_scope_id','p_page_name'\]/);
  assert.match(provider,/block_list:\['p_scope_id','p_page_name'\]/);
  assert.match(server,/publicScopeBlockPage\(body\.args\.p_page_name\)/);
  assert.match(browser,/重新讀取區塊/);
  assert.match(browser,/editorRows\.mutate\(\)/);
});

test('LOC homepage reveals copy independently of image load and respects reduced motion',()=>{
  const home=src('app/loc/blocks/LocHomeBlockDisplay.jsx');
  const css=src('app/styles/loc-about-original.css');
  assert.match(home,/onLoad=\{revealHomeImage\}/);
  assert.match(home,/node\?\.complete&&node\.naturalWidth>0/);
  assert.match(css,/@media\(prefers-reduced-motion:no-preference\)/);
  assert.match(css,/img\[data-home-media-ready="true"\]/);
  assert.match(css,/loc-home-copy-reveal/);
});
test('homepage draft preview uses the current unsaved drafts and preserves the editor',()=>{
  const home=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  const draft=src('app/loc/blocks/ScopeBlockDraftList.jsx');
  assert.match(home,/previewDisplay=\{scopeId==='loc'&&pageName==='index'\?DisplayComponent:null\}/);
  assert.match(draft,/previewRows=showingPreview\?visibleDrafts\.map/);
  assert.match(draft,/style=\{showingPreview\?\{display:'none'\}:undefined\}/);
  assert.match(draft,/\{visibleDrafts\.map\(\(draft,index\)=>renderDraft/);
  assert.match(draft,/<PreviewDisplay \{\.\.\.slot\}\/>/);
  assert.match(draft,/onClick=\{\(\)=>setRequestedPreview\(value=>!value\)\}/);
});

test('homepage keeps its public face until authorized editor data and module are ready',()=>{
  const home=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  assert.match(home,/publicBlocks\?\?lastPublished\.current/);
  assert.match(home,/!editingReady\|\|!homeDraftComponent\|\|homeTurned/);
  assert.match(home,/turnHomeBlocks\('edit',\(\)=>setHomeTurned\(true\)\)/);
  assert.match(home,/if\(homeTurned\)lastPublished\.current=null/);
  assert.match(home,/window\.addEventListener\('pagehide',leave\)/);
  assert.match(home,/if\(!event\.persisted\)return/);
});
test('page turn is reversible and cancelled on abandonment',async()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  let resolve,finished=0,cancelled=0,animated=0;
  const frames=[];
  try{
    globalThis.window={innerHeight:800,matchMedia:()=>({matches:false})};
    globalThis.document={querySelectorAll:()=>[
      {getBoundingClientRect:()=>({width:600,height:400,top:0,bottom:400}),
       animate:(steps,options)=>{animated++;frames.push({steps,options});return{
         finished:new Promise(r=>{resolve=r}),cancel(){cancelled++}
       }}},
      {getBoundingClientRect:()=>({width:0,height:0,top:0,bottom:0}),
       animate:()=>{throw Error('hidden editor must not animate')}}
    ]};
    const stop=turnHomeBlocks('preview',()=>finished++);
    assert.equal(animated,1);
    assert.match(frames[0].steps[1].transform,/rotateY\(-58deg\)/);
    stop();resolve();
    await Promise.resolve();await Promise.resolve();
    assert.equal(cancelled,1);assert.equal(finished,0);
    const done=turnHomeBlocks('edit',()=>finished++);
    assert.match(frames[1].steps[1].transform,/rotateY\(58deg\)/);
    resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(finished,1);done();
    globalThis.window.matchMedia=()=>({matches:true});
    turnHomeBlocks('edit',()=>finished++)();
    assert.equal(finished,2);assert.equal(animated,2);
  }finally{
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  }
});
