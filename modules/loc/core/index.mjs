import {html,mountHTML,renderHTML} from './html.mjs';
import {defineModel,validateRecord} from './model.mjs';
import {createRouter} from './router.mjs';
import {createDataSystem} from './data.mjs';
export {html,mountHTML,renderHTML,defineModel,validateRecord};
export {createRouter,createDataSystem};
export * from './sql.mjs';

// LOC is the framework; libraries and database drivers are optional providers.
export function createLOC({data}={}){
  return Object.freeze({
    html,renderHTML,mountHTML,
    components:createComponentSystem(),
    extensions:createExtensionSystem(),
    routes:createRouter(),
    ...(data?{data:createDataSystem(data)}:{})
  });
}

// Components return LOC HTML nodes. No JSX, virtual DOM or framework lifecycle.
export function createComponentSystem(){
  const registry=new Map();
  const requireComponent=name=>{
    const factory=registry.get(name);
    if(!factory)throw new Error('Unknown LOC component: '+name);
    return factory;
  };
  return Object.freeze({
    register(name,factory){
      if(typeof name!=='string'||!/^[a-z][a-z0-9-]*$/i.test(name))
        throw new TypeError('Invalid LOC component name');
      if(typeof factory!=='function')throw new TypeError('LOC component requires a factory');
      if(registry.has(name))throw new Error('Duplicate LOC component: '+name);
      registry.set(name,factory);
    },
    create(name,props={},context={}){return requireComponent(name)(props,context);},
    html(name,props={},context={}){return renderHTML(requireComponent(name)(props,context));},
    mount(root,name,props={},context={}){return mountHTML(root,requireComponent(name)(props,context));},
    names(){return [...registry.keys()];}
  });
}

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
