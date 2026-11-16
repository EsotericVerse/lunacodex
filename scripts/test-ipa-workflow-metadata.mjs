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

test('real IPA metadata bash step emits six correct outputs with one pinned LOC SHA',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'las-ipa-metadata-'));
  try{
    const version='1.1.1-rc.1';
    writeFileSync(join(tmp,'package.json'),JSON.stringify({version}));
    writeFileSync(join(tmp,'package-lock.json'),JSON.stringify({version,packages:{'':{version}}}));
    const bin=join(tmp,'bin');
    mkdirSync(bin);
    const locSha='abcdef0123456789abcdef0123456789abcdef01';
    const runeSha='0123456789abcdef0123456789abcdef01234567';
    writeFileSync(join(bin,'git'),'#!/bin/sh\nif [ "$1" = "ls-remote" ]; then printf "%s\\trefs/heads/main\\n" '+runeSha+'; else printf "%s\\n" '+locSha+'; fi\n',{mode:0o755});
    const output=join(tmp,'GITHUB_OUTPUT');
    const env={...process.env,GITHUB_OUTPUT:output,REQUESTED_LRS_COMMIT:'',PATH:bin+':'+process.env.PATH};
    for(const tag of ['','v'+version]){
      const run=spawnSync('bash',['-e','-c',script],{
        cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:tag},encoding:'utf8'
      });
      assert.equal(run.status,0,run.stderr||run.stdout);
      const lines=readFileSync(output,'utf8').trim().split('\n').slice(-6);
      const values=Object.fromEntries(lines.map(line=>{
        const n=line.indexOf('=');
        assert.ok(n>0,'Invalid GITHUB_OUTPUT line: '+line);
        return [line.slice(0,n),line.slice(n+1)];
      }));
      assert.deepEqual(values,{
        version,base_version:'1.1.1',
        ipa_name:'LOC-'+version+'-device-unsigned.ipa',
        release_tag:tag,loc_sha:locSha,lrs_commit:runeSha
      });
    }
    const selected=spawnSync('bash',['-e','-c',script],{
      cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:'',REQUESTED_LRS_COMMIT:runeSha},encoding:'utf8'
    });
    assert.equal(selected.status,0,selected.stderr||selected.stdout);
    assert.ok(readFileSync(output,'utf8').includes('lrs_commit='+runeSha+'\n'));
    const unsafe=spawnSync('bash',['-e','-c',script],{
      cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:'',REQUESTED_LRS_COMMIT:'main'},encoding:'utf8'
    });
    assert.notEqual(unsafe.status,0,'Movable LRS branch refs are forbidden');
    const denied=spawnSync('bash',['-e','-c',script],{
      cwd:tmp,env:{...env,REQUESTED_RELEASE_TAG:'v0.0.0'},encoding:'utf8'
    });
    assert.notEqual(denied.status,0,'Mismatched release tag must fail guard');
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
