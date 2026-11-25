'use server';
import {withPublicLocRead} from '../read-context.mjs';
import {searchSummary} from '../../providers/kysely-analytics.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';

const published=new Set(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false&&
  row.scope_id!=='loc'&&row.scope_id!=='admin').map(row=>row.scope_id));

export async function querySearch(args={}){
  const options=args.p_options??{};
  if(args.p_scope_id!=='loc'||args.p_view!=='search_summary'||
    args.p_start!=null&&args.p_start!==''||args.p_end!=null&&args.p_end!==''||
    !options||typeof options!=='object'||Array.isArray(options)||
    Object.keys(options).some(key=>key!=='scopeIds'))
    throw Error('Invalid Search summary request');
  const requested=options.scopeIds;
  if(!Array.isArray(requested)||requested.length>100||
    requested.some(scope=>typeof scope!=='string'||!published.has(scope)))
    throw Error('Invalid Search Scope list');
  const scopeIds=[...new Set(requested)];
  if(!scopeIds.length)return {data:{rows:[]},count:null};
  return withPublicLocRead({scopes:scopeIds},async(db,port)=>({
    data:await searchSummary(db,{scopeIds},{publishedScopeIds:scopeIds,
      engine:port.engine,namespace:port.namespace}),count:null
  }));
}
