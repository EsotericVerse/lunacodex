// Display-only authentication diagnostics for the Admin database panel.
// Never changes OAuth providers, database links, credentials, or routing.
function validEndpoint(value,suffix){
  try{
    const parsed=new URL(String(value||''));
    return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&
      parsed.pathname.replace(/\/+$/,'').endsWith(suffix);
  }catch{return false;}
}
export function readonlyAuthStatus({primaryId='supabase-current',
  identityProvider='',neonAuthUrl='',neonDataApiUrl=''}={}){
  return Object.freeze({
    primaryOAuth:'Clerk',
    // LOC login is independent of the database. Supabase Auth is not used.
    supabaseSupported:false,
    // Neon Auth adapter requires both independently configured endpoints.
    neonSupported:validEndpoint(neonAuthUrl,'/auth')&&
      validEndpoint(neonDataApiUrl,'/rest/v1')
  });
}
export function recoveryOAuthLabel(settings){
  if(!settings||typeof settings!=='object'||!settings.publishableKey||
    !settings.frontendApiUrl)return '未設定';
  if(!validEndpointOrigin(settings.frontendApiUrl))return '未設定';
  const environment=String(settings.publishableKey).startsWith('pk_test_')
    ?'Development':String(settings.publishableKey).startsWith('pk_live_')
      ?'Production':'未識別環境';
  return 'Clerk（'+environment+'）';
}
function validEndpointOrigin(value){
  try{
    const u=new URL(String(value||''));
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&
      (u.pathname==='/'||u.pathname==='');
  }catch{return false;}
}
