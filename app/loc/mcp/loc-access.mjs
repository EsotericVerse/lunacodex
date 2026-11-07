import {createLocAccountAdapter} from '../auth/loc-browser.mjs';

// Browser administrative requests present only an LOC Auth audience-bound
// token. The Authority checks root identity and Scope grants on every call.
let adapter=null;
export async function mcpLocSession({account=null}={}){
  const identity=account||adapter||(adapter=createLocAccountAdapter());
  const verified=await identity.auth.getVerifiedSession();
  const subject=String(verified?.user?.id||'');
  if(!/^loc_[A-Za-z0-9_-]{32,80}$/.test(subject))
    throw new Error('LOC Auth login required');
  const token=await identity.getAccessToken();
  if(typeof token!=='string'||token.split('.').length!==3)
    throw new Error('Verified LOC Auth token unavailable');
  return {token,subject};
}
