import {withAuthorizedLocRead} from '../read-context.mjs';
import {canLocAccess,bindLocAuthorization} from '../../providers/loc-authorization.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function scopeId(value){
  const scope=String(value||'').trim().toLowerCase();
  if(!SCOPE.test(scope))throw Error('Invalid Keyword Scope');
  return scope;
}

// Keyword queries and writes each enter through their own Server Action.
// Published JavaScript grants are checked before the database connection;
// this context only binds that already verified principal for precise writes.
export function withKeywordScope(value,{write=false,owner=false}={},run,dependencies={}){
  const scope=scopeId(value);
  const authorizeRead=dependencies.withAuthorizedLocRead||withAuthorizedLocRead;
  return authorizeRead({scope,...(write?{writeScopes:[scope]}:{})},
    async(db,port,{session,grants})=>{
      const owns=canLocAccess(db,'scope',scope);
      if(owner&&!owns)
        throw Object.assign(new Error('Scope Keyword management permission required'),
          {httpStatus:403});
      const claims={provider:'loc',role:'authenticated',sub:session.userId,
        email:session.email,me:true,grants};
      const authorizeTransaction=async trx=>{
        bindLocAuthorization(trx,{role:'authenticated',engine:port.engine,claims});
        if(!canLocAccess(trx,'scope',scope))
          throw Object.assign(new Error('Scope Keyword authorization expired'),
            {httpStatus:403});
      };
      return run({db,port,scope,owner:owns,authorizeTransaction});
    },dependencies);
}
