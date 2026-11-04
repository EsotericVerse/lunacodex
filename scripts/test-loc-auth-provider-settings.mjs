import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {AUTH_PROVIDER_TYPES,AUTH_PROVIDER_FIELDS,validateAuthProviderSettings,
  publicAuthProviderSettings} from '../app/loc/auth/auth-provider-settings.mjs';

const siteOrigin='https://loc.lo3rwang.cc';
const sample={client_id:'OAuthClient_123',client_secret:'loc-super-secret-123',
  callback_url:'https://loc.lo3rwang.cc/auth/callback/github'};

test('each supported provider has its own field contract',()=>{
  assert.deepEqual(AUTH_PROVIDER_TYPES,['github','oidc','entra','ldap','ad','neon']);
  for(const type of AUTH_PROVIDER_TYPES.filter(type=>type!=='neon')){
    assert.ok(AUTH_PROVIDER_FIELDS[type].some(field=>field.kind==='secret'));
  }
  assert.equal(AUTH_PROVIDER_FIELDS.neon.some(field=>field.kind==='secret'),false);
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
    callback_url:'https://loc.lo3rwang.cc/auth/callback/oidc'};
  for(const type of ['ldap','ad']){
    const saved=validateAuthProviderSettings(type,config,{siteOrigin});
    assert.equal(saved.type,type);
    assert.equal(Object.hasOwn(saved,'bind_password'),false);
  }
  assert.throws(()=>validateAuthProviderSettings('ldap',
    {...config,bind_password:'danger'},{siteOrigin}),/Unexpected/);
});


test('Neon Auth URLs can be saved without a separate OAuth client secret',()=>{
  const config={auth_url:'https://ep-test.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth',
    data_api_url:'https://ep-test.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    callback_url:'https://loc.lo3rwang.cc/auth/callback/neon'};
  const validated=validateAuthProviderSettings('neon',config,{siteOrigin});
  assert.equal(validated.type,'neon');
  assert.equal(Object.hasOwn(validated,'client_secret'),false);
  const view=publicAuthProviderSettings(validated);
  assert.equal(view.secret_configured,false);
  assert.equal(view.active,false);
  assert.equal(view.runtime_connected,false);
  assert.throws(()=>validateAuthProviderSettings('neon',
    {...config,auth_url:'https://ep-test.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb'},
    {siteOrigin}),/\u002fauth/);
  assert.throws(()=>validateAuthProviderSettings('neon',
    {...config,data_api_url:'https://ep-test.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/auth'},
    {siteOrigin}),/rest\/v1/);
  assert.throws(()=>validateAuthProviderSettings('neon',
    {...config,callback_url:'https://elsewhere.example/callback'},
    {siteOrigin}),/LOC origin/);
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
