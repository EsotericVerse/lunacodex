import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

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

test('LOC governance is only published through its existing trace page',()=>{
  const manifest=read('app/modular/published-blocks/index.js');
  assert.ok(manifest.includes('"loc:trace"'));
  assert.ok(!manifest.includes('"loc:governance"'));
  const rows=publishedBlocks('loc','trace');
  assert.ok(rows.length>0);
  assert.ok(rows.every(row=>row.page_name==='trace'));
  const publisher=read('scripts/generate-public-blocks.mjs');
  assert.ok(publisher.includes("originalPage==='governance'?'trace'"));
  assert.ok(publisher.includes("allBlocks.get(key).push({...block,scope:id,page_name:page})"));
  assert.ok(!publisher.includes('cleanPublishedHtml'));
  assert.ok(!publisher.includes('cleanPublishedBlock'));
});
