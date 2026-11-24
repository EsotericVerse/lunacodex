'use server';
import {handleNamedPublicTransaction} from '../../server/public-named-transactions.mjs';
import {invokeHandler} from '../request.mjs';

export async function queryTrace(args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/trace/query',body:{
    kind:'transaction',operation:'analytics',args
  },options:{allowedOperations:['analytics'],allowedAnalyticsViews:[
    'trace_places','trace_territory','trace_daily','lane_daily','trace_keywords']}});
}
export async function traceAction(name,args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/trace/action',body:{
    kind:'transaction',operation:'action',name,args
  },options:{allowedOperations:['action'],allowedActions:['search_scope_trace_place_names']}});
}
