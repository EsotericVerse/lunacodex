// Display-only authentication diagnostics for the Admin database panel.
// Never changes OAuth providers, database links, credentials, or routing.
function validEndpoint(value,suffix){
  try{
    const parsed=new URL(String(value||''));
    return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&
      parsed.pathname.replace(/\/+$/,'').endsWith(suffix);
  }catch{return false;}
}
export function readonlyAuthStatus(){
  return Object.freeze({
    // Authentication remains a separate upstream adapter until native LOC
    // OAuth issuance and session verification have passed production checks.
    primaryOAuth:'Clerk（目前的身分上游；LOC OAuth 尚未啟用）',
    authorization:'LOC Authority',
    databaseAuthRequired:false
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
