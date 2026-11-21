import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../app/',import.meta.url);
function pageSources(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(x=>
    x.isDirectory()?pageSources(join(dir,x.name)):
      x.name==='page.html'?[join(dir,x.name)]:[]);
}
const authored=pageSources(new URL(root).pathname);
const build=readFileSync(new URL('../scripts/build-loc-static.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('../app/loc/runtime/html-entry.jsx',import.meta.url),'utf8');
const render=readFileSync(new URL('../scripts/render-public-home.jsx',import.meta.url),'utf8');
const check=readFileSync(new URL('../scripts/verify-loc-output.mjs',import.meta.url),'utf8');
test('native HTML pages contain their own feature slot',()=>{
  assert.match(build,/renderPublicFeatureFrame/);
  assert.match(render,/id="loc-interactive-root"/);
  assert.match(render,/PublicNavigation scopeId/);
  assert.match(render,/PublicDock scopeId/);
  assert.doesNotMatch(build,/entry-'\+i\+'\.jsx/);
  assert.match(check,/Per-page React entrypoint emitted/);
});
test('on-demand React does not mount an AppShell or a router',()=>{
  assert.match(entry,/document\.body\.dataset/);
  assert.match(entry,/document\.getElementById\('loc-interactive-root'\)/);
  assert.match(entry,/createRoot\(node\)/);
  assert.doesNotMatch(entry,/import AppShell/);
  assert.match(entry,/LocFeature/);
  assert.match(entry,/PhoneWorkspace/);
  assert.match(entry,/ExtensionBridge/);
});
test('LRS links are published HTML instead of React redirects',()=>{
  assert.match(build,/outbound\?'<script>/);
  assert.match(check,/LRS outbound HTML must link directly/);
});

test('every source route is an authored HTML document, not JSX',()=>{
  assert.equal(authored.length,80);
  for(const file of authored){
    assert.equal(existsSync(file.replace(/page\.html$/,'page.jsx')),false,file);
    const html=readFileSync(file,'utf8');
    assert.match(html,/<html lang="zh-Hant">/);
    assert.match(html,/<body data-loc-component="/);
    assert.match(html,/data-loc-view="/);
    assert.match(html,/data-loc-scope="/);
  }
  assert.match(build,/item\.name==='page.html'/);
  assert.doesNotMatch(build,/page\.jsx/);
});

test('iOS local lease stays bounded without a global application shell',()=>{
  assert.match(entry,/hasExpiredLocalDeadline\(\)/);
  assert.match(entry,/getLocalDeadline\(\)>0/);
  assert.match(entry,/stopLocalDeadline\(\)/);
  assert.match(entry,/window\.location\.replace\('\/local\/index\.html'\)/);
});

test('native static pages enforce local lease before mounting a feature',()=>{
  const theme=readFileSync(new URL('../app/modular/runtime/theme-bootstrap.mjs',import.meta.url),'utf8');
  assert.match(theme,/loc-device-local-core-until-v1/);
  assert.match(theme,/window\.location\.replace\('\/local\/index\.html'\)/);
  assert.match(theme,/window\.localStorage\.removeItem\(key\)/);
});
