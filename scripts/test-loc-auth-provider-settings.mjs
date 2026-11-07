import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {AUTH_PROVIDER_TYPES,AUTH_PROVIDER_FIELDS,validateAuthProviderSettings,
  publicAuthProviderSettings} from '../app/loc/auth/auth-provider-settings.mjs';

const siteOrigin='https://auth.lo3rwang.cc';
const sample={client_id:'OAuthClient_123',client_secret:'loc-super-secret-123',
  callback_url:'https://auth.lo3rwang.cc/oauth/callback/github'};

test('each supported provider has its own field contract',()=>{
  assert.deepEqual(AUTH_PROVIDER_TYPES,['github','oidc','entra','ldap','ad']);
  for(const type of AUTH_PROVIDER_TYPES)
    assert.ok(AUTH_PROVIDER_FIELDS[type].some(field=>field.kind==='secret'));
  assert.equal(AUTH_PROVIDER_FIELDS.neon,undefined);
});

test('GitHub OAuth configuration never exposes its credential',()=>{
  const saved=validateAuthProviderSettings('github',sample,{siteOrigin});
  assert.equal(saved.client_secret,sample.client_secret);
  const publicView=publicAuthProviderSettings(saved);
  assert.equal(publicView.client_secret,undefined);
  assert.equal(publicView.secret_configured,true);
  assert.equal(publicView.active,false);
  assert.equal(publicView.runtime_connected,false);
});

test('a blank replacement secret preserves only the existing encrypted value',()=>{
  const previous=validateAuthProviderSettings('github',sample,{siteOrigin});
  const updated=validateAuthProviderSettings('github',
    {...sample,client_id:'OAuthClient_456',client_secret:''},{previous,siteOrigin});
  assert.equal(updated.client_secret,previous.client_secret);
});

test('cannot redirect authorization callback away from LOC',()=>{
  assert.throws(()=>validateAuthProviderSettings('github',
    {...sample,callback_url:'https://evil.example/auth/callback/github'},{siteOrigin}),
    /LOC origin/);
  assert.throws(()=>validateAuthProviderSettings('github',
    {...sample,callback_url:'http://loc.lo3rwang.cc/auth/callback/github'},{siteOrigin}));
});

test('reject untrusted or unknown fields, including fake activation',()=>{
  assert.throws(()=>validateAuthProviderSettings('github',{...sample,active:true},{siteOrigin}),
    /Unexpected/);
  assert.throws(()=>validateAuthProviderSettings('clerk',sample,{siteOrigin}),
    /Unsupported/);
  assert.throws(()=>validateAuthProviderSettings('github',{...sample,client_secret:'x'},
    {siteOrigin}),/Client Secret/);
});

test('LDAP and AD use a dedicated OIDC bridge, not raw passwords in the browser',()=>{
  const config={bridge_issuer_url:'https://login.example.org/realms/staff',
    client_id:'loc-enterprise',client_secret:'enterprise-secret-123',
    callback_url:'https://auth.lo3rwang.cc/oauth/callback/oidc'};
  for(const type of ['ldap','ad']){
    const saved=validateAuthProviderSettings(type,config,{siteOrigin});
    assert.equal(saved.type,type);
    assert.equal(Object.hasOwn(saved,'bind_password'),false);
  }
  assert.throws(()=>validateAuthProviderSettings('ldap',
    {...config,bind_password:'danger'},{siteOrigin}),/Unexpected/);
});


test('vendor-specific Neon Auth is removed without changing SQL database drivers',()=>{
  assert.throws(()=>validateAuthProviderSettings('neon',sample,{siteOrigin}),/Unsupported/);
  const source=readFileSync(new URL('../app/loc/providers/kysely-database-drivers.ts',import.meta.url),'utf8');
  assert.match(source,/PostgresDialect/);
  assert.match(source,/MysqlDialect/);
  assert.match(source,/MssqlDialect/);
});

test('Admin authentication editor reuses existing responsive workspace geometry',()=>{
  const source=readFileSync(new URL('../app/loc/views/admin-panels/EnterpriseAuthReserved.jsx',import.meta.url),'utf8');
  assert.match(source,/className="admin-inline-select"/);
  assert.match(source,/className="loc-settings-select"/);
  assert.match(source,/className="scope-management-fields"/);
  assert.match(source,/longField\?'scope-management-wide-field'/);
  assert.match(source,/useEditDockForm\(\{save,discard,/);
  assert.doesNotMatch(source,/style=\{\{.*(?:width|maxWidth)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage/);
  assert.doesNotMatch(source,/setEmergencyDatabasePrimary|setActiveProvider|activateProvider|onClick=\{.*activate/);
  assert.match(source,/authProviderSettingsRequest\(\)/);
});

test('Admin groups Auth with Database and ISR under Network, including legacy deep links',()=>{
  const source=readFileSync(new URL('../app/loc/views/AdminHomeView.jsx',import.meta.url),'utf8');
  const options=source.slice(source.indexOf('const ADMIN_OPTIONS='),source.indexOf('function Login('));
  assert.doesNotMatch(options,/value:'enterpriseAuth'/);
  assert.match(options,/value:'network'/);
  assert.match(source,/enterpriseAuth:'network'/);
  const network=source.match(/\{section==='network'\?<\>[\s\S]*?<\/>:null\}/)?.[0]||'';
  assert.match(network,/<DatabaseTarget scopeGroup=\{scopeGroup\}\/>/);
  assert.match(network,/<IsrDomainTarget\/>/);
  assert.match(network,/<EnterpriseAuthReserved\/>/);
  assert.equal((source.match(/<EnterpriseAuthReserved\/>/g)||[]).length,1);
});
