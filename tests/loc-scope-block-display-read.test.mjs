import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {turnHomeBlocks} from '../app/loc/blocks/home-page-turn.mjs';
import {block_list} from '../app/loc/providers/kysely-public.mjs';
import {publicScopeBlockPage} from '../app/loc/blocks/public-scope-pages.mjs';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {managementHeroSlot} from '../app/loc/blocks/home-block-model.js';

{
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
}

{
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const blocksRoot=path.join(root,'app/modular/published-blocks');
const read=relative=>readFileSync(path.join(root,relative),'utf8');

function publishedBlocks(scope,page){
  const file=read('app/modular/published-blocks/'+scope+'/'+page+'.js');
  const match=file.match(/export default (\[[\s\S]*?\]);\s*$/);
  assert.ok(match,'Published file must contain one JSON array: '+scope+'/'+page);
  // Snapshot values are JSON, not executable data. HTML is JSON-escaped.
  assert.ok(!file.includes('<script'),'Unescaped HTML in snapshot: '+scope+'/'+page);
  return JSON.parse(match[1]);
}

test('all published Blocks have an exact lazy manifest entry and a stable typed shape',()=>{
  const manifest=read('app/modular/published-blocks/index.js');
  const entries=[...manifest.matchAll(/"([a-z0-9]+:[a-z0-9_]+)":\(\)=>import\('\.\/([^']+)'\)/g)];
  const mapped=new Set(entries.map(([,key])=>key));
  assert.equal(mapped.size,entries.length,'Manifest must not double-load pages');
  const physical=[];
  for(const scope of ['lo3rwang','loc','lrunes']){
    for(const name of readdirSync(path.join(blocksRoot,scope)).filter(x=>x.endsWith('.js'))){
      const page=name.slice(0,-3),key=scope+':'+page;
      physical.push(key);
      assert.ok(mapped.has(key),'Missing lazy-loader for '+key);
      const rows=publishedBlocks(scope,page);
      assert.ok(rows.length>0,'Empty published page '+key);
      const ids=new Set();
      let order=-1;
      for(const block of rows){
        assert.match(block.uid,/^[A-Za-z0-9]{8}$/);
        assert.equal(block.scope,scope);
        assert.equal(block.page_name,page);
        assert.ok(Number.isSafeInteger(block.block_order)&&block.block_order>=1);
        assert.ok(block.block_order>=order,'Blocks must remain ordered '+key);
        assert.ok(typeof block.block_text==='string');
        assert.ok(typeof block.block_title==='string');
        assert.ok(Array.isArray(block.block_entity));
        assert.ok(block.block_image===null||typeof block.block_image==='string');
        assert.ok(!ids.has(block.uid),'Duplicate block UID in '+key);
        ids.add(block.uid);order=block.block_order;
      }
    }
  }
  assert.equal(mapped.size,physical.length,'Manifest includes pages without a published JS module');
});
}

{
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('author Article Control Hero has stable identity even before live blocks arrive',()=>{
  const slot=managementHeroSlot('/lo3rwang/search/manage','lo3rwang',false,'search');
  assert.equal(slot.label,'文章管理');
  assert.equal(slot.page,'ScopeAdvSearch');
  assert.equal(managementHeroSlot('/lo3rwang/search','lo3rwang',false,'search'),null);
});
}
