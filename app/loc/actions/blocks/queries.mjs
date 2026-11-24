'use server';
import {handleNamedPublicTransaction} from '../../server/public-named-transactions.mjs';
import {handleNativePublicContent} from '../../server/native-public-content.mjs';
import {invokeHandler} from '../request.mjs';

export async function queryBlocks(name,args){
  return invokeHandler(handleNamedPublicTransaction,{path:'/blocks/action',body:{
    kind:'transaction',operation:'action',name,args
  },options:{allowedOperations:['action'],allowedActions:['block_list','hero_block']}});
}

export async function queryBlockContent(params){
  return invokeHandler(handleNativePublicContent,{path:'/blocks/content?'+params,
    method:'GET',options:{allowedKinds:['config','block_list','hero_block']}});
}
