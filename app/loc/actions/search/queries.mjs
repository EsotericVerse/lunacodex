'use server';
import {handleNamedPublicTransaction} from '../../server/public-named-transactions.mjs';
import {invokeHandler} from '../request.mjs';

export async function querySearch(args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/search/query',body:{
    kind:'transaction',operation:'analytics',args
  },options:{allowedOperations:['analytics'],allowedAnalyticsViews:['search_summary']}});
}
