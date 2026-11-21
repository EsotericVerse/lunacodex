// Providers such as charts, timelines, maps and editors only load when used.
export function createExtensionSystem(){
  const providers=new Map(),active=new Map();
  const load=async capability=>{
    const entry=providers.get(capability);
    if(!entry)throw new Error('Unregistered LOC capability: '+capability);
    if(!entry.promise){
      entry.promise=Promise.resolve().then(entry.loader).then(provider=>{
        if(!provider||typeof provider.mount!=='function')
          throw new TypeError('LOC capability provider requires mount()');
        return provider;
      }).catch(error=>{entry.promise=null;throw error;});
    }
    return entry.promise;
  };
  const unmount=async element=>{
    const handle=active.get(element);
    if(!handle||handle.disposed)return;
    handle.disposed=true;
    active.delete(element);
    await handle.cleanup();
  };
  return Object.freeze({
    register(capability,loader){
      if(typeof capability!=='string'||!/^[a-z][a-z0-9-]*$/i.test(capability))
        throw new TypeError('Invalid LOC extension capability');
      if(typeof loader!=='function')throw new TypeError('LOC extension requires a loader');
      if(providers.has(capability))throw new Error('Duplicate LOC capability: '+capability);
      providers.set(capability,{loader,promise:null});
    },
    load,
    async mount(capability,element,options={},context={}){
      if(!element)throw new TypeError('LOC extension requires a target element');
      if(active.has(element))throw new Error('LOC extension target is already mounted');
      const provider=await load(capability);
      if(active.has(element))throw new Error('LOC extension target is already mounted');
      const cleanup=await provider.mount(element,options,context);
      if(cleanup!=null&&typeof cleanup!=='function')
        throw new TypeError('LOC extension mount() must return a cleanup function');
      const handle={cleanup:cleanup||(()=>{}),disposed:false};
      active.set(element,handle);
      return ()=>unmount(element);
    },
    unmount,
    capabilities(){return [...providers.keys()];}
  });
}
