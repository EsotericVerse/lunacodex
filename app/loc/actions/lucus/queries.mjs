'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {parseLucusFeatureQuery,executeLucusFeatureQuery}
  from '../../model/lucus-feature-queries.mjs';
import {queryPublishedSourceLucus} from '../../source/catalog-public.mjs';

export async function queryLucusFeature(body){
  const operation=parseLucusFeatureQuery(body);
  const scope=operation.scope;
  if(operation.family==='source'){
    const data=await queryPublishedSourceLucus(operation);
    return {data,query:{requestedBy:'lucus',scope,model:'lucus-feature',
      view:operation.family,mode:'published-js'}};
  }
  const read=async(db,port)=>({
    data:await executeLucusFeatureQuery(db,operation,port),
    query:{requestedBy:'lucus',scope,model:'lucus-feature',
      view:operation.view||operation.family,mode:operation.mode}
  });
  // Public SiteLucus taxonomy reads the fixed ZModel projection without
  // requiring a website session. Keep editor reads behind LOC permissions.
  if(operation.mode==='public')
    return withPublicLocRead({scope},read);
  const access=scope==='loc'?{global:true}:{scope,
    writeScopes:operation.mode==='editor'?[scope]:[]};
  return withAuthorizedLocRead(access,read);
}
