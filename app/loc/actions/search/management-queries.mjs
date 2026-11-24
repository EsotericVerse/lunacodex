'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {searchPrivateGalaxy} from '../../providers/kysely-management.mjs';

export async function queryPrivateGalaxy(args={}){
  const scope=String(args.p_scope_id||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw Error('Invalid Search Scope');
  return withAuthorizedLocRead({scope},async(db,_port,{session,grants})=>({
    data:(await searchPrivateGalaxy(db,args,{provider:'loc',role:'authenticated',
      sub:session.userId,email:session.email,me:true,grants})).data,
    count:null
  }));
}
