// Outbound OAuth client for fixed, reviewed MCP providers. LOC Auth is untouched.
// Provider-issued tokens are stored separately from LOC-issued identity tokens.
import {UPSTREAM_PROVIDERS,upstreamProvider,trustedProviderUrl,
  LOC_MCP_CALLBACK,LOC_MCP_CLIENT_DOCUMENT} from './upstream-providers.mjs';
import {LOC_MCP_EXTENSION_RETURN,normalizeSsoEmail}
  from './extension-sso.mjs';
import {randomValue,hashValue,providerKey,pendingPrefix,vaultList,
  vaultGet,vaultPut,vaultDelete} from './upstream-vault.mjs';

const OAUTH_TTL=600;
const form=params=>new URLSearchParams(params).toString();
async function safeJson(provider,url,options={}){
  const endpoint=trustedProviderUrl(provider,url);
  const response=await fetch(endpoint,{...options,redirect:'error',
    signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Upstream OAuth provider unavailable ('+response.status+')');
  const result=await response.json();
  if(!result||typeof result!=='object')throw new Error('Invalid upstream OAuth metadata');
  return result;
}
function oauthClientSettings(env,provider){
  const source=env.LOC_MCP_PROVIDER_OAUTH_JSON;
  if(!source)return {};
  let all;try{all=JSON.parse(source)}catch{throw new Error('Invalid upstream OAuth configuration')}
  const row=all?.[provider]||{};
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid upstream OAuth client');
  return {client_id:typeof row.client_id==='string'?row.client_id:'',
    client_secret:typeof row.client_secret==='string'?row.client_secret:'',
    scope:typeof row.scope==='string'?row.scope:''};
}
function oauthWellKnown(issuer){
  const url=new URL(issuer);
  const path=url.pathname.replace(/\/+$/,'');
  return [url.origin+'/.well-known/oauth-authorization-server'+path,
    url.origin+'/.well-known/openid-configuration'+path,
    url.origin+path+'/.well-known/openid-configuration',
    url.origin+'/.well-known/oauth-authorization-server',
    url.origin+'/.well-known/openid-configuration'];
}
async function metadata(provider){
  const resource=new URL(upstreamProvider(provider).url);
  const urls=[resource.origin+'/.well-known/oauth-protected-resource'+
    resource.pathname.replace(/\/+$/,''),
    resource.origin+'/.well-known/oauth-protected-resource'];
  for(const url of urls){
    try{
      const p=await safeJson(provider,url);
      if(Array.isArray(p.authorization_servers)&&p.authorization_servers.length){
        for(const issuer of p.authorization_servers){
          trustedProviderUrl(provider,issuer);
          for(const path of oauthWellKnown(issuer)){
            try{
              const data=await safeJson(provider,path);
              if(data.authorization_endpoint&&data.token_endpoint&&
                 Array.isArray(data.code_challenge_methods_supported)&&
                 data.code_challenge_methods_supported.includes('S256'))
                return {data,resource:trustedProviderUrl(provider,
                  p.resource||upstreamProvider(provider).url),
                  scopes:Array.isArray(p.scopes_supported)?p.scopes_supported:[]};
            }catch{}
          }
        }
      }
    }catch{}
  }
  throw new Error('Upstream MCP OAuth discovery unavailable; configure provider registration before connecting');
}
async function oauthClient(env,provider,info){
  const configured=oauthClientSettings(env,provider);
  if(configured.client_id)return configured;
  if(provider==='github')throw new Error('GitHub OAuth App client ID and secret must be configured');
  if(info.data.client_id_metadata_document_supported===true)
    return {...configured,client_id:LOC_MCP_CLIENT_DOCUMENT};
  const endpoint=info.data.registration_endpoint;
  if(!endpoint)throw new Error('Provider requires a registered OAuth client');
  const existing=await vaultGet(env,'client:'+provider);
  if(existing?.client_id)return existing;
  const registration=await safeJson(provider,endpoint,{
    method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({client_name:'LOC MCP Gateway',
      redirect_uris:[LOC_MCP_CALLBACK],grant_types:['authorization_code','refresh_token'],
      response_types:['code'],token_endpoint_auth_method:'none'})});
  if(typeof registration.client_id!=='string'||!registration.client_id)
    throw new Error('Provider refused OAuth client registration');
  const client={client_id:registration.client_id,
    client_secret:String(registration.client_secret||''),scope:configured.scope};
  await vaultPut(env,'client:'+provider,client);
  return client;
}
async function oauthConfig(env,provider){
  if(provider==='github'){
    const cfg=oauthClientSettings(env,provider);
    if(!cfg.client_id||!cfg.client_secret)
      throw new Error('GitHub OAuth client credentials are not configured');
    return {client:cfg,authorize:'https://github.com/login/oauth/authorize',
      token:'https://github.com/login/oauth/access_token',resource:UPSTREAM_PROVIDERS.github.url,
      scopes:cfg.scope||'read:user'};
  }
  const info=await metadata(provider);
  return {client:await oauthClient(env,provider,info),
    authorize:trustedProviderUrl(provider,info.data.authorization_endpoint),
    token:trustedProviderUrl(provider,info.data.token_endpoint),
    resource:info.resource,
    scopes:oauthClientSettings(env,provider).scope||
      (info.scopes.includes('offline_access')?'offline_access':'')};
}
export async function beginUpstreamOAuth(env,subject,provider,request={}){
  upstreamProvider(provider);
  const oauth=await oauthConfig(env,provider);
  const verifier=randomValue(48);
  const challenge=await hashValue(verifier);
  const state=randomValue(32);
  const surface=request.surface==='extension'?'extension':'website';
  const loginHint=request.email?normalizeSsoEmail(request.email):'';
  const returnTo=surface==='extension'?LOC_MCP_EXTENSION_RETURN:'';
  await vaultPut(env,'state:'+state,{subject,provider,verifier,
    token_endpoint:oauth.token,client:oauth.client,resource:oauth.resource,
    surface,return_to:returnTo,login_hint:loginHint},OAUTH_TTL);
  const query=new URLSearchParams({client_id:oauth.client.client_id,
    response_type:'code',redirect_uri:LOC_MCP_CALLBACK,state,
    code_challenge:challenge,code_challenge_method:'S256'});
  if(oauth.scopes)query.set('scope',oauth.scopes);
  if(loginHint)query.set('login_hint',loginHint);
  // RFC 8707 resource hints are used only by MCP servers, not GitHub OAuth.
  if(provider!=='github')query.set('resource',oauth.resource);
  return {authorize_url:oauth.authorize+'?'+query.toString(),provider,state};
}
async function exchange(provider,tokenEndpoint,params,client){
  const body={...params,client_id:client.client_id};
  if(client.client_secret)body.client_secret=client.client_secret;
  const headers={'content-type':'application/x-www-form-urlencoded',accept:'application/json'};
  const endpoint=trustedProviderUrl(provider,tokenEndpoint);
  const response=await fetch(endpoint,{method:'POST',headers,body:form(body),
    redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Provider token exchange failed ('+response.status+')');
  const content=await response.json();
  if(typeof content.access_token!=='string'||!content.access_token)
    throw new Error('Provider did not issue an access token');
  return content;
}
function tokenRecord(previous,tokens,tokenEndpoint,client,resource){
  return {token_endpoint:tokenEndpoint,client,resource,
    connection_id:previous?.connection_id||randomValue(24),
    access_token:tokens.access_token,
    refresh_token:tokens.refresh_token||previous?.refresh_token||'',
    expires_at:tokens.expires_in!=null&&Number.isFinite(Number(tokens.expires_in))&&
      Number(tokens.expires_in)>0?Date.now()+Number(tokens.expires_in)*1000:0,
    scope:tokens.scope||previous?.scope||''};
}
export async function completeUpstreamOAuth(env,params,expectedSubject){
  const state=String(params.state||'');
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(state))throw new Error('Invalid OAuth state');
  const key='state:'+state;
  const saved=await vaultGet(env,key);
  if(!saved)throw new Error('Expired or unknown OAuth state');
  if(expectedSubject!=null){
    if(saved.subject!==expectedSubject)throw new Error('OAuth browser identity mismatch');
  }else if(saved.surface!=='extension'||saved.return_to!==LOC_MCP_EXTENSION_RETURN){
    throw new Error('OAuth browser identity required');
  }
  await vaultDelete(env,key);
  if(params.error||!params.code)throw new Error('Upstream OAuth was denied');
  const tokens=await exchange(saved.provider,saved.token_endpoint,{
    grant_type:'authorization_code',code:String(params.code),
    redirect_uri:LOC_MCP_CALLBACK,code_verifier:saved.verifier,
    ...(saved.provider==='github'?{}:{resource:saved.resource})},saved.client);
  // A newly authorized account must not silently inherit the old external
  // account's function policies or the old account's pending approvals.
  await vaultDelete(env,'policy:'+await hashValue(saved.subject)+':'+saved.provider);
  const prefix=await pendingPrefix(saved.subject);
  for(const key of await vaultList(env,prefix,100)){
    const pending=await vaultGet(env,key);
    if(pending?.provider===saved.provider)await vaultDelete(env,key);
  }
  await vaultPut(env,await providerKey(saved.subject,saved.provider),
    tokenRecord(null,tokens,saved.token_endpoint,saved.client,saved.resource));
  return {provider:saved.provider,connected:true,state,
    surface:saved.surface||'website',return_to:saved.return_to||''};
}
export async function pendingUpstreamOAuth(env,state){
  const value=String(state||'');
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(value))return null;
  const saved=await vaultGet(env,'state:'+value);
  return saved?.surface==='extension'&&saved.return_to===LOC_MCP_EXTENSION_RETURN?
    {provider:saved.provider,return_to:saved.return_to}:null;
}
export async function upstreamConnection(env,subject,provider){
  upstreamProvider(provider);
  const key=await providerKey(subject,provider);
  let entry=await vaultGet(env,key);
  if(!entry)return null;
  if(entry.expires_at&&entry.expires_at<Date.now()+30000){
    if(!entry.refresh_token)throw new Error('Provider OAuth has expired; reconnect');
    const token=await exchange(provider,entry.token_endpoint,{
      grant_type:'refresh_token',refresh_token:entry.refresh_token,
    ...(provider==='github'?{}:{resource:entry.resource})},entry.client);
    entry=tokenRecord(entry,token,entry.token_endpoint,entry.client,entry.resource);
    await vaultPut(env,key,entry);
  }
  return entry;
}
export async function disconnectUpstream(env,subject,provider){
  upstreamProvider(provider);
  // The local delegation is revoked here. Provider-side revocation, if available,
  // must be handled by the provider; never claim to have revoked remote consent.
  await vaultDelete(env,await providerKey(subject,provider));
}
