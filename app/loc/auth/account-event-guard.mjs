// An initial LOC Auth session emitted during a full document navigation is not
// a change of an already-known identity. Cancelling an in-flight management
// query here leaves the editor gated without revalidation.
export function shouldInvalidateManagementForAuthEvent({
  event='',previousUserId='',previousEmail='',nextUserId='',nextEmail='',hasAuthorization=false
}={}){
  if(event==='SIGNED_OUT')return true;
  const hadIdentity=Boolean(previousUserId||previousEmail||hasAuthorization);
  return hadIdentity&&(previousUserId!==nextUserId||previousEmail!==nextEmail);
}
