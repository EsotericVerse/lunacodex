import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schema} from '../zenstack/schema.mjs';
import {indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';
import {scopedZModelColumns} from '../zenstack/scoped-schema.mjs';
import {toAnchorRow,fromAnchorRow} from '../app/loc/unified-anchor-compat.mjs';

const ddl=readFileSync(
  new URL('../supabase/migrations/20261109013000_loc_anchor_scope_pattern_num.sql',import.meta.url),
  'utf8');
const uid=s=>String(s).padEnd(8,'0');
const row=(id,type,attr={})=>({uid:uid(id),type,title:id,attr});

test('one shared LOC mapping registry; existing Scope data stays in their own Anchors',()=>{
  assert.deepEqual(Object.keys(schema.models.LocAnchor.fields).sort(),
    ['uid','type','title','description','invisible','attr','createtime','num'].sort());
  for(const name of ['Lo3rwangAnchor','LrunesAnchor']){
    assert.equal(schema.models[name].fields.num.type,'BigInt');
  }
  assert.deepEqual([...scopedZModelColumns({scopeId:'demo'}).anchor].sort(),
    Object.keys(schema.models.Lo3rwangAnchor.fields).sort());
  assert.equal(schema.models.LocAnchor.attributes.some(a=>a.name==='@@allow'),false);
  assert.match(ddl,/CREATE TABLE IF NOT EXISTS silver\.loc_anchor/i);
  assert.match(ddl,/type IN \('database','table'\)/);
  assert.match(ddl,/database_uid/);
  assert.match(ddl,/REVOKE ALL ON silver\.loc_anchor FROM PUBLIC, anon, authenticated/);
});

test('Item links multiple Pattern Anchor UIDs, Pattern leaves keep own indexes',()=>{
  const nodes=[
    row('CLASS','class',{uid:[uid('GROUP')]}),
    row('GROUP','group',{uid:[uid('ITEM')]}),
    row('ITEM','item',{uid:[uid('PAT1'),uid('PAT2')]}),
    row('PAT1','pattern',{'DB000001':[uid('A'),uid('B')]}),
    row('PAT2','pattern',{'DB000001':[uid('B'),uid('C')]})
  ];
  const graph=indexZModelAnchorHierarchy(nodes,{family:'keyword',strict:true});
  assert.deepEqual(graph.childrenOf(uid('ITEM')),[uid('PAT1'),uid('PAT2')]);
  assert.deepEqual(graph.descendants(uid('CLASS'),{type:'pattern'}).uids,
    [uid('PAT1'),uid('PAT2')]);
});

test('one database today, additional db_uid arrays tomorrow, never flatten article IDs',()=>{
  const spec={kind:'keywords',legacy:'keywords'};
  const attr={'DB000001':[uid('A'),uid('B')]};
  const record=toAnchorRow(spec,{uid:uid('PAT1'),type:'pattern',title:'台北',num:2,attr});
  assert.deepEqual(record.attr,attr);
  assert.equal(record.num,2);
  assert.equal(fromAnchorRow(spec,record).num,2);
  assert.throws(()=>toAnchorRow(spec,{type:'pattern',attr:{'not-uid':['x']}}),
    /db_uid/);
  assert.throws(()=>toAnchorRow(spec,{type:'pattern',attr:{'DB000001':[uid('A'),uid('A')]}}),
    /db_uid/);
  const multi=toAnchorRow(spec,{uid:uid('PAT2'),type:'pattern',attr:{
    'DB000001':[uid('A')],'DB000002':[uid('A')]
  }});
  assert.equal(Object.keys(multi.attr).length,2,
    'same article UID on different databases must remain separate');
});

test('existing Item keyword arrays and Rune metadata CHECK semantics survive',()=>{
  assert.match(ddl,/Legacy Item keyword\[\] stays valid/);
  assert.match(ddl,/anchor_attr_keys_minimal_chk/);
  assert.doesNotMatch(ddl,/DROP TABLE silver\.(?:loc_search_pattern|lo3rwang_anchor|lrunes_anchor)/i);
  assert.doesNotMatch(ddl,/UPDATE silver\.(?:lo3rwang_anchor|lrunes_anchor)/i);
  assert.match(ddl,/ALTER TABLE %s ADD COLUMN IF NOT EXISTS num bigint NOT NULL DEFAULT 0/);
  assert.match(ddl,/type=''item''/);
  assert.match(ddl,/type=''pattern''/);
});
