import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createQuerySnapshotStore} from '../packages/zenstack/query-snapshot-store.mjs';

const source=readFileSync(new URL('../packages/zenstack/client-queries.js',import.meta.url),'utf8')
  .replace(/^import [^\n]*\n/gm,'')
  .replace(/\bexport\s+(?=(?:const|function|class))/g,'');

// Test the real query lifecycle functions without mounting a DOM or touching
// Auth, SQL, or an external database. React hooks are not called in these tests.
function runtime(){
  let cancelled=0,notifications=0;
  const jobs=[];
  const build=new Function(
    'createQuerySnapshotStore','cancelTransientReads','flashMessage',
    'useCallback','useEffect','useMemo','useRef','useState','useSyncExternalStore',
    'queueMicrotask',
    source+'\nreturn {register,serialize,retainIfObserved,releaseTransientPageResources,bootstrapSnapshots,dataStore};'
  );
  const instance=build(createQuerySnapshotStore,
    ()=>{cancelled++;},()=>{},
    ()=>{throw Error('hook must not be called in lifecycle unit test');},
    ()=>{},()=>{},()=>{},()=>{},()=>{},
    callback=>jobs.push(callback));
  return {...instance,jobs,flush:()=>{for(const task of jobs.splice(0))task();},
    cancelled:()=>cancelled,notifications:()=>notifications};
}

test('navigation preserves live public bootstrap without copying it into a persistent cache',()=>{
  const x=runtime(),key=['app-bootstrap','loc','index'];
  const serialized=x.serialize(key);
  const stop=x.register({key,refetch:()=>{}});
  const value={blocks:[{uid:'example'}]};
  x.retainIfObserved(serialized,value);
  const before=x.bootstrapSnapshots.getSnapshot(serialized);
  assert.equal(before.data,value);
  x.releaseTransientPageResources();
  assert.equal(x.bootstrapSnapshots.getSnapshot(serialized),before,
    'navigating while AppShell is mounted must not refetch the same Hero');
  stop();
  assert.equal(x.bootstrapSnapshots.getSnapshot(serialized).hasData,false);
  assert.equal(x.dataStore.has(serialized),false);
});

test('private SQL results are freed while session and grants stay independent',()=>{
  const x=runtime();
  const session=x.serialize(['loc-account','session']);
  const grants=x.serialize(['loc-account','management']);
  const privateKey=['galaxy','protected',42],privateSerialized=x.serialize(privateKey);
  const stop=x.register({key:privateKey,refetch:()=>{}});
  x.retainIfObserved(session,{id:'x'});
  x.retainIfObserved(grants,{authorized:true});
  x.retainIfObserved(privateSerialized,{secret:'not cached'});
  x.releaseTransientPageResources();
  assert.equal(x.dataStore.has(session),true);
  assert.equal(x.dataStore.has(grants),true);
  assert.equal(x.dataStore.has(privateSerialized),false);
  assert.equal(x.bootstrapSnapshots.size(),0);
  stop();
});

test('a pending public bootstrap retries only if a mounted reader still needs it',()=>{
  const x=runtime(),key=['app-bootstrap','loc','index'];
  let reads=0;
  const unsubscribe=x.register({key,refetch:()=>{reads++;}});
  x.releaseTransientPageResources();
  x.flush();
  assert.equal(reads,1);
  unsubscribe();
  x.releaseTransientPageResources();
  x.flush();
  assert.equal(reads,1);
});

test('a superseded public bootstrap must not retry after its reader unmounts',()=>{
  const x=runtime(),key=['app-bootstrap','loc','index'];
  let reads=0;
  const stop=x.register({key,refetch:()=>{reads++;}});
  x.releaseTransientPageResources();
  stop();
  x.flush();
  assert.equal(reads,0);
});
