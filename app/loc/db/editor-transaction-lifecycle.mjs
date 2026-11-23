// One browser editor work generation. Cancel owns its network transport,
// deferred continuations, UI retries, and disposable references -- never the
// signed identity/session, or a server COMMIT that has already succeeded.
let generation=0;
let controller=null;
let closed=false;
const disposers=new Set();
const cancelled=()=>{
  const error=new Error('編輯已取消，原工作階段不得繼續傳送。');
  error.code='LOC_EDITOR_CANCELLED';
  error.name='AbortError';
  return error;
};
const stopped=new AbortController();
stopped.abort();
export function openEditorTransactionSession(){
  if(controller&&!controller.signal.aborted)return generation;
  generation++;
  closed=false;
  controller=new AbortController();
  return generation;
}
export function editorTransactionLease(){
  if(controller)return {generation,signal:controller.signal};
  return closed?{generation,signal:stopped.signal}:null;
}
export function assertEditorTransactionLease(lease){
  if(lease&&(lease.generation!==generation||lease.signal.aborted))
    throw cancelled();
}
export function isEditorTransactionCancelled(lease){
  return Boolean(lease&&(lease.generation!==generation||lease.signal.aborted));
}
// Independent retry queues can add their explicit cleanup hooks. A queued
// callback must also check its captured lease before touching a new session.
export function registerEditorTransactionDisposer(dispose){
  if(typeof dispose!=='function')return ()=>{};
  if(closed){dispose();return ()=>{};}
  disposers.add(dispose);
  return ()=>disposers.delete(dispose);
}
export function cancelEditorTransactionSession(){
  generation++;
  closed=true;
  const previous=controller;
  controller=null;
  // Abort first: server-owned request-scoped transactions receive disconnect,
  // and client stream readers/queued operations stop before disposers run.
  previous?.abort();
  for(const dispose of disposers){
    try{dispose();}
    catch{/* Cancellation must not be blocked by a failed cleanup hook. */}
  }
  disposers.clear();
}
