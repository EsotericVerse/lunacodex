import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {openEditorTransactionSession,editorTransactionLease,
  assertEditorTransactionLease,registerEditorTransactionDisposer,
  cancelEditorTransactionSession} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {keywordService} from '../app/loc/keywords/service-client.mjs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

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

test('Cancel aborts protected HTTP writes and denies queued continuation',async()=>{
  let calls=0,signal;
  const mockFetch=(_url,options)=>{
    calls++;signal=options.signal;
    return new Promise((_resolve,reject)=>{
      if(signal.aborted)return reject(Object.assign(new Error('abort'),{name:'AbortError'}));
      signal.addEventListener('abort',()=>reject(
        Object.assign(new Error('abort'),{name:'AbortError'})),{once:true});
    });
  };
  const adapter=createConfiguredAdapter({
    accountAdapter:{auth:{}},fetchImpl:mockFetch
  });
  openEditorTransactionSession();
  const pending=adapter.authClient.schema('silver').managedTransaction([{
    p_table:'silver.lo3rwang_anchor',p_operation:'update',p_values:{title:'x'},
    p_filters:[{column:'uid',operator:'eq',value:'AAAAAAAA'}]
  }]);
  assert.equal(calls,1);
  cancelEditorTransactionSession();
  assert.equal(signal.aborted,true);
  await assert.rejects(pending,{code:'LOC_EDITOR_CANCELLED'});
  await assert.rejects(
    adapter.authClient.schema('silver').managedWrite({
      p_table:'silver.lo3rwang_anchor',p_operation:'insert',
      p_rows:[{uid:'BBBBBBBB'}]
    }),{code:'LOC_EDITOR_CANCELLED'});
  assert.equal(calls,1,'Cancel must never send queued/retried editor writes');
});

test('Canceled keyword streams never issue a follow-up confirmation request',async()=>{
  let fetchCount=0;
  const previous=globalThis.fetch;
  globalThis.fetch=(_url,{signal})=>{
    fetchCount++;
    return new Promise((_resolve,reject)=>{
      if(signal?.aborted)return reject(Object.assign(new Error('cancel'),{name:'AbortError'}));
      signal?.addEventListener('abort',()=>reject(
        Object.assign(new Error('cancel'),{name:'AbortError'})),{once:true});
    });
  };
  try{
    openEditorTransactionSession();
    const pending=keywordService('analyze',{scopeId:'lo3rwang',classUid:'AAAAAAAA'},{
      onProgress:()=>{}
    });
    assert.equal(fetchCount,1);
    cancelEditorTransactionSession();
    await assert.rejects(pending,{code:'LOC_EDITOR_CANCELLED'});
    assert.equal(fetchCount,1);
  }finally{
    cancelEditorTransactionSession();
    globalThis.fetch=previous;
  }
});

test('Editor Cancel drops transient read/retry references without clearing Auth',()=>{
  const dock=source('app/modular/edit-dock.jsx');
  const resources=source('packages/zenstack/client-queries.js');
  const contract=source('app/loc/db/db-contract.mjs');
  const keywords=source('app/loc/keywords/service-client.mjs');
  assert.match(dock,/cancelEditorTransactionSession\(\)/);
  assert.match(dock,/releaseTransientPageResources\(\{discardEditor:true\}\)/);
  assert.match(dock,/invalidateScopedReadCache\(\)/);
  assert.match(dock,/invalidateCachedReadPrefix\('scope-aggregate:'\)/);
  assert.doesNotMatch(dock.slice(dock.indexOf('const discard='),dock.indexOf('const switchTo=')),
    /clearEditorSession|clearAuthorization|transactionWrites/);
  assert.match(resources,/if\(discardEditor\)\{/);
  assert.match(resources,/if\(!discardEditor&&retryBootstrap\.size\)queueMicrotask/);
  assert.match(resources,/if\(finishingEpoch!==resourceEpoch\)return/);
  assert.match(contract,/assertEditorTransactionLease\(lease\)/);
  assert.match(keywords,/assertEditorTransactionLease\(lease\)/);
  assert.match(source('app/loc/mcp/native-operations.mjs'),
    /bindLocRequestAbort\(selected,request\.signal\)/);
});
