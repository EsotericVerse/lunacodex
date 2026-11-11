// An initial LOC Auth session emitted during a full document navigation is not
// a change of an already-known identity. Cancelling an in-flight management
// query here leaves the editor gated without revalidation.
export function shouldInvalidateManagementForAuthEvent({
  event='',previousUserId='',previousEmail='',nextUserId='',nextEmail='',hasAuthorization=false
}={}){
  if(event==='SIGNED_OUT')return true;
  // The SDK adapter emits an empty INITIAL_SESSION to every new subscriber.
  // That is hydration, never a sign-out; a component mounting after
  // verification must not revoke the verified grant. An initial event that
  // carries a different user still falls through and revokes.
  if(event==='INITIAL_SESSION'&&!nextUserId&&!nextEmail)return false;
  const hadIdentity=Boolean(previousUserId||previousEmail||hasAuthorization);
  return hadIdentity&&(previousUserId!==nextUserId||previousEmail!==nextEmail);
}
