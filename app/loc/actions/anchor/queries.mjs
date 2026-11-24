'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {parseAnchorFeatureQuery,executeAnchorFeatureQuery}
  from '../../model/anchor-feature-queries.mjs';

export async function queryAnchorFeature(body){
  const operation=parseAnchorFeatureQuery(body);
  const scope=operation.scope;
  const access=scope==='loc'?{global:true}:{scope,
    writeScopes:operation.mode==='editor'?[scope]:[]};
  return withAuthorizedLocRead(access,async db=>({
    data:await executeAnchorFeatureQuery(db,operation),
    query:{requestedBy:'anchor',scope,model:'anchor-feature',
      view:operation.view||operation.family,mode:operation.mode}
  }));
}
