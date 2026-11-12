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

test('LOC-wide and Scope Anchor models are in the fixed schema',()=>{
  assert.equal(schema.models.LocAnchor.fields.num.type,'BigInt');
  for(const name of ['Lo3rwangAnchor','LrunesAnchor'])
    assert.equal(schema.models[name].fields.num.type,'BigInt');
  assert.deepEqual([...scopedZModelColumns({scopeId:'demo'}).anchor].sort(),
    Object.keys(schema.models.Lo3rwangAnchor.fields).sort());
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

test('current Pattern posting format remains valid',()=>{
  const spec={kind:'keywords',legacy:'keywords'};
  const attr={'63ade525':[uid('A'),uid('B')]};
  const record=toAnchorRow(spec,{uid:uid('PAT1'),type:'pattern',title:'台北',num:2,attr});
  assert.deepEqual(record.attr,attr);
  assert.equal(record.num,2);
  assert.equal(fromAnchorRow(spec,record).num,2);
  assert.throws(()=>toAnchorRow(spec,{type:'pattern',attr:{'not-uid':['x']}}),/db_uid/);
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
