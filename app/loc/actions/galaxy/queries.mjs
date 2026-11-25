'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {emptyGalaxyFeature} from '../../runtime/r2-runtime.mjs';
import {parseGalaxyFeatureQuery,executeGalaxyFeatureQuery}
  from '../../model/galaxy-feature-queries.mjs';
import {parseGalaxyRecordQuery,executeGalaxyRecordQuery}
  from '../../model/galaxy-record-queries.mjs';
import {requirePublicFeature} from '../../permissions/public-feature-policy.mjs';
const featureFlag={culture:'culture_able',statics:'statistics_able',
  search:'search',trace:'trace',keyword:'statistics_able'};

const featureAuthorization=operation=>({scope:operation.scope,
  writeScopes:operation.mode==='editor'?[operation.scope]:[]});
async function withFeatureConnection(operation,work,{publicRead=false,onMissingGalaxy=null}={}){
  const scope=operation.scope;
  if(publicRead)return withPublicLocRead({scope,onMissingGalaxy},async(db,port)=>work(db,port));
  if(scope==='loc')return withAuthorizedLocRead({global:true},
    async(db,port)=>work(db,port));
  return withAuthorizedLocRead(featureAuthorization(operation),async(db,port)=>work(db,port));
}

export async function queryGalaxyFeature(body){
  const operation=parseGalaxyFeatureQuery(body);
  const flag=featureFlag[operation.feature];
  if(flag&&operation.scope!=='loc')requirePublicFeature(operation.scope,flag);
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyFeatureQuery(db,operation),
    query:{requestedBy:operation.feature,scope:operation.scope,result:operation.result}
  }),{publicRead:true,onMissingGalaxy:()=>({data:emptyGalaxyFeature(operation),
    query:{requestedBy:operation.feature,scope:operation.scope,result:operation.result}})});
}
export async function queryGalaxyRecords(body){
  const operation=parseGalaxyRecordQuery(body);
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyRecordQuery(db,operation),
    query:{requestedBy:'galaxy',scope:operation.scope,
      model:'galaxy-records',view:operation.view}
  }),{publicRead:operation.mode==='public',onMissingGalaxy:()=>({data:{rows:[]},
    query:{requestedBy:'galaxy',scope:operation.scope,model:'galaxy-records',view:operation.view}})});
}
