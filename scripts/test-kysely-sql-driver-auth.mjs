import test from 'node:test';
import assert from 'node:assert/strict';
import {mysqlLdapOptions,mssqlAuthentication} from '../app/loc/providers/sql-driver-auth.mjs';

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
