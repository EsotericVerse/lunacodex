// Browser read lifecycle. One epoch covers query transport and bounded SQL
// read-queue waiters. Identity, permissions, and explicit database WRITES are
// deliberately outside this abort controller.
let controller=null;
let generation=0;
function current(){return controller||(controller=new AbortController());}
export function transientReadSignal(signal=null){
  const page=current().signal;
  return signal?AbortSignal.any([signal,page]):page;
}
export function transientReadGeneration(){return generation;}
export function cancelTransientReads(){
  const previous=controller;
  controller=new AbortController();
  generation++;
  previous?.abort();
}
