// Short-import authorization boundary for signed LOC native Kysely business operations.
// verifyLocDelegation has already validated issuer, RS256 signature, audience,
// expiration, revocation and the signed grant list before calling this helper.
// The signed Scope write grant, not a frozen two-Scope list, authorizes imports.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function refusal(message,httpStatus){
 return Object.assign(new Error(message),{httpStatus});
}
export function authorizeDelegatedShortImport(body,claims){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).length!==3||
    Object.keys(body).some(k=>!['kind','scopeid','batch'].includes(k))||
    body.kind!=='short-import'||typeof body.scopeid!=='string'||
    !SCOPE.test(body.scopeid)||
    !body.batch||typeof body.batch!=='object'||Array.isArray(body.batch))
   throw refusal('Invalid native short-import payload',400);
 // A general authenticated session is NOT an import grant. The actual
 // LOC identity MUST have an explicit, signed write grant for this Scope.
 if(claims?.provider!=='loc'||claims.me!==true||
    typeof claims.sub!=='string'||claims.sub.length<3||claims.sub.length>180||
    typeof claims.email!=='string'||!EMAIL.test(claims.email)||
    !Array.isArray(claims.grants)||
    !claims.grants.includes(body.scopeid+':write'))
   throw refusal('LOC Scope write delegation required',403);
 return {authorized:true,scopeid:body.scopeid,subject:claims.sub};
}
