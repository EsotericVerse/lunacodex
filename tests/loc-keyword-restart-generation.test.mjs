import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeKeywordScope} from '../app/loc/keywords/sql-service.mjs';
import {keywordClassEpoch,readKeywordScanProgress}
  from '../app/loc/keywords/class-state.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const CLASS='CLASS001';

function staleJobDatabase(){
  const calls=[];
  const config={
    keyword_meta:{analysis_epochs:{[CLASS]:12},
      scan_progress:{[CLASS]:{scanned:4096,cursor:{phase:'dated',
        lastDate:'2026-11-01',lastUid:'ABCDEFGH'}}}},
    keyword_min_chars:0,keyword_min_documents:1
  };
  const root={uid:CLASS,type:'class',title:'Words',description:'',attr:{uid:[]}};
  const db={
    selectFrom(table){
      calls.push(table);
      if(table!=='silver.lo3rwang'&&table!=='silver.lo3rwang_anchor')
        throw new Error('A stale run must never touch Galaxy');
      const query={
        select(){return query},
        where(){return query},
        async executeTakeFirst(){
          return table==='silver.lo3rwang'?config:root;
        }
      };
      return query;
    }
  };
  return {db,calls,config};
}

test('new analysis cannot reuse an older generation after a reset',async()=>{
  const {db,calls}=staleJobDatabase();
  await assert.rejects(analyzeKeywordScope(db,'lo3rwang',CLASS,{
    analysisEpoch:11
  }),/舊分析工作階段已失效/);
  assert.deepEqual(calls,['silver.lo3rwang','silver.lo3rwang_anchor']);
});

test('new analysis refuses tokenless or invalid reset generations',async()=>{
  for(const epoch of [undefined,0,-1,1.5,'12',null]){
    const {db,calls}=staleJobDatabase();
    await assert.rejects(analyzeKeywordScope(db,'lo3rwang',CLASS,{
      analysisEpoch:epoch
    }),/confirmed reset generation/);
    assert.equal(calls.length,0);
  }
});

test('restart button must commit reset before starting the new epoch of batches',()=>{
  const ui=source('app/loc/keywords/ui/KeywordLibraryPanel.jsx');
  const runner=source('app/loc/keywords/analysis.js');
  const backend=source('app/loc/keywords/api.mjs');
  const service=source('app/loc/keywords/sql-service.mjs');
  const run=ui.slice(ui.indexOf('  const run=async(reset=false)=>{'),
    ui.indexOf('  const checkUnconfirmed=async()=>{'));
  const clearAt=run.indexOf('const cleared=await resetKeywordClassification(');
  const startAt=run.indexOf('await runKeywordAnalysisBatch(');
  assert.ok(clearAt>=0&&startAt>clearAt);
  assert.match(run,/analysisEpoch:cleared\.resetEpoch/);
  assert.match(run,/storeUnconfirmed\(null\)/);
  assert.match(run,/if\(clearedCommitted\)\{/);
  assert.doesNotMatch(run,/!reset&&unconfirmedAttempt/);
  assert.match(ui,/重新開始解析/);
  assert.doesNotMatch(ui,/onClick=\{resumeUnconfirmedTail\}/);
  assert.match(runner,/result=await keywordService\('analyze',\{\s*scopeId:id,classUid,analysisEpoch/);
  assert.match(backend,/!Number\.isSafeInteger\(args\.analysisEpoch\)/);
  assert.match(backend,/analysisEpoch:args\.analysisEpoch/);
  assert.match(service,/if\(expectedEpoch!==analysisEpoch\)/);
  assert.match(service,/await lockedKeywordMetadata\(trx,scope,classUid,expectedEpoch\)/);
});

test('an old saved cursor is only meaningful within its own epoch',()=>{
  const config={analysis_epochs:{[CLASS]:12},
    scan_progress:{[CLASS]:{cursor:{phase:'dated',
      lastDate:'2026-11-01',lastUid:'ABCDEFGH'},scanned:4096}}};
  assert.equal(keywordClassEpoch(config,CLASS),12);
  assert.equal(readKeywordScanProgress(config,CLASS).scanned,4096);
  // The server rejects stale epoch 11 BEFORE it can examine or reuse this
  // checkpoint; the new run only sees checkpoints saved after its own reset.
});
