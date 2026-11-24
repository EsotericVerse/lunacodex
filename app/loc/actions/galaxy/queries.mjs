'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {parseGalaxyFeatureQuery,executeGalaxyFeatureQuery}
  from '../../model/galaxy-feature-queries.mjs';
import {parseGalaxyRecordQuery,executeGalaxyRecordQuery}
  from '../../model/galaxy-record-queries.mjs';

const featureAuthorization=operation=>({scope:operation.scope,
  writeScopes:operation.mode==='editor'?[operation.scope]:[]});
async function withFeatureConnection(operation,work){
  const scope=operation.scope;
  if(scope==='loc'){
    return withAuthorizedLocRead({global:true},async(db,port)=>work(db,port));
  }
  return withAuthorizedLocRead(featureAuthorization(operation),
    async(db,port)=>work(db,port));
}

export async function queryGalaxyFeature(body){
  const operation=parseGalaxyFeatureQuery(body);
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyFeatureQuery(db,operation),
    query:{requestedBy:operation.feature,scope:operation.scope,result:operation.result}
  }));
}
export async function queryGalaxyRecords(body){
  const operation=parseGalaxyRecordQuery(body);
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyRecordQuery(db,operation),
    query:{requestedBy:'galaxy',scope:operation.scope,
      model:'galaxy-records',view:operation.view}
  }));
}
