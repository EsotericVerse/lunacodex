// The already-established LOC Auth Session supplies identity. Every business
// role comes from the published JS Manage registry, never an extra HTTP query.
// This browser projection is UI-only: the trusted write handler independently
// verifies Auth and derives grants from the same published JS module.
import {getAccountSession} from '../db/db-client.mjs';
import {publishedLocAccess} from '../permissions/loc-business-grants.mjs';

export async function readLocEditorGrants({sessionProvider=getAccountSession}={}){
  const session=await sessionProvider();
  const user=session?.user;
  const id=String(user?.id||'').trim();
  const email=String(session?.oauth?.email||user?.email||'').trim().toLowerCase();
  if(!id||!email||!session?.user)
    throw Object.assign(new Error('LOC authentication required'),{status:401});
  const rights=publishedLocAccess(email,{website:true});
  return {user:{id,email},roles:rights.roles,grants:rights.grants};
}
