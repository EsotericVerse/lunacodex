import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const workflow=readFileSync(new URL('../.github/workflows/ios-device-build.yml',import.meta.url),'utf8');
const marker='      - name: Validate current version and optional release tag\n';
const start=workflow.indexOf(marker);
assert.ok(start!==-1,'IPA metadata step must exist');
const runStart=workflow.indexOf('        run: |\n',start);
const runEnd=workflow.indexOf('\n      - run: npm ci',runStart);
assert.ok(runStart>start&&runEnd>runStart,'IPA metadata shell must be identifiable');
const script=workflow.slice(runStart+'        run: |\n'.length,runEnd)
  .split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');

test('LOC IPA metadata does not require LRS SHA or repo',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'las-ipa-metadata-'));
  try{
    const version='1.1.1-rc.1';
    writeFileSync(join(tmp,'package.json'),JSON.stringify({version}));
    writeFileSync(join(tmp,'package-lock.json'),JSON.stringify({version,packages:{'':{version}}}));
    const bin=join(tmp,'bin');
    mkdirSync(bin);
    const locSha='abcdef0123456789abcdef0123456789abcdef01';
    writeFileSync(join(bin,'git'),'#!/bin/sh\nprintf "%s\\n" '+locSha+'\n',{mode:0o755});
    const output=join(tmp,'GITHUB_OUTPUT');
    const env={...process.env,GITHUB_OUTPUT:output,PATH:bin+':'+process.env.PATH};
    for(const tag of ['','v'+version]){
      const run=spawnSync('bash',['-e','-c',script],{
        cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:tag},encoding:'utf8'
      });
      assert.equal(run.status,0,run.stderr||run.stdout);
      const lines=readFileSync(output,'utf8').trim().split('\n').slice(-5);
      const values=Object.fromEntries(lines.map(line=>{
        const n=line.indexOf('=');
        assert.ok(n>0,'Invalid GITHUB_OUTPUT line: '+line);
        return [line.slice(0,n),line.slice(n+1)];
      }));
      assert.deepEqual(values,{
        version,base_version:'1.1.1',
        ipa_name:'LOC-'+version+'-device-unsigned.ipa',
        release_tag:tag,loc_sha:locSha
      });
    }
    const denied=spawnSync('bash',['-e','-c',script],{
      cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:'v0.0.0'},encoding:'utf8'
    });
    assert.notEqual(denied.status,0,'Mismatched release tag must fail guard');
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
