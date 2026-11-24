'use server';
import {handleNamedPublicTransaction} from '../../server/public-named-transactions.mjs';
import {handleNativePublicContent} from '../../server/native-public-content.mjs';
import {handleTimeAnchorQuery} from '../..//culture/time-anchor-query-server.mjs';
import {invokeHandler} from '../request.mjs';

export async function queryCulture(args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/culture/query',body:{
    kind:'transaction',operation:'analytics',args
  },options:{allowedOperations:['analytics'],allowedAnalyticsViews:['culture_list']}});
}
export async function queryCultureContent(params){
  return invokeHandler(handleNativePublicContent,{path:'/culture/content?'+params,
    method:'GET',options:{allowedKinds:['culture_anchors','culture_density']}});
}
export async function queryTimeAnchors(body){
  return invokeHandler(handleTimeAnchorQuery,{path:'/culture/anchors',body});
}
