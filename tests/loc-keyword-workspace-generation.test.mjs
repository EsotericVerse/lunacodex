import test from 'node:test';
import assert from 'node:assert/strict';
import {readKeywordWorkspace} from '../app/loc/keywords/sql-service.mjs';
import {keywordClassEpoch,bumpKeywordClassEpoch,
  writeKeywordScanProgress,invalidateKeywordClass}
  from '../app/loc/keywords/class-state.mjs';

const first='AAAA0001',second='BBBB0002';
test('Keyword class Reset increments only its own generation',()=>{
  const meta={by_class:{[first]:{completedAt:'2026-01-01'}},
    scan_progress:{[first]:{cursor:'X'}},analysis_epochs:{[first]:3,[second]:8}};
  const cleared=bumpKeywordClassEpoch(
    writeKeywordScanProgress(invalidateKeywordClass(meta,first),first,null),first);
  assert.equal(keywordClassEpoch(cleared,first),4);
  assert.equal(keywordClassEpoch(cleared,second),8);
  assert.equal(cleared.by_class[first],undefined);
  assert.equal(cleared.scan_progress[first],undefined);
  assert.equal(keywordClassEpoch({},first),0);
});
test('Keyword workspace reads fixed UID-ordered Anchor and Scope config',async()=>{
  const used={tables:[],limits:[],where:[],sort:[]};
  const records=[{uid:'AAAA0001',type:'category',title:'Category',description:'',
    attr:{uid:['BBBB0002']}}];
  const query=(table)=>({
    select(){return this},
    where(...args){used.where.push(args);return this},
    orderBy(...args){used.sort.push(args);return this},
    limit(n){used.limits.push(n);return this},
    async execute(){return records},
    async executeTakeFirst(){return {current_keyword_class_uid:'BBBB0002',
      keyword_meta:{},keyword_min_chars:2,keyword_min_documents:1}}
  });
  const trx={selectFrom(table){used.tables.push(table);return query(table)}};
  const res=await readKeywordWorkspace(trx,'lo3rwang',{limit:250});
  assert.deepEqual(res.rows,records);
  assert.equal(res.config.current_keyword_class_uid,'BBBB0002');
  assert.equal(res.nextCursor,null);
  assert.deepEqual(used.tables,['silver.lo3rwang_anchor','silver.lo3rwang']);
  assert.deepEqual(used.limits,[251]);
  assert.ok(used.where.some(v=>v[0]==='type'&&v[1]==='in'));
  await assert.rejects(readKeywordWorkspace(trx,'lo3rwang',{limit:500}),
    /Invalid Keyword editor page size/);
});
