// Regression: /login is an automatic Cloudflare Access handoff, not a second
// Google/SSO chooser. No live identity, Cloudflare or database call is made.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const worker=readFileSync(new URL('../workers/loc-authority/index.mjs',import.meta.url),'utf8');
const match=/^const LOGIN_JS=("(?:(?:\\.)|[^"\\])*");$/m.exec(worker);
assert.ok(match,'LOC Auth login script exists');
assert.match(worker,/verifyOAuthQueryParams\(signedQuery,context.secret\)/);
const login=JSON.parse(match[1]);
assert.doesNotMatch(login,/sign-in\/social|google|get-session/);
assert.match(login,/sign-in\/sso/);

async function visit({q='',search='',status=200,body={url:'https://access.example.test/authorization'}}={}){
  const calls=[],navigation=[];
  const elements={status:{textContent:''},retry:{hidden:true,onclick:null}};
  const location={
    origin:'https://auth.lo3rwang.cc',search,
    replace(url){navigation.push(url)}
  };
  const context={
    OAUTH_QUERY:q,URLSearchParams,location,
    document:{getElementById(id){return elements[id]}},
    fetch:async (path,options)=>{
      calls.push({path,options,body:JSON.parse(options.body)});
      return {ok:status>=200&&status<300,json:async()=>body};
    }
  };
  runInNewContext(login,context,{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  return {calls,navigation,elements};
}

const oauth=await visit({q:'ba_param=opaque&sig=signed'});
assert.equal(oauth.calls.length,1);
assert.equal(oauth.calls[0].path,'/api/auth/sign-in/sso');
assert.equal(oauth.calls[0].body.providerId,'cloudflare-access');
assert.equal(oauth.calls[0].body.callbackURL,
  'https://auth.lo3rwang.cc/api/auth/oauth2/authorize?ba_param=opaque&sig=signed');
assert.equal(oauth.calls[0].body.errorCallbackURL,
  'https://auth.lo3rwang.cc/login?ba_param=opaque&sig=signed');
assert.deepEqual(oauth.navigation,['https://access.example.test/authorization']);

const web=await visit({search:'?return_to=%2Faccount'});
assert.equal(web.calls.length,1);
assert.equal(web.calls[0].body.callbackURL,
  'https://loc.lo3rwang.cc/login/index.html?return_to=%2Faccount&oauth_return=1');
assert.deepEqual(web.navigation,['https://access.example.test/authorization']);

const unsafe=await visit({search:'?return_to=%2F%2Fevil.example'});
assert.equal(unsafe.calls[0].body.callbackURL,
  'https://loc.lo3rwang.cc/login/index.html?return_to=%2Flocal%2Fsettings%2F&oauth_return=1');

const failed=await visit({status:503,body:{error:'SSO unavailable'}});
assert.deepEqual(failed.navigation,[]);
assert.equal(failed.elements.retry.hidden,false);
assert.match(failed.elements.status.textContent,/SSO unavailable/);

const callbackError=await visit({search:'?error=access_denied'});
assert.equal(callbackError.calls.length,0,'Failed upstream SSO must not auto-loop');
assert.equal(callbackError.elements.retry.hidden,false);
await callbackError.elements.retry.onclick();
assert.equal(callbackError.calls.length,1,'Explicit retry must initiate SSO');

console.log('PASS LOC Auth direct Cloudflare Access handoff, signed OAuth continuation, web return, failure/retry');
