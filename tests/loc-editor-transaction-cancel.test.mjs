import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {openEditorTransactionSession,rotateActiveEditorTransactionSession} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {editorTransactionLease} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {assertEditorTransactionLease} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {registerEditorTransactionDisposer} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {cancelEditorTransactionSession} from '../app/loc/db/editor-transaction-lifecycle.mjs';

{

test('Cancel aborts running work, drains retry hooks, fences stale generations',()=>{
  openEditorTransactionSession();
  const old=editorTransactionLease();
  assert.equal(old.signal.aborted,false);
  let cleaned=0;
  registerEditorTransactionDisposer(()=>cleaned++);
  const unregister=registerEditorTransactionDisposer(()=>cleaned+=100);
  unregister();
  cancelEditorTransactionSession();
  assert.equal(old.signal.aborted,true);
  assert.equal(cleaned,1);
  assert.throws(()=>assertEditorTransactionLease(old),{code:'LOC_EDITOR_CANCELLED'});
  const stopped=editorTransactionLease();
  assert.equal(stopped.signal.aborted,true);
  openEditorTransactionSession();
  const fresh=editorTransactionLease();
  assert.equal(fresh.signal.aborted,false);
  assert.throws(()=>assertEditorTransactionLease(old),{code:'LOC_EDITOR_CANCELLED'});
  assert.doesNotThrow(()=>assertEditorTransactionLease(fresh));
  cancelEditorTransactionSession();
  assert.equal(cleaned,1);
});

test('Cancel marks an in-flight Server Action result unknown and blocks the next write',async()=>{
  let calls=0,finishWrite;
  const adapter=createConfiguredAdapter({
    accountAdapter:{auth:{}},
    fetchImpl:()=>{throw new Error('Ordinary writes must not use fetch');},
    localWrite:()=>{
      calls++;
      return new Promise(resolve=>{finishWrite=resolve;});
    }
  });
  openEditorTransactionSession();
  const pending=adapter.authClient.schema('silver').managedTransaction([{
    p_table:'silver.lo3rwang_lucus',p_operation:'update',p_values:{title:'x'},
    p_filters:[{column:'uid',operator:'eq',value:'AAAAAAAA'}]
  }]);
  assert.equal(calls,1);
  cancelEditorTransactionSession();
  assert.equal(typeof finishWrite,'function');
  // The Server Action request cannot receive the browser AbortSignal. Let its
  // response settle, then verify the caller is told to reread before retrying.
  finishWrite({data:{results:[],count:0},error:null});
  await assert.rejects(pending,error=>error.code==='LOC_EDITOR_CANCELLED'&&
    /結果須重新讀取確認/.test(error.message));
  await assert.rejects(
    adapter.authClient.schema('silver').managedWrite({
      p_table:'silver.lo3rwang_lucus',p_operation:'insert',
      p_rows:[{uid:'BBBBBBBB'}]
    }),{code:'LOC_EDITOR_CANCELLED'});
  assert.equal(calls,1,'Cancel must never send queued/retried editor writes');
});

test('canceled Keyword Server Actions skip confirmation reads and HTTP retries',()=>{
  const source=readFileSync(new URL('../app/loc/keywords/service-client.mjs',import.meta.url),'utf8');
  const cancellation=source.indexOf('if(isEditorTransactionCancelled(lease))assertEditorTransactionLease(lease);');
  const receipt=source.indexOf('const receipt=await queryKeywordAnalysisCompletion',cancellation);
  assert.ok(cancellation>=0);
  assert.ok(receipt>cancellation,'cancellation guard must run before the receipt read');
  assert.doesNotMatch(source,/fetch\s*\(/);
});

}

{

}

{
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Cancel remains a discard-only action; Save is the only write action',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const discard=dock.split('const discard=useCallback(')[1]?.split('const switchTo=useCallback(')[0];
  assert.ok(discard);
  assert.doesNotMatch(discard,/transactionWrites|managedTransaction|\.save\(|commit\(/);
  const save=dock.split('const save=useCallback(')[1]?.split('const discard=useCallback(')[0];
  assert.ok(save);
  assert.match(save,/transactionWrites/);
});
}

test('section change revokes old lease and disposers without starting a public editor',()=>{
  cancelEditorTransactionSession();
  assert.equal(rotateActiveEditorTransactionSession(),false);
  openEditorTransactionSession();
  const previous=editorTransactionLease();
  let disposed=0;
  registerEditorTransactionDisposer(()=>disposed++);
  assert.equal(rotateActiveEditorTransactionSession(),true);
  assert.equal(previous.signal.aborted,true);
  assert.equal(disposed,1);
  assert.throws(()=>assertEditorTransactionLease(previous),{code:'LOC_EDITOR_CANCELLED'});
  assert.doesNotThrow(()=>assertEditorTransactionLease(editorTransactionLease()));
  cancelEditorTransactionSession();
});

test('parallel management switches keep editor mode and do not erase shared form registration',()=>{
  const source=readFileSync(new URL('../app/modular/edit-dock.jsx',import.meta.url),'utf8');
  const section=source.split('const switchSection=useCallback(')[1]?.split('const value=useMemo(')[0];
  assert.ok(section);
  assert.match(section,/cancelEditorTransactionSession\(\)/);
  assert.match(section,/openEditorTransactionSession\(\)/);
  assert.doesNotMatch(section,/clearEditor\(\)|\bend\(\)|\.save\(/);
  const nav=readFileSync(new URL('../app/modular/ManagementSectionNav.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(nav,/prepareTransientResourceAction\('management'\)/);
  assert.match(nav,/dockRef\.current\.switchSection\(next,commit\)/);
});
