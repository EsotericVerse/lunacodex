import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {test} from 'node:test';
import {
  LOC_ORIGIN,ISSUER,MCP_URL,pkceChallenge,interactiveAuthorization
} from '../extensions/loc-galaxy/oauth.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
if(!globalThis.crypto)globalThis.crypto=webcrypto;

test('LOC Galaxy manifest limits host access to LOC and its known Clerk issuer',()=>{
  const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
  const metadata=JSON.parse(read('public/extension/oauth/client.json'));
  const config=JSON.parse(read('public/extension/oauth/config.json'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['identity','storage','scripting','alarms']);
  assert.deepEqual(manifest.optional_host_permissions,['https://chatgpt.com/*']);
  assert.deepEqual(manifest.host_permissions,[LOC_ORIGIN+'/*',ISSUER+'/*']);
  assert.equal(manifest.content_scripts,undefined);
  assert.equal(config.issuer,ISSUER);
  assert.equal(config.resource,MCP_URL);
  assert.match(config.client_id,/^[A-Za-z0-9_-]{8,128}$/); // registered Public OAuth client, never a secret
  const hash=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16);
  const id=[...hash].map(n=>String.fromCharCode(97+(n>>4),97+(n&15))).join('');
  assert.equal(id,'hiaeafonocnjaclcfgjmdopbcgnafnna');
  assert.deepEqual(metadata.redirect_uris,['https://'+id+'.chromiumapp.org/loc-galaxy']);
  assert.equal(metadata.token_endpoint_auth_method,'none');
});
test('extension exposes only Scope ID for auth and preserves scenic login',()=>{
  const popup=read('extensions/loc-galaxy/popup.html');
  const worker=read('extensions/loc-galaxy/background.mjs');
  const oauth=read('extensions/loc-galaxy/oauth.mjs');
  assert.deepEqual([...popup.matchAll(/<input /g)].length,1);
  assert.ok(popup.includes('回到你的'));
  assert.ok(worker.includes('/login/index.html?return_to='));
  assert.ok(worker.includes("chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})"));
  assert.ok(worker.includes('verifyScopeAuthorization(token,scopeid)'));
  assert.ok(worker.includes("const BRIDGE_KEY='locGalaxy.websitePending'"));
  assert.ok(oauth.includes("action:'check',scopeid"));
  assert.ok(oauth.includes('chrome.identity.launchWebAuthFlow'));
  assert.ok(!oauth.includes('client_secret'));
  assert.ok(worker.includes('chrome.runtime.onMessageExternal'));
  assert.ok(worker.includes("url.pathname!=='/extension/auth-bridge.html'"));
  assert.ok(worker.includes('chrome.alarms.onAlarm'));
  assert.ok(worker.includes('chrome.runtime.onMessageExternal'));
});
test('OAuth S256 follows the RFC 7636 known verifier example',async()=>{
  const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await pkceChallenge(verifier),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('OAuth callback requires state and PKCE code verifier before token exchange',async()=>{
  const beforeFetch=globalThis.fetch,beforeChrome=globalThis.chrome;
  if(!globalThis.crypto)globalThis.crypto=webcrypto;
  let authUrl,form,exchanges=0;
  const redirect='https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc-galaxy';
  globalThis.fetch=async(url,options={})=>{
    const uri=String(url);
    if(uri.endsWith('config.json'))return Response.json({issuer:ISSUER,resource:MCP_URL,client_id:'oauth_public_client'});
    if(uri.endsWith('/.well-known/oauth-authorization-server'))
      return Response.json({issuer:ISSUER,
        authorization_endpoint:ISSUER+'/oauth/authorize',
        token_endpoint:ISSUER+'/oauth/token',
        code_challenge_methods_supported:['S256'],
        client_id_metadata_document_supported:false});
    if(uri.endsWith('/oauth/token')){
      exchanges++;
      form=new URLSearchParams(options.body);
      return Response.json({access_token:'sample-token',refresh_token:'sample-refresh',
        token_type:'Bearer',expires_in:3600});
    }
    throw Error('Unexpected fetch '+uri);
  };
  globalThis.chrome={identity:{
    getRedirectURL:()=>redirect,
    launchWebAuthFlow:async({url})=>{
      authUrl=new URL(url);
      return redirect+'?state='+encodeURIComponent(authUrl.searchParams.get('state'))+'&code=sample-code';
    }
  }};
  try{
    const result=await interactiveAuthorization();
    assert.equal(result.access_token,'sample-token');
    assert.equal(exchanges,1);
    assert.equal(authUrl.searchParams.get('resource'),MCP_URL);
    assert.equal(authUrl.searchParams.get('client_id'),'oauth_public_client');
    assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');
    assert.equal(form.get('code_verifier')?.length>42,true);
    assert.equal(await pkceChallenge(form.get('code_verifier')),
      authUrl.searchParams.get('code_challenge'));
    chrome.identity.launchWebAuthFlow=async()=>redirect+'?state=wrong&code=sample-code';
    await assert.rejects(interactiveAuthorization(),/state 驗證失敗/);
    assert.equal(exchanges,1);
  }finally{
    globalThis.fetch=beforeFetch;globalThis.chrome=beforeChrome;
  }
});

test('OAuth fails before navigation for a mismatched installed Extension ID',async()=>{
  const previousFetch=globalThis.fetch, previousChrome=globalThis.chrome;
  const {getOAuthConfiguration}=await import('../extensions/loc-galaxy/oauth.mjs');
  globalThis.fetch=async url=>{
    const uri=String(url);
    if(uri.endsWith('/config.json'))return Response.json({issuer:ISSUER,resource:MCP_URL,client_id:'public_client_123'});
    if(uri.endsWith('/.well-known/oauth-authorization-server'))return Response.json({
      issuer:ISSUER,authorization_endpoint:ISSUER+'/oauth/authorize',
      token_endpoint:ISSUER+'/oauth/token',code_challenge_methods_supported:['S256']
    });
    throw Error('unexpected URL');
  };
  let launched=false;
  globalThis.chrome={identity:{
    getRedirectURL:()=> 'https://differentid.chromiumapp.org/loc-galaxy',
    launchWebAuthFlow:async()=>{launched=true;return '';}
  }};
  try{
    await getOAuthConfiguration();
    await assert.rejects(interactiveAuthorization(),/Extension ID.*回呼網址/);
    assert.equal(launched,false);
  }finally{
    globalThis.fetch=previousFetch;
    globalThis.chrome=previousChrome;
  }
});

test('website session bridge does not transfer default Clerk Session Token',()=>{
  const worker=read('extensions/loc-galaxy/background.mjs');
  const source=read('public/extension/website-bridge.mjs');
  const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
  const html=read('public/extension/auth-bridge.html');
  assert.equal(manifest.version,'0.6.0');
  assert.deepEqual(manifest.externally_connectable.matches,['https://loc.lo3rwang.cc/*']);
  assert.match(worker,/chrome\.runtime\.onMessageExternal/);
  assert.match(worker,/url\.origin!==LOC_ORIGIN/);
  assert.match(worker,/pending\.nonce===message\.nonce/);
  assert.match(worker,/verifyScopeAuthorization\(token,scopeid\)/);
  assert.match(worker,/auth\.mode==='website'/);
  assert.match(source,/getToken\(\{template:TEMPLATE,skipCache:true\}\)/);
  assert.match(source,/loc-mcp/);
  assert.match(source,/claims\.aud/);
  assert.match(source,/chrome\.runtime\.sendMessage\(EXTENSION_ID/);
  assert.doesNotMatch(source,/document\.cookie|localStorage/);
  assert.match(html,/no-referrer/);
});

test('one-minute website template tokens and missing external replies are differentiated',()=>{
  const worker=read('extensions/loc-galaxy/background.mjs');
  const bridge=read('public/extension/website-bridge.mjs');
  const oauth=read('extensions/loc-galaxy/oauth.mjs');
  assert.match(worker,/Number\(access\.expires_at\)>Date\.now\(\)\+15_000/);
  assert.doesNotMatch(worker,/Number\(access\.expires_at\)>Date\.now\(\)\+60_000/);
  assert.match(bridge,/Extension 未回覆網站授權要求/);
  assert.match(bridge,/Chrome 無法送達 LOC Galaxy Extension/);
  assert.match(oauth,/LOC MCP '\+name\+' 失敗/);
  assert.match(oauth,/data\.result\.content/);
});
