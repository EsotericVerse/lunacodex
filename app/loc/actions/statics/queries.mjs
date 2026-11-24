'use server';
import {handleNamedPublicTransaction} from '../../server/public-named-transactions.mjs';
import {handleNativePublicContent} from '../../server/native-public-content.mjs';
import {invokeHandler} from '../request.mjs';

export async function queryStatics(args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/statics/query',body:{
    kind:'transaction',operation:'analytics',args
  },options:{allowedOperations:['analytics'],allowedAnalyticsViews:[
    'shared_classes','keyword_catalog','keyword_summary']}});
}
export async function queryStaticsContent(params){
  return invokeHandler(handleNativePublicContent,{path:'/statics/content?'+params,
    method:'GET',options:{allowedKinds:['daily','daily_total','overview','earliest','totals','loc']}});
}
