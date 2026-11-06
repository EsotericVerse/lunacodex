import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('website bridge fallback is loaded, without broadening external origins',()=>{
  const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
  const entry=read('extensions/loc-galaxy/background-entry.mjs');
  const fallback=read('extensions/loc-galaxy/website-grant-fallback.mjs');
  assert.equal(manifest.version,'0.6.8');
  assert.equal(manifest.background.service_worker,'background-entry.mjs');
  assert.deepEqual(manifest.externally_connectable.matches,['https://loc.lo3rwang.cc/*']);
  assert.match(entry,/import '\.\/background-core\.mjs'/);
  assert.match(entry,/import '\.\/website-grant-fallback\.mjs'/);
  assert.match(fallback,/if\(message\?\.type!==/);
  assert.match(fallback,/validGrant\(pending,nonce,scopeid,now,300000,sender\)/);
  assert.match(fallback,/u\.searchParams\.get\('nonce'\)===nonce/);
  assert.match(fallback,/u\.searchParams\.get\('scopeid'\)===scopeid/);
  assert.match(fallback,/verifyScopeAuthorization\(token,scopeid\)/);
  assert.match(fallback,/await chrome\.storage\.session\.remove\(PENDING\)/);
  assert.doesNotMatch(fallback,/document\.cookie|localStorage/);
});

test('0.6.2 has exactly one active website external grant listener',()=>{
 const entry=read('extensions/loc-galaxy/background-entry.mjs');
 const core=read('extensions/loc-galaxy/background-core.mjs');
 const site=read('extensions/loc-galaxy/website-grant-fallback.mjs');
 assert.doesNotMatch(entry,/import '\.\/background\.mjs'/);
 assert.doesNotMatch(core,/onMessageExternal\.addListener/);
 assert.equal((site.match(/onMessageExternal\.addListener/g)||[]).length,1);
 assert.doesNotMatch(site,/if\(sender\.tab\?\.id\|\|/);
});

test('Clerk token acquisition waits for a verified Extension communication probe',()=>{
 const bridge=read('public/extension/website-bridge.mjs');
 const listener=read('extensions/loc-galaxy/website-grant-fallback.mjs');
 assert.match(bridge,/type:'locGalaxy\.bridgeProbe'/);
 assert.match(bridge,/if\(!probe\.ok\)throw Error/);
 assert.match(bridge,/probe\.data\?\.protocol!==1/);
 assert.ok(bridge.indexOf("type:'locGalaxy.bridgeProbe'")<bridge.indexOf("const clerk=await loadClerk()"));
 assert.match(listener,/message\?\.type!=='locGalaxy\.bridgeProbe'/);
 assert.match(listener,/protocol:1,version:chrome\.runtime\.getManifest\(\)\.version/);
 assert.match(listener,/validGrant\(pending,nonce,scopeid,now,300000,sender\)/);
 assert.match(listener,/validGrant\(active,nonce,scopeid,now,86400000,sender\)/);
});

test('Bridge trusts browser sender.origin; nonce and Scope remain bound to created tab',()=>{
  const listener=read('extensions/loc-galaxy/website-grant-fallback.mjs');
  assert.match(listener,/if\(sender\?\.origin!==undefined\)return sender\.origin===LOC_ORIGIN/);
  assert.doesNotMatch(listener,/page\(sender\.url,nonce,scopeid\)/);
  assert.match(listener,/record\.nonce!==nonce/);
  assert.match(listener,/record\.scopeid!==scopeid/);
  assert.match(listener,/now-record\.created>=maxAge/);
});

test('External website origin-only sender passes when extension-created tab binds nonce and Scope',async()=>{
  const source=read('extensions/loc-galaxy/website-grant-fallback.mjs')
    .replace(/^import[^\n]*\n/,'');
  let listener;
  const nonce='x'.repeat(43),scopeid='lo3rwang';
  const url='https://loc.lo3rwang.cc/extension/auth-bridge.html?scopeid='+scopeid+'&nonce='+nonce;
  const chrome={
    runtime:{onMessageExternal:{addListener:fn=>{listener=fn;}},
      getManifest:()=>({version:'0.6.8'})},
    storage:{session:{get:async()=>({'locGalaxy.websitePending':{nonce,scopeid,tabId:7,created:Date.now()}})},
      local:{get:async()=>({'locGalaxy.scopeid':scopeid})}},
    tabs:{get:async()=>({url})}
  };
  new Function('chrome','LOC_ORIGIN','verifyScopeAuthorization','mcpTool',source)(
    chrome,'https://loc.lo3rwang.cc',async()=>({subject:'user_test'}),async()=>({subject:'user_test'}));
  const send=(sender)=>new Promise(resolve=>{
    listener({type:'locGalaxy.bridgeProbe',nonce,scopeid},sender,resolve);
  });
  assert.deepEqual(await send({origin:'https://loc.lo3rwang.cc'}),{
    ok:true,data:{bridge:true,protocol:1,version:'0.6.8'}
  });
  const rejected=await send({origin:'https://other.example'});
  assert.equal(rejected.ok,false);
  assert.match(rejected.error,/不是 LOC 官方網站/);
});

test('bridge probe rejects expired and absent pending grants before Clerk JWT',async()=>{
 const source=read('extensions/loc-galaxy/website-grant-fallback.mjs').replace(/^import[^\n]*\n/,'');
 const nonce='y'.repeat(43),scopeid='lo3rwang';
 let listener,stored={nonce,scopeid,tabId:10,created:Date.now()-300001};
 const chrome={runtime:{onMessageExternal:{addListener:fn=>{listener=fn;}},getManifest:()=>({version:'0.6.8'})},
   storage:{session:{get:async()=>({'locGalaxy.websitePending':stored})},local:{get:async()=>({'locGalaxy.scopeid':scopeid})}}};
 new Function('chrome','LOC_ORIGIN','verifyScopeAuthorization','mcpTool',source)(chrome,'https://loc.lo3rwang.cc',()=>{},()=>{});
 const send=()=>new Promise(resolve=>listener({type:'locGalaxy.bridgeProbe',nonce,scopeid},{origin:'https://loc.lo3rwang.cc'},resolve));
 assert.match((await send()).error,/有效期限/);
 stored=null;
 assert.match((await send()).error,/沒有待處理/);
});

test('Clerk JWT is minted only on demand; no background 30-second alarms',()=>{
 const page=read('public/extension/website-bridge.mjs');
 const worker=read('extensions/loc-galaxy/background-core.mjs');
 const listener=read('extensions/loc-galaxy/website-grant-fallback.mjs');
 assert.doesNotMatch(page,/setInterval\(renewWhenDue|nextRenewAt=/);
 assert.match(page,/window\.addEventListener\('locGalaxy\.websiteRenew'/);
 assert.match(worker,/async function renewWebsiteAccess\(scopeid\)/);
 assert.match(worker,/if\(renewalFlight\)return renewalFlight/);
 assert.match(worker,/renewalBlockedUntil=Date\.now\(\)\+10000/);
 assert.match(worker,/await chrome\.scripting\.executeScript/);
 assert.doesNotMatch(worker,/periodInMinutes:0\.5/);
 assert.doesNotMatch(listener,/chrome\.alarms\.create/);
});
test('right-click ChatGPT archive reuses the existing capture controller',()=>{
 const worker=read('extensions/loc-galaxy/background-core.mjs');
 const capture=read('extensions/loc-galaxy/capture-manager.mjs');
 const manifest=JSON.parse(read('extensions/loc-galaxy/manifest.json'));
 assert.ok(manifest.permissions.includes('contextMenus'));
 assert.deepEqual(manifest.optional_host_permissions,['https://chatgpt.com/*']);
 assert.match(worker,/chrome\.contextMenus\.onClicked\.addListener/);
 assert.match(worker,/capture\.archiveActive\(tab\.id\)/);
 assert.match(worker,/capture\.sync\(\)/);
 assert.match(worker,/chrome\.permissions\.request\(\{origins:\['https:\/\/chatgpt\.com\/\*'\]\}\)/);
 assert.match(capture,/async function archiveActive\(requestedTabId=null\)/);
 assert.match(capture,/await chrome\.tabs\.get\(requestedTabId\)/);
});
