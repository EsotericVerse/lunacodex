import test from 'node:test';
import assert from 'node:assert/strict';
import {mysqlLdapOptions,mssqlAuthentication,normalizeSqlDriverAuthentication,
  publicSqlDriverAuthentication,sqlAuthNeedsUserPassword}
 from '../app/loc/providers/sql-driver-auth.mjs';

test('MySQL LDAP simple enables cleartext plugin only over verified TLS',()=>{
  assert.deepEqual(mysqlLdapOptions({}),{});
  assert.deepEqual(mysqlLdapOptions({tls:true,authentication:{type:'ldap-simple'}}),
    {enableCleartextPlugin:true});
  assert.throws(()=>mysqlLdapOptions({tls:false,authentication:{type:'ldap-simple'}}),
    /requires TLS/);
  assert.throws(()=>mysqlLdapOptions({authentication:{type:'ldap-sasl'}}),
    /Unsupported/);
});
test('SQL Server supports independently configured SQL, NTLM and Entra login',()=>{
  assert.deepEqual(mssqlAuthentication({},'user','secret'),
    {type:'default',options:{userName:'user',password:'secret'}});
  assert.equal(mssqlAuthentication({authentication:{type:'ntlm',domain:'CORP'}},
    'user','secret').options.domain,'CORP');
  assert.deepEqual(mssqlAuthentication({authentication:{
    type:'azure-active-directory-default',clientId:'abc'}},'',''),
    {type:'azure-active-directory-default',options:{clientId:'abc'}});
  assert.equal(mssqlAuthentication({authentication:{type:'azure-active-directory-msi-vm'}},
    '','').type,'azure-active-directory-msi-vm');
  assert.throws(()=>mssqlAuthentication({authentication:{type:'ntlm'}},'user','secret'),
    /NTLM domain/);
  assert.throws(()=>mssqlAuthentication({authentication:{
    type:'azure-active-directory-service-principal-secret',clientId:'abc'}},'',''),
    /incomplete/);
});

test('SQL Server Entra token works without database password or a Supabase Auth login',()=>{
  assert.deepEqual(mssqlAuthentication({authentication:{type:'azure-active-directory-access-token',token:'signed-token'}},'',''),
    {type:'azure-active-directory-access-token',options:{token:'signed-token'}});
  assert.deepEqual(mssqlAuthentication({authentication:{type:'azure-active-directory-access-token'}},'','direct-token'),
    {type:'azure-active-directory-access-token',options:{token:'direct-token'}});
  assert.throws(()=>mssqlAuthentication({authentication:{type:'azure-active-directory-access-token'}},'',''),
    /access token required/);
  assert.equal(mssqlAuthentication({authentication:{
    type:'azure-active-directory-password',clientId:'entra-test-client'}},
    'user','secret').options.userName,'user');
});

test('validated encrypted SQL profiles keep Entra tokens out of public metadata',()=>{
 const profile=normalizeSqlDriverAuthentication('mssql',{
  type:'azure-active-directory-service-principal-secret',
  clientId:'app_123',tenantId:'tenant_456',clientSecret:'private.client.secret'});
 const publicView=publicSqlDriverAuthentication(profile);
 assert.equal(publicView.type,'azure-active-directory-service-principal-secret');
 assert.equal(publicView.client_secret_configured,true);
 assert.equal(publicView.clientSecret,undefined);
 assert.equal(JSON.stringify(publicView).includes('private.client.secret'),false);
 assert.deepEqual(publicSqlDriverAuthentication({...profile,password:'never-public',token:'secret-token'}),
  {...publicView,token_configured:true});
 assert.equal(sqlAuthNeedsUserPassword(profile),false);
 assert.deepEqual(mssqlAuthentication({authentication:profile},'','').options,{
  clientId:'app_123',tenantId:'tenant_456',clientSecret:'private.client.secret'});
});
test('SQL Server token and managed identity do not require SQL user passwords',()=>{
 for(const type of ['azure-active-directory-access-token',
  'azure-active-directory-default','azure-active-directory-msi-vm',
  'azure-active-directory-msi-app-service']){
  const auth=normalizeSqlDriverAuthentication('mssql',{
   type,...(type==='azure-active-directory-access-token'?{token:'signed.token'}:{})});
  assert.equal(sqlAuthNeedsUserPassword(auth),false,type);
 }
 const access=normalizeSqlDriverAuthentication('mssql',{
  type:'azure-active-directory-access-token',token:'signed.token'});
 assert.equal(publicSqlDriverAuthentication(access).token_configured,true);
 assert.equal(JSON.stringify(publicSqlDriverAuthentication(access)).includes('signed.token'),false);
 assert.equal(mssqlAuthentication({authentication:access},'','').options.token,'signed.token');
});
test('SQL authentication rejects unsupported engines and incomplete or unexpected fields',()=>{
 assert.throws(()=>normalizeSqlDriverAuthentication('postgres',{type:'ntlm',domain:'CORP'}),
  /Unsupported/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mysql',{type:'azure-active-directory-default'}),
  /Unsupported/);
 assert.deepEqual(normalizeSqlDriverAuthentication('mysql',{type:'ldap-simple'}),{type:'ldap-simple'});
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',{type:'ntlm'}),
  /NTLM domain/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',{
  type:'azure-active-directory-password'}),/clientId/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',{
  type:'azure-active-directory-service-principal-secret',
  clientId:'app',tenantId:'tenant'}),/incomplete/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',{
  type:'default',token:'browser-token'}),/Unexpected/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mysql',{type:'ldap-simple',password:'secret'}),
  /Unexpected/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',null),/Invalid/);
 assert.throws(()=>normalizeSqlDriverAuthentication('mssql',{type:42}),/Invalid/);
 assert.throws(()=>mssqlAuthentication({authentication:{
  type:'azure-active-directory-password'}},'user','password'),/clientId/);
});
