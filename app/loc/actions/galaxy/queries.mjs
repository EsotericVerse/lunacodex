'use server';
import {handleGalaxyFeatureQuery} from '../../galaxy/feature-query-server.mjs';
import {handleQuery as handleRecordsQuery} from '../../galaxy/records-query-server.mjs';
import {handleQuery as handleAnchorQuery} from '../../anchor/feature-query-server.mjs';
import {invokeHandler} from '../request.mjs';

export async function queryGalaxyFeature(body){
  return invokeHandler(handleGalaxyFeatureQuery,{path:'/galaxy/feature',body});
}
export async function queryGalaxyRecords(body){
  return invokeHandler(handleRecordsQuery,{path:'/galaxy/records',body});
}
export async function queryAnchorFeature(body){
  return invokeHandler(handleAnchorQuery,{path:'/anchor/feature',body});
}
