// Shared configuration contract; no auth switch is implied by a saved provider.
// Secret material is accepted ONLY by the trusted LOC Authority and never returned.
export const AUTH_PROVIDER_TYPES=Object.freeze(['github','oidc','entra','ldap','ad']);
export const AUTH_PROVIDER_FIELDS=Object.freeze({
  github:Object.freeze([{key:'client_id',label:'GitHub OAuth Client ID'},
    {key:'callback_url',label:'Callback URL',kind:'url'},
    {key:'client_secret',label:'GitHub OAuth Client Secret',kind:'secret'}]),
  oidc:Object.freeze([{key:'issuer_url',label:'OIDC Issuer URL',kind:'url'},
    {key:'client_id',label:'Client ID'},{key:'callback_url',label:'Callback URL',kind:'url'},
    {key:'client_secret',label:'Client Secret',kind:'secret'}]),
  entra:Object.freeze([{key:'tenant_id',label:'Microsoft Entra Tenant ID'},
    {key:'client_id',label:'Application (Client) ID'},
    {key:'callback_url',label:'Callback URL',kind:'url'},
    {key:'client_secret',label:'Client Secret',kind:'secret'}]),
  ldap:Object.freeze([{key:'bridge_issuer_url',label:'LDAP OIDC Bridge Issuer URL',kind:'url'},
    {key:'client_id',label:'OIDC Bridge Client ID'},
    {key:'callback_url',label:'Callback URL',kind:'url'},
    {key:'client_secret',label:'OIDC Bridge Client Secret',kind:'secret'}]),
  ad:Object.freeze([{key:'bridge_issuer_url',label:'AD OIDC Bridge Issuer URL',kind:'url'},
    {key:'client_id',label:'OIDC Bridge Client ID'},
    {key:'callback_url',label:'Callback URL',kind:'url'},
    {key:'client_secret',label:'OIDC Bridge Client Secret',kind:'secret'}])
});
export const AUTH_PROVIDER_LABELS=Object.freeze({
  github:'GitHub OAuth',oidc:'標準 OIDC',entra:'Microsoft Entra ID',
  ldap:'LDAP（OIDC 橋接）',ad:'Active Directory（OIDC 橋接）'
});
function invalid(message){throw new Error(message)}
function httpsUrl(value,key,{originOnly=false,callbackOrigin=''}={}){
  let url;
  try{url=new URL(value)}catch{invalid(key+' must be a valid HTTPS URL')}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||
    host.endsWith('.internal')||host==='0.0.0.0'||host==='127.0.0.1'||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(host))
    invalid(key+' requires a public HTTPS URL');
  if(originOnly&&url.pathname!=='/'&&url.pathname!=='')invalid(key+' must be an HTTPS origin');
  if(callbackOrigin&&url.origin!==callbackOrigin)invalid('Callback URL must remain on the LOC origin');
  return url.href;
}
export function validateAuthProviderSettings(type,values,{previous=null,siteOrigin=''}={}){
  if(!Object.hasOwn(AUTH_PROVIDER_FIELDS,type))invalid('Unsupported identity provider');
  if(!values||typeof values!=='object'||Array.isArray(values))invalid('Invalid identity configuration');
  const fields=AUTH_PROVIDER_FIELDS[type];
  const permitted=new Set(fields.map(f=>f.key));
  if(Object.keys(values).some(k=>!permitted.has(k)))invalid('Unexpected identity configuration field');
  const origin=siteOrigin?new URL(siteOrigin).origin:'';
  const result={type};
  for(const field of fields){
    const raw=values[field.key];
    if(raw!=null&&typeof raw!=='string')invalid('Invalid '+field.key);
    const value=String(raw||'').trim();
    if(field.kind==='secret'){
      const secret=value||String(previous?.[field.key]||'');
      if(secret.length<8||secret.length>4096||/[\r\n\0]/.test(secret))
        invalid('Client Secret is required (8–4096 characters)');
      result[field.key]=secret;
      continue;
    }
    if(!value||value.length>512||/[\r\n\0]/.test(value))invalid('Missing or invalid '+field.key);
    if(field.kind==='url'){
      const parsed=httpsUrl(value,field.key,
        {callbackOrigin:field.key==='callback_url'?origin:''});
      if(field.key==='callback_url'&&['github','oidc'].includes(type)&&
         origin&&parsed!==origin+'/oauth/callback/'+type)
        invalid('Native LOC OAuth callback URL must be '+origin+'/oauth/callback/'+type);
      result[field.key]=parsed;
    }
    else if(!/^[a-zA-Z0-9._:@\/-]{2,512}$/.test(value))
      invalid('Invalid '+field.key);
    else result[field.key]=value;
  }
  return result;
}
export function publicAuthProviderSettings(profile){
  if(!profile||!Object.hasOwn(AUTH_PROVIDER_FIELDS,profile.type))invalid('Invalid identity provider');
  const item={type:profile.type,configured:true,secret_configured:Boolean(profile.client_secret),
    runtime_connected:false,active:false};
  for(const field of AUTH_PROVIDER_FIELDS[profile.type]){
    if(field.kind!=='secret')item[field.key]=profile[field.key];
  }
  return item;
}
