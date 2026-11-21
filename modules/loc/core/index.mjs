import {html,mountHTML,renderHTML} from './html.mjs';
import {defineModel,validateRecord} from './model.mjs';
import {createComponentSystem} from './components.mjs';
import {createExtensionSystem} from './extensions.mjs';
import {createRouter} from './router.mjs';
import {createDataSystem} from './data.mjs';
export {html,mountHTML,renderHTML,defineModel,validateRecord};
export {createComponentSystem,createExtensionSystem,createRouter,createDataSystem};
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
