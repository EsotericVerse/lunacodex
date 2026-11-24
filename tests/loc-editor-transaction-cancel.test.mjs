import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {openEditorTransactionSession} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {editorTransactionLease} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {assertEditorTransactionLease} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {registerEditorTransactionDisposer} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {cancelEditorTransactionSession} from '../app/loc/db/editor-transaction-lifecycle.mjs';
import {keywordService} from '../app/loc/keywords/service-client.mjs';
import {touchEditorSession} from '../app/loc/auth/edit-session-ttl.mjs';
import {editorSessionStatus} from '../app/loc/auth/edit-session-ttl.mjs';
import {saveEditorManagement} from '../app/loc/auth/edit-session-ttl.mjs';
import {readEditorManagement} from '../app/loc/auth/edit-session-ttl.mjs';
import {clearEditorManagement} from '../app/loc/auth/edit-session-ttl.mjs';
import {clearEditorSession} from '../app/loc/auth/edit-session-ttl.mjs';

{
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
}

{
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('BlockNote abandons asynchronous HTML work and releases its ProseMirror editor on exit',()=>{
  const editor=source('app/loc/editor/BlockNoteEditorClient.jsx');
  assert.match(editor,/mountedRef\.current=false/);
  assert.match(editor,/htmlEmitVersion\.current\+\+/);
  assert.match(editor,/epoch===editorEpoch\.current/);
  assert.match(editor,/tiptap\.destroy\?\.\(\)/);
  const drafts=source('app/loc/blocks/ScopeBlockDraftList.jsx');
  assert.doesNotMatch(drafts,/localStorage|sessionStorage|indexedDB/);
});



test('homepage six-key hard navigation does not clear live page or editor Session',()=>{
  const dock=source('app/modular/edit-dock.jsx');
  const resources=source('packages/zenstack/client-queries.js');
  // Hard navigation unloads its document naturally. An eager global flush
  // erases the live homepage if the next HTML entrypoint is slow to load.
  assert.match(dock,/const documentExit=url\.origin/);
  assert.match(dock,/if\(documentExit\)\{\s*window\.location\.assign\(url\.href\)/);
  assert.match(dock,/window\.location\.replace\(destination\.href\)/);
  const navigate=dock.slice(dock.indexOf('const navigate='),dock.indexOf('const complete='));
  assert.doesNotMatch(navigate,/releaseTransientPageResources\(|transactionWrites\(|clearEditorSession\(/);
  const discard=dock.slice(dock.indexOf('const discard='),dock.indexOf('const switchTo='));
  // Explicit Cancel is DIFFERENT from ordinary hard navigation: the user
  // asked to terminate every pending edit request and release all drafts.
  assert.match(discard,/releaseTransientPageResources\(\{discardEditor:true\}\)/);
  assert.doesNotMatch(discard,/transactionWrites\(|clearEditorSession\(/);
  assert.match(resources,/export function releaseTransientPageResources\(\{discardEditor=false\}=\{\}\)/);
  assert.match(resources,/cancelTransientReads\(\);\s*abortInflight\(\);/);
  assert.match(resources,/if\(!discardEditor&&retryBootstrap\.size\)queueMicrotask/,
    'Ordinary SPA navigation may revive observed Bootstrap; Cancel must not');
});

test('transient management verification failure removes grants but preserves the session clock',()=>{
  const values=new Map(),storage={
    getItem:key=>values.get(key)||null,
    setItem:(key,val)=>values.set(key,val),
    removeItem:key=>values.delete(key)
  };
  const now=1700000000000;
  assert.equal(touchEditorSession(storage,now),true);
  assert.equal(saveEditorManagement(storage,{user:{id:'user',email:'user@example.org'},
    roles:[],grants:[]},now+500),true);
  const before=editorSessionStatus(storage,now+1000);
  assert.ok(readEditorManagement(storage,now+1000));
  clearEditorManagement(storage);
  assert.deepEqual(editorSessionStatus(storage,now+1000),before);
  assert.equal(readEditorManagement(storage,now+1000),null);
  assert.equal(touchEditorSession(storage,now+1000),true);
  const account=source('app/loc/auth/use-account.js');
  assert.match(account,/clearEditorManagement\(window\.sessionStorage\)/);
  assert.match(account,/if\(error\?\.status===401\)\{\s*if\(typeof window!==['"]undefined['"]\)clearEditorSession/);
  clearEditorSession(storage);
  assert.equal(storage.getItem('loc-editor-session-v1'),null);
});
}

{
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');



test('Cancel remains a discard-only action; Save is the only write action',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const discard=dock.split('const discard=useCallback(')[1]?.split('const switchTo=useCallback(')[0];
  assert.ok(discard);
  assert.doesNotMatch(discard,/transactionWrites|managedTransaction|\.save\(|commit\(/);
  assert.match(discard,/window\.location\.replace\(destination\.href\)/);
  const save=dock.split('const save=useCallback(')[1]?.split('const discard=useCallback(')[0];
  assert.ok(save);
  assert.match(save,/transactionWrites/);
});
}
