// Import progress is one synchronous external snapshot per mounted import UI.
// No cross-Scope shared data, no polling, no SQL, and no read-through cache.
export function createImportProgressStore(){
  let snapshot=null;
  const listeners=new Set();
  const getSnapshot=()=>snapshot;
  const getServerSnapshot=()=>null;
  const subscribe=listener=>{
    listeners.add(listener);
    return ()=>listeners.delete(listener);
  };
  const set=next=>{
    const value=typeof next==='function'?next(snapshot):next;
    if(Object.is(value,snapshot))return snapshot;
    snapshot=value;
    for(const listener of listeners)listener();
    return snapshot;
  };
  return Object.freeze({subscribe,getSnapshot,getServerSnapshot,set});
}
