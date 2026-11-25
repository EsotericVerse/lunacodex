'use server';
import {requirePublicFeature} from '../../permissions/public-feature-policy.mjs';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {emptyAnchorFeature} from '../../runtime/r2-runtime.mjs';
import {parseAnchorFeatureQuery,executeAnchorFeatureQuery}
  from '../../model/anchor-feature-queries.mjs';

export async function queryAnchorFeature(body){
  const operation=parseAnchorFeatureQuery(body);
  const scope=operation.scope;
  const read=async(db,port)=>({
    data:await executeAnchorFeatureQuery(db,operation),
    query:{requestedBy:'anchor',scope,model:'anchor-feature',
      view:operation.view||operation.family,mode:operation.mode}
  });
  // Public SiteAnchor taxonomy reads the fixed ZModel projection without
  // requiring a website session. Keep editor reads behind LOC permissions.
  if(operation.mode==='public'){
    if(operation.family==='time')requirePublicFeature(scope,'culture_able');
    if(operation.family==='space')requirePublicFeature(scope,'trace');
    return withPublicLocRead({scope,onUnavailable:operation.family==='source'?async()=>({
      data:await emptyAnchorFeature(operation),query:{requestedBy:'anchor',scope,
        model:'anchor-feature',view:operation.view||operation.family,mode:operation.mode}
    }):null},read);
  }
  const access=scope==='loc'?{global:true}:{scope,
    writeScopes:operation.mode==='editor'?[scope]:[]};
  return withAuthorizedLocRead(access,read);
}
