import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('Scope edit display uses one existing fixed action, not retired arbitrary SELECT',()=>{
  const service=src('app/loc/scope/scope-data.js');
  const browser=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  const server=src('app/loc/server/public-named-transactions.mjs');
  const provider=src('app/loc/providers/kysely-public.mjs');
  assert.match(service,/\.publicAction\('block_list',\{/);
  assert.match(service,/p_scope_id:id,p_page_name:name/);
  assert.doesNotMatch(service,/selectAllRows\(`silver\.\$\{id\}_blocks`/);
  assert.match(server,/block_list:\['p_scope_id','p_page_name'\]/);
  assert.match(provider,/block_list:\['p_scope_id','p_page_name'\]/);
  assert.match(server,/publicScopeBlockPage\(body\.args\.p_page_name\)/);
  assert.match(browser,/重新讀取區塊/);
  assert.match(browser,/editorRows\.mutate\(\)/);
});

test('homepage display renders as a React component with stable sibling keys',()=>{
  const browser=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  assert.match(browser,/const DisplayComponent=typeof renderDisplay===/);
  assert.equal((browser.match(/<DisplayComponent key="slot-display" \{\.\.\.slot\}\/>/g)||[]).length,2);
  assert.equal((browser.match(/<Fragment key="slot-display">/g)||[]).length,2);
  assert.doesNotMatch(browser,/renderDisplay\(slot\)/);
  assert.match(browser,/<motion\.span key="hero-line"/);
  assert.match(browser,/key=\{slot\.uid\|\|'order:'\+slot\.order\}/);
});

test('shared home display assigns explicit keys to prebuilt React siblings',()=>{
  const home=src('app/loc/blocks/LocHomeBlockDisplay.jsx');
  // JSX stored in variables, then inserted into a Fragment, is different from
  // inline literal JSX: its element identity must be explicit for React.
  for(const marker of [
    '<header key="header"',
    '<RichHtml key="body"',
    '<figure key="media"',
    '<article key="media"',
    '<div key="body"',
    '<div key="children"',
    '<span key="identity"'
  ])assert.ok(home.includes(marker),'SharedHomeBlockDisplay missing '+marker);
  assert.match(home,/children\.map\(\(entity,index\)=>\{/);
  assert.match(home,/key=\{entity\.uid\|\|'child-'\+index\}/);
});

test('motion home sections receive a single keyed Fragment child, not a sibling array',()=>{
  const source=src('app/loc/blocks/ScopeEditableBlocks.jsx');
  const motionBranch=source.split('const node=<HomeDisplayTag')[1]?.split('</HomeDisplayTag>')[0];
  assert.ok(motionBranch,'homepage motion section renderer missing');
  assert.match(motionBranch,/>\s*<Fragment key="motion-section-content">/);
  assert.match(motionBranch,/<motion\.span key="hero-line"/);
  assert.match(motionBranch,/<DisplayComponent key="slot-display"/);
  assert.match(motionBranch,/<\/Fragment>\s*$/);
});

test('development never registers a production SW or reuses LOC static Next caches',()=>{
  const shell=src('app/AppShell.jsx');
  assert.match(shell,/process\.env\.NODE_ENV==='development'/);
  assert.match(shell,/navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(shell,/reg\.unregister\(\)/);
  assert.match(shell,/name\.startsWith\('loc-static-next-'\)/);
  assert.match(shell,/navigator\.serviceWorker\.register\('\/sw\.js'/);
});
