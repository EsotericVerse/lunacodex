import {mountHTML,renderHTML} from './html.mjs';

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
