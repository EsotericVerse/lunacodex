import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';
const names=Object.freeze({culture_able:'culture',statistics_able:'statics',search:'search',trace:'trace'});
export function explicitFeatureEnabled(config,flag){
  if(!Object.hasOwn(names,flag)||!config)return false;
  const name=names[flag],fields=[config[name],config[flag],flag==='search'?config.search_able:undefined,config.able?.[name]];
  if(fields.some(v=>v===false||v===0))return false;
  return fields.some(v=>v===true||v===1);
}
export function publishedScopeAllowed(scope){
  if(typeof scope!=='string'||scope==='admin')return false;
  const route=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scope&&row.active===true);
  const registry=PUBLISHED_SITE_BOOTSTRAP.registry.find(row=>row.scope_id===scope&&row.active===true);
  return Boolean(route&&registry&&route.config?.id===scope&&
    route.domain===registry.domain&&route.directory===registry.directory&&
    ['group','scope'].includes(registry.scope_kind));
}
export function publicFeatureAllowed(scope,flag){
  if(!publishedScopeAllowed(scope))return false;
  const route=SCOPE_ROUTE_INDEX.find(row=>row.scope_id===scope);
  return explicitFeatureEnabled(route.config,flag);
}
export function requirePublicFeature(scope,flag){
  if(!publicFeatureAllowed(scope,flag))throw Object.assign(
    Error('LOC feature is not published'),{httpStatus:404});
}
