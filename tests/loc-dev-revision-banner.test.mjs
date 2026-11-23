import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('predev prints source revision before any generated assets or Next startup',()=>{
  const packageInfo=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(packageInfo.scripts.predev,/^node scripts\/print-local-code-revision\.mjs && /);
  const expected=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8'});
  const actual=spawnSync(process.execPath,['scripts/print-local-code-revision.mjs'],{
    cwd:root,encoding:'utf8',windowsHide:true
  });
  assert.equal(actual.status,0,actual.stderr);
  if(expected.status===0){
    assert.match(actual.stdout,/\[loc-code\] Local branch:/);
    assert.ok(actual.stdout.includes('[loc-code] Local HEAD: '+expected.stdout.trim()));
  }else{
    assert.match(actual.stdout,/Git commit unavailable/);
  }
});
