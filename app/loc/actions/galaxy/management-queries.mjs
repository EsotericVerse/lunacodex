'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {findGalaxyDuplicates} from '../../providers/kysely-management.mjs';

export async function queryGalaxyDuplicates(scopeId){
  const scope=String(scopeId||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw Error('Invalid Galaxy Scope');
  return withAuthorizedLocRead({scope,writeScopes:[scope]},async db=>({
    data:await findGalaxyDuplicates(db,{p_scope_id:scope}),count:null
  }));
}
