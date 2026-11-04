import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AUTH_PROVIDER_TYPES,AUTH_PROVIDER_FIELDS,validateAuthProviderSettings,
  publicAuthProviderSettings} from '../app/loc/auth/auth-provider-settings.mjs';

const siteOrigin='https://loc.lo3rwang.cc';
const sample={client_id:'OAuthClient_123',client_secret:'loc-super-secret-123',
  callback_url:'https://loc.lo3rwang.cc/auth/callback/github'};

test('each supported provider has its own field contract',()=>{
  assert.deepEqual(AUTH_PROVIDER_TYPES,['github','oidc','entra','ldap','ad']);
  for(const type of AUTH_PROVIDER_TYPES){
    assert.ok(AUTH_PROVIDER_FIELDS[type].some(field=>field.kind==='secret'));
  }
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
