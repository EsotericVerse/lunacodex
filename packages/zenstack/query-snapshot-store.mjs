// A tiny, bounded-by-subscribers external snapshot store for *public* page reads.
// No TTL, polling, browser storage, SQL permissions, or background revalidation.
// The caller must release data when the final reader unmounts.
const EMPTY=Object.freeze({hasData:false,data:undefined});
export function createQuerySnapshotStore(){
  const snapshots=new Map();
  const listeners=new Map();
  const emit=key=>{for(const listener of listeners.get(key)||[])listener();};
  return {
    getSnapshot:key=>snapshots.get(key)||EMPTY,
    subscribe:(key,listener)=>{
      let entries=listeners.get(key);
      if(!entries){entries=new Set();listeners.set(key,entries);}
      entries.add(listener);
      return()=>{
        entries.delete(listener);
        if(!entries.size)listeners.delete(key);
      };
    },
    publish:(key,data)=>{
      // A stable immutable snapshot is required by React useSyncExternalStore.
      snapshots.set(key,{hasData:true,data});
      emit(key);
    },
    release:key=>{
      if(!snapshots.delete(key))return;
      emit(key);
    },
    clear:()=>{for(const key of snapshots.keys()){
      snapshots.delete(key);emit(key);
    }},
    size:()=>snapshots.size
  };
}
