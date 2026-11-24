import test from 'node:test';
import assert from 'node:assert/strict';
import {saveBlocksKysely} from '../app/loc/providers/kysely-blocks.mjs';
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
  const slot=managementHeroSlot('searchManage','lo3rwang');
  assert.equal(slot.label,'文章管理');
  assert.equal(slot.page,'ScopeArticle');
  assert.equal(managementHeroSlot('search','lo3rwang'),null);
});
}

{
const block=(uid,order,title)=>({
  uid,block_order:order,block_title:title,
  block_eyebrow:'',block_subtitle:'',block_text:'Body',
  block_entity:[],block_image:null
});

function makeDb(existing,updatedRows=1n){
  const calls=[];
  const db={
    selectFrom(table){
      return {select:()=>({execute:async()=>{calls.push(['read',table]);return existing;}})};
    },
    insertInto(table){
      return {values:rows=>({
        execute:async()=>{calls.push(['insert',table,rows]);return [];}
      })};
    },
    updateTable(table){
      return {set:values=>{
        const predicates=[];
        return {
          where(...args){predicates.push(args);return this;},
          async executeTakeFirst(){
            calls.push(['update',table,values,predicates]);
            return {numUpdatedRows:updatedRows};
          }
        };
      }};
    },
    deleteFrom(table){
      const predicates=[];
      return {
        where(...args){predicates.push(args);return this;},
        async execute(){
          calls.push(['delete',table,predicates]);
          return [];
        }
      };
    }
  };
  return {db,calls};
}

test('SQL Server Block save groups new UIDs, guards existing UIDs, and deletes removed page rows',async()=>{
  const {db,calls}=makeDb([
    {uid:'AAAA0001',page_name:'home'},
    {uid:'AAAA0002',page_name:'home'},
    {uid:'CCCC0001',page_name:'other'}
  ]);
  const result=await saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',
    p_rows:[block('AAAA0001',1,'updated'),block('BBBB0001',2,'new')]
  },{engine:'mssql',namespace:'dbo'});
  assert.equal(result.count,2);
  assert.equal(result.removed,1);
  assert.equal(calls.filter(x=>x[0]==='read').length,1);
  const added=calls.find(x=>x[0]==='insert');
  assert.equal(added[1],'dbo.lo3rwang_blocks');
  assert.deepEqual(added[2].map(row=>row.uid),['BBBB0001']);
  assert.equal(added[2][0].block_entity,'[]');
  const changed=calls.find(x=>x[0]==='update');
  assert.equal(changed[2].block_title,'updated');
  assert.deepEqual(changed[3],[['uid','=','AAAA0001'],['page_name','=','home']]);
  const removed=calls.find(x=>x[0]==='delete');
  assert.ok(removed);
  assert.deepEqual(removed[2][0],['page_name','=','home']);
  assert.deepEqual(removed[2][1],['uid','in',['AAAA0002']]);
});

test('SQL Server Block save cannot overwrite an existing UID from another page',async()=>{
  const {db,calls}=makeDb([{uid:'AAAA0001',page_name:'other'}]);
  await assert.rejects(saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',p_rows:[block('AAAA0001',1,'foreign')]
  },{engine:'mssql',namespace:'dbo'}),/Block UID belongs to another page/);
  assert.equal(calls.filter(x=>x[0]!=='read').length,0);
});

test('SQL Server Block save treats a concurrent disappearance as conflict',async()=>{
  const {db,calls}=makeDb([{uid:'AAAA0001',page_name:'home'}],0n);
  await assert.rejects(saveBlocksKysely(db,{
    p_scope_id:'lo3rwang',p_type:'home',p_rows:[block('AAAA0001',1,'changed')]
  },{engine:'mssql',namespace:'dbo'}),error=>
    error?.httpStatus===409&&/Block changed/.test(error.message));
  assert.equal(calls.filter(x=>x[0]==='update').length,1);
});
}
