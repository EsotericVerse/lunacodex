// Database login belongs to the database driver. LOC Auth authorization
// is a separate gate and never substitutes for SQL Server/LDAP credentials.
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
