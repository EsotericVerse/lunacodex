import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','scripts','copy-static-assets.mjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'loc-static-assets-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  function write(relative,content='fixture'){
    const file=path.join(root,relative);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,content);
  }
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  fs.copyFileSync(source,path.join(root,'scripts','copy-static-assets.mjs'));
  write('out/index.html','<html>LOC</html>');
  for(const name of [
    'assets/site/icons/loc-favicon.png',
    'assets/site/local/lunarcus-rainbow-hero.avif'
  ]){
    write('public/'+name);
    write('out/'+name);
  }
  write('public/pics/home.jpg');
  write('out/pics/home.jpg');
  const run=(native=false)=>spawnSync(process.execPath,
    [path.join(root,'scripts','copy-static-assets.mjs')],{
      cwd:root,encoding:'utf8',
      env:{...process.env,LOC_NATIVE_BUNDLE:native?'1':'0'}
    });
  return {root,write,run};
}
test('verifies an existing export without copying the authored assets tree',t=>{
  const f=fixture(t);
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/export verified/);
  assert.equal(fs.existsSync(path.join(f.root,'out/assets/pics')),false);
  assert.equal(fs.existsSync(path.join(f.root,'out/assets/site/icons/loc-app-emblem.png')),false);
});
test('fails instead of silently recopying missing site assets',t=>{
  const f=fixture(t);
  fs.rmSync(path.join(f.root,'out/assets/site/icons/loc-favicon.png'));
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Static export missing/);
  assert.equal(fs.existsSync(path.join(f.root,'out/assets/site/icons/loc-favicon.png')),false);
});
test('rejects an extra stale image from a previous export',t=>{
  const f=fixture(t);
  f.write('out/pics/stale.jpg');
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/differs from staged public\/pics/);
});
test('rejects mismatched output files',t=>{
  const f=fixture(t);
  f.write('out/pics/home.jpg','different contents');
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/asset size mismatch/);
});
test('keeps native raw card originals out of the packaged site',t=>{
  const f=fixture(t);
  f.write('public/pics/64Card_org/raw.png');
  f.write('out/pics/64Card_org/raw.png');
  const result=f.run(true);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/must not include raw card originals/);
});
