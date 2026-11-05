// Public OAuth 2.1 authorization-code + PKCE client for LOC MCP only.
// No website, content script or other MCP receives a token.
export const MCP_URL='https://loc.lo3rwang.cc/mcp';
export const LOC_ORIGIN='https://loc.lo3rwang.cc';
export const ISSUER='https://precise-grackle-3371.clerk.accounts.dev';
const CONFIG_URL=LOC_ORIGIN+'/extension/oauth/config.json';
const CLIENT_METADATA_URL=LOC_ORIGIN+'/extension/oauth/client.json';
const SCOPE='profile email offline_access';
const REGISTERED_REDIRECT='https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc-galaxy';

export function toBase64url(bytes){
  const data=Array.from(bytes,x=>String.fromCharCode(x)).join('');
  return btoa(data).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
export function randomUrlSafe(bytes=32){
  const value=new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return toBase64url(value);
}
export async function pkceChallenge(verifier){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  return toBase64url(new Uint8Array(digest));
}
function requireTrustedUrl(value,origin){
  const url=new URL(String(value||''));
  if(url.origin!==origin||url.username||url.password||url.hash)
    throw Error('OAuth 伺服器端點來源不符');
  return url.href;
}
async function safeJson(url,options={}){
  const response=await fetch(url,{...options,redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('LOC OAuth 服務回應 HTTP '+response.status);
  return response.json();
}
export async function getOAuthConfiguration(){
  const [cfg,metadata]=await Promise.all([
    safeJson(CONFIG_URL),
    safeJson(ISSUER+'/.well-known/oauth-authorization-server')
  ]);
  if(cfg?.issuer!==ISSUER||cfg?.resource!==MCP_URL||metadata?.issuer!==ISSUER)
    throw Error('LOC OAuth 來源設定不一致');
  const authorizationEndpoint=requireTrustedUrl(metadata.authorization_endpoint,ISSUER);
  const tokenEndpoint=requireTrustedUrl(metadata.token_endpoint,ISSUER);
  if(!Array.isArray(metadata.code_challenge_methods_supported)||
    !metadata.code_challenge_methods_supported.includes('S256'))
    throw Error('Clerk OAuth 未啟用必要的 PKCE S256');
  // An explicitly registered public client takes precedence over CIMD.
  const clientId=String(cfg.client_id||'').trim()||
    (metadata.client_id_metadata_document_supported===true?CLIENT_METADATA_URL:'');
  if(!clientId||clientId.length>300||/\s/.test(clientId))
    throw Error('LOC Galaxy 尚未註冊公開 OAuth Client；請由管理者設定 Clerk。');
  return {clientId,authorizationEndpoint,tokenEndpoint};
}
async function tokenExchange(endpoint,form){
  const value=await safeJson(endpoint,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded',
      accept:'application/json'},
    body:new URLSearchParams(form).toString()});
  if(typeof value?.access_token!=='string'||!value.access_token||
    String(value.token_type||'').toLowerCase()!=='bearer'||
    !Number.isFinite(Number(value.expires_in))||Number(value.expires_in)<=0)
    throw Error('Clerk OAuth 沒有回傳有效的 Bearer Token');
  return {access_token:value.access_token,
    refresh_token:typeof value.refresh_token==='string'?value.refresh_token:'',
    expires_at:Date.now()+Math.min(86400,Number(value.expires_in))*1000};
}
export async function interactiveAuthorization(){
  const {clientId,authorizationEndpoint,tokenEndpoint}=await getOAuthConfiguration();
  const redirectUri=chrome.identity.getRedirectURL('loc-galaxy');
  if(redirectUri!==REGISTERED_REDIRECT)
    throw Error('Chrome Extension ID 與 Clerk 註冊回呼網址不符。請確認從正確的 extensions/loc-galaxy 資料夾安裝；目前回呼：'+redirectUri);
  const verifier=randomUrlSafe(48),state=randomUrlSafe(32);
  const url=new URL(authorizationEndpoint);
  for(const [key,value] of Object.entries({
    response_type:'code',client_id:clientId,redirect_uri:redirectUri,
    resource:MCP_URL,scope:SCOPE,state,
    code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256'
  }))url.searchParams.set(key,value);
  let responseUrl;
  try{
    responseUrl=await chrome.identity.launchWebAuthFlow({
      url:url.toString(),interactive:true
    });
  }catch(error){
    const detail=String(error?.message||error);
    if(/Authorization page could not be loaded/i.test(detail))
      throw Error('Clerk 授權頁載入失敗：請檢查此 Client ID 是否註冊在 '+ISSUER+
        '，且 Public OAuth Client 的 Redirect URI 完全等於 '+redirectUri+
        '；也請檢查 Clerk OAuth 應用的 Scope／同意畫面是否可用。Chrome 無法顯示原始 HTTP 錯誤。');
    throw error;
  }
  if(typeof responseUrl!=='string')throw Error('登入流程已取消');
  const callback=new URL(responseUrl),expected=new URL(redirectUri);
  if(callback.origin!==expected.origin||callback.pathname!==expected.pathname||
    callback.searchParams.get('state')!==state)
    throw Error('OAuth 回呼來源或 state 驗證失敗');
  if(callback.searchParams.has('error'))throw Error('Clerk OAuth 授權未完成');
  const code=callback.searchParams.get('code');
  if(!code)throw Error('OAuth 沒有授權碼');
  const result=await tokenExchange(tokenEndpoint,{
    grant_type:'authorization_code',client_id:clientId,
    redirect_uri:redirectUri,code,code_verifier:verifier
  });
  return {...result,client_id:clientId};
}
export async function refreshAuthorization(auth){
  if(!auth?.refresh_token||!auth.client_id)throw Error('OAuth Session 需重新登入');
  const {clientId,tokenEndpoint}=await getOAuthConfiguration();
  if(clientId!==auth.client_id)throw Error('OAuth Client 已變更，需重新授權');
  const result=await tokenExchange(tokenEndpoint,{
    grant_type:'refresh_token',client_id:clientId,
    refresh_token:auth.refresh_token
  });
  return {...result,refresh_token:result.refresh_token||auth.refresh_token,
    client_id:clientId};
}

let rpcId=0;
export async function mcpTool(token,name,args={}){
  const id=++rpcId;
  const response=await fetch(MCP_URL,{
    method:'POST',cache:'no-store',redirect:'error',
    signal:AbortSignal.timeout(16000),
    headers:{authorization:'Bearer '+token,
      'content-type':'application/json',
      'mcp-protocol-version':'2025-11-25',
      accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',
      params:{name,arguments:args}})
  });
  if(response.status===429){
    const after=Number(response.headers.get('retry-after'));
    throw Error('LOC MCP QoS 冷卻中（HTTP 429）'+
      (Number.isFinite(after)&&after>0?'，請於 '+Math.ceil(after)+' 秒後再試':'；請勿連續重試'));
  }
  if(!response.ok)throw Error('LOC MCP 拒絕授權（HTTP '+response.status+'）');
  const data=await response.json();
  if(data?.id!==id||data?.error||data?.result?.isError)
    throw Error('LOC MCP 權限或 Scope 核驗失敗');
  const value=data?.result?.structuredContent;
  if(!value||typeof value!=='object')throw Error('LOC MCP 未回傳有效驗證資料');
  return value;
}
export async function verifyScopeAuthorization(token,scopeid){
  const connection=await mcpTool(token,'loc_connection_status');
  if(connection.connected!==true||connection.provider!=='clerk'||
    !/^user_[a-zA-Z0-9]+$/.test(String(connection.subject||'')))
    throw Error('LOC MCP Clerk OAuth 身分尚未通過驗證');
  const check=await mcpTool(token,'galaxy_link',{
    action:'check',scopeid,conversation_id:'loc-galaxy-extension-connection-probe',
    updated_at:new Date().toISOString()
  });
  if(check.scopeid!==scopeid)throw Error('LOC MCP Scope 回傳不一致');
  return {subject:connection.subject};
}
