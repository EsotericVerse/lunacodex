'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {parseGalaxyFeatureQuery,executeGalaxyFeatureQuery}
  from '../../model/galaxy-feature-queries.mjs';
import {parseGalaxyRecordQuery,executeGalaxyRecordQuery}
  from '../../model/galaxy-record-queries.mjs';
import {SCOPE_ROUTE_INDEX} from '../../../modular/routing/scope-route-index.js';
import {scopeFeatureEnabled} from '../../scope/scope-config-fields.mjs';

const publishedScopes=new Map(SCOPE_ROUTE_INDEX.filter(row=>row.active!==false)
  .map(row=>[row.scope_id,row.config]));
const featureFlag={culture:'culture_able',statics:'statistics_able',
  search:'search',trace:'trace'};

const featureAuthorization=operation=>({scope:operation.scope,
  writeScopes:operation.mode==='editor'?[operation.scope]:[]});
async function withFeatureConnection(operation,work,{publicRead=false}={}){
  const scope=operation.scope;
  if(publicRead)return withPublicLocRead({scope},async(db,port)=>work(db,port));
  if(scope==='loc')return withAuthorizedLocRead({global:true},
    async(db,port)=>work(db,port));
  return withAuthorizedLocRead(featureAuthorization(operation),async(db,port)=>work(db,port));
}

export async function queryGalaxyFeature(body){
  const operation=parseGalaxyFeatureQuery(body);
  const flag=featureFlag[operation.feature];
  if(flag&&operation.scope!=='loc'&&
    !scopeFeatureEnabled(publishedScopes.get(operation.scope),flag))
    throw Object.assign(Error('Galaxy feature is not published'),{httpStatus:404});
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyFeatureQuery(db,operation),
    query:{requestedBy:operation.feature,scope:operation.scope,result:operation.result}
  }),{publicRead:true});
}
export async function queryGalaxyRecords(body){
  const operation=parseGalaxyRecordQuery(body);
  return withFeatureConnection(operation,async(db)=>({
    data:await executeGalaxyRecordQuery(db,operation),
    query:{requestedBy:'galaxy',scope:operation.scope,
      model:'galaxy-records',view:operation.view}
  }),{publicRead:operation.mode==='public'});
}
