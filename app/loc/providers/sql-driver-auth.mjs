// Database login belongs to the database driver. LOC Auth authorization
// is a separate gate and never substitutes for SQL Server/LDAP credentials.

const SQL_AUTH_FIELDS=Object.freeze({
 default:[],
 'ldap-simple':[],
 ntlm:['domain'],
 'azure-active-directory-access-token':['token'],
 'azure-active-directory-password':['clientId','tenantId'],
 'azure-active-directory-default':['clientId'],
 'azure-active-directory-msi-vm':['clientId'],
 'azure-active-directory-msi-app-service':['clientId'],
 'azure-active-directory-service-principal-secret':['clientId','clientSecret','tenantId']
});
const TOKEN_AUTH=new Set(['azure-active-directory-access-token',
  'azure-active-directory-default','azure-active-directory-msi-vm',
  'azure-active-directory-msi-app-service',
  'azure-active-directory-service-principal-secret']);
const SECRET_AUTH_FIELDS=new Set(['token','clientSecret']);
export function sqlAuthNeedsUserPassword(authentication){
 return !TOKEN_AUTH.has(String(authentication?.type||'default'));
}
export function normalizeSqlDriverAuthentication(engine,input){
 const source=input===undefined?{type:'default'}:input;
 if(!source||typeof source!=='object'||Array.isArray(source))
  throw Error('Invalid SQL driver authentication configuration');
 const type=source.type===undefined?'default':source.type;
 if(typeof type!=='string'||!type)
  throw Error('Invalid SQL driver authentication type');
 const valid=engine==='postgres'?type==='default':
  engine==='mysql'?['default','ldap-simple'].includes(type):
  engine==='mssql'&&Object.hasOwn(SQL_AUTH_FIELDS,type)&&type!=='ldap-simple';
 if(!valid)throw Error('Unsupported SQL driver authentication for engine');
 const allowed=SQL_AUTH_FIELDS[type];
 if(Object.keys(source).some(key=>key!=='type'&&!allowed.includes(key)))
  throw Error('Unexpected SQL driver authentication field');
 const result={type};
 for(const field of allowed){
  const value=source[field];
  if(value===undefined||value===null||value==='')continue;
  if(typeof value!=='string'||!value.trim()||value.length>4096)
   throw Error('Invalid SQL driver authentication '+field);
  result[field]=SECRET_AUTH_FIELDS.has(field)?value:value.trim();
 }
 if(type==='ntlm'&&!result.domain)
  throw Error('SQL Server NTLM domain required');
 if(type==='azure-active-directory-password'&&!result.clientId)
  throw Error('SQL Server Entra password authentication requires clientId');
 if(type==='azure-active-directory-access-token'&&!result.token)
  throw Error('SQL Server access token required');
 if(type==='azure-active-directory-service-principal-secret'&&
   (!result.clientId||!result.clientSecret||!result.tenantId))
  throw Error('SQL Server service principal credentials are incomplete');
 return result;
}
export function publicSqlDriverAuthentication(configuration){
 if(!configuration)return {type:'default'};
 // Deliberate allowlist: even unexpected legacy encrypted fields never
 // become public admin metadata or browser-visible connection credentials.
 const {type='default',domain,clientId,tenantId,token,clientSecret}=configuration;
 return {type,
  ...(domain?{domain}:{}),...(clientId?{clientId}:{}),
  ...(tenantId?{tenantId}:{}),
  ...(token?{token_configured:true}:{}),
  ...(clientSecret?{client_secret_configured:true}:{})};
}

export function mysqlLdapOptions(profile){
  const type=String(profile?.authentication?.type||'default');
  if(type==='default')return {};
  if(type!=='ldap-simple')throw new Error('Unsupported MySQL driver authentication');
  if(profile.tls===false)throw new Error('MySQL LDAP cleartext requires TLS');
  return {enableCleartextPlugin:true};
}
export function mssqlAuthentication(profile,username,password){
  const options=profile?.authentication||{};
  const type=String(options.type||'default');
  if(type==='default')
    return {type:'default',options:{userName:username,password}};
  if(type==='ntlm'){
    if(!String(options.domain||'').trim())throw new Error('SQL Server NTLM domain required');
    return {type:'ntlm',options:{userName:username,password,
      domain:String(options.domain).trim()}};
  }
  if(type==='azure-active-directory-access-token'){
    const token=String(options.token||password||'').trim();
    if(!token)throw new Error('SQL Server access token required');
    return {type,options:{token}};
  }
  if(type==='azure-active-directory-password'){
    if(!username||!password)throw new Error('SQL Server Entra user credentials required');
    if(!options.clientId)throw new Error('SQL Server Entra password authentication requires clientId');
    return {type,options:{userName:username,password,
      ...(options.tenantId?{tenantId:String(options.tenantId)}:{}),
      ...(options.clientId?{clientId:String(options.clientId)}:{})}};
  }
  if(type==='azure-active-directory-default'){
    return {type,options:options.clientId?{clientId:String(options.clientId)}:{}};
  }
  if(['azure-active-directory-msi-vm','azure-active-directory-msi-app-service'].includes(type))
    return {type,options:options.clientId?{clientId:String(options.clientId)}:{}};
  if(type==='azure-active-directory-service-principal-secret'){
    if(!options.clientId||!options.clientSecret||!options.tenantId)
      throw new Error('SQL Server service principal credentials are incomplete');
    return {type,options:{clientId:String(options.clientId),
      clientSecret:String(options.clientSecret),tenantId:String(options.tenantId)}};
  }
  throw new Error('Unsupported SQL Server authentication type');
}
