// No LOC-built token issuer or verifier. Better Auth identifies the user;
// website permissions belong exclusively to the business database.
import {verifiedLocWebsiteSession} from '../app/loc/auth/verified-session.mjs';
const anonymous=()=>({role:'anon',claims:{}});
export async function verifiedIdentity(request){
  // Public browsing never requires an Auth service. When an Auth session is
  // absent or unavailable, only owner-only business actions are denied.
  try{
    const session=await verifiedLocWebsiteSession(request);
    return {role:'authenticated',claims:{
      provider:'loc',sub:session.userId,email:session.email,me:false,
      role:'authenticated',grants:[]
    }};
  }catch{
    return anonymous();
  }
}
