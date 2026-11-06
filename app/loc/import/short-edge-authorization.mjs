// Short-import authorization boundary shared with the LOC-delegated SQL Gateway.
// verifyLocDelegation has already validated issuer, HS256 signature, audience,
// expiration, revocation and the signed grant list before calling this helper.
const MANAGED_SCOPES=new Set(['lo3rwang','lrunes']);
function refusal(message,httpStatus){
 return Object.assign(new Error(message),{httpStatus});
}
export function authorizeDelegatedShortImport(body,claims){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).length!==3||
    Object.keys(body).some(k=>!['kind','scopeid','batch'].includes(k))||
    body.kind!=='short-import'||typeof body.scopeid!=='string'||
    !MANAGED_SCOPES.has(body.scopeid)||
    !body.batch||typeof body.batch!=='object'||Array.isArray(body.batch))
   throw refusal('Invalid short-import gateway payload',400);
 // A general authenticated session is NOT an import grant. The actual
 // LOC identity MUST have an explicit, signed write grant for this Scope.
 if(claims?.provider!=='loc'||claims.me!==true||
    typeof claims.sub!=='string'||claims.sub.length<3||claims.sub.length>180||
    !Array.isArray(claims.grants)||
    !claims.grants.includes(body.scopeid+':write'))
   throw refusal('LOC Scope write delegation required',403);
 return {authorized:true,scopeid:body.scopeid,subject:claims.sub};
}
