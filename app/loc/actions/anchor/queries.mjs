'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {parseAnchorFeatureQuery,executeAnchorFeatureQuery}
  from '../../model/anchor-feature-queries.mjs';
import {queryPublishedSourceAnchors} from '../../source/catalog-public.mjs';

export async function queryAnchorFeature(body){
  const operation=parseAnchorFeatureQuery(body);
  const scope=operation.scope;
  if(operation.family==='source'){
    const data=await queryPublishedSourceAnchors(operation);
    return {data,query:{requestedBy:'anchor',scope,model:'anchor-feature',
      view:operation.family,mode:'published-asset'}};
  }
  const read=async(db,port)=>({
    data:await executeAnchorFeatureQuery(db,operation),
    query:{requestedBy:'anchor',scope,model:'anchor-feature',
      view:operation.view||operation.family,mode:operation.mode}
  });
  // Public SiteAnchor taxonomy reads the fixed ZModel projection without
  // requiring a website session. Keep editor reads behind LOC permissions.
  if(operation.mode==='public')
    return withPublicLocRead({scope},read);
  const access=scope==='loc'?{global:true}:{scope,
    writeScopes:operation.mode==='editor'?[scope]:[]};
  return withAuthorizedLocRead(access,read);
}
