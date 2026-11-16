import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./consume-lrs-ios-artifacts.mjs',import.meta.url));
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const tmp=mkdtempSync(join(tmpdir(),'las-ios-runes-'));
  const source=join(tmp,'lrs','dist','ios');
  const out=join(tmp,'loc','out');
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'index.html'),'<html></html>');
  const records=[];
  function add(path,bytes){
    const full=join(source,...path.split('/'));
    mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,bytes);
    records.push({path,bytes:bytes.length,sha256:digest(bytes)});
  }
  for(let i=0;i<67;i++){
    const name=String(i).padStart(2,'0');
    add('assets/lunarunes/cards/'+name+'.png',
      Buffer.concat([pngSignature,Buffer.from('original-'+name)]));
  }
  for(let i=1;i<=9;i++)add('assets/pics/'+String(i).padStart(2,'0')+'.jpg',
    Buffer.from('original-group-'+i));
  add('assets/site/icons/lrunes-favicon.png',Buffer.from('original-icon'));
  add('vendor/effekseer/NOTICE.txt',Buffer.from('original-attribution'));
  const manifest={schema:'lunarunes.artifacts.v1',target:'ios',
    sourceCommit:'0123456789abcdef0123456789abcdef01234567',
    includesEffects:false,files:records};
  const manifestPath=join(source,'rune-artifacts.json');
  writeFileSync(manifestPath,JSON.stringify(manifest));
  const run=()=>spawnSync(process.execPath,[script,source,out],{encoding:'utf8'});
  return {tmp,source,out,manifest,manifestPath,run};
}
test('LRS art-only handoff copies 67 real Rune cards, nine group arts and attribution',()=>{
  const x=fixture();
  try{
    const r=x.run();
    assert.equal(r.status,0,r.stderr||r.stdout);
    assert.match(r.stdout,/67 Rune cards, 9 groups/);
    for(const entry of x.manifest.files){
      const actual=readFileSync(join(x.out,...entry.path.split('/')));
      assert.equal(digest(actual),entry.sha256,'Native file must match original: '+entry.path);
    }
    assert.equal(x.run().status,0,'Repeating an identical handoff should be safe');
  }finally{rmSync(x.tmp,{recursive:true,force:true});}
});
test('LRS handoff fails before copying anything if a source checksum is wrong',()=>{
  const x=fixture();
  try{
    writeFileSync(join(x.source,'assets/lunarunes/cards/36.png'),Buffer.from('tampered'));
    const r=x.run();
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/checksum mismatch/);
    assert.equal(existsSync(join(x.out,'assets/lunarunes/cards/00.png')),false);
  }finally{rmSync(x.tmp,{recursive:true,force:true});}
});
test('LRS handoff rejects arbitrary paths and conflicts with an existing LOC native asset',()=>{
  const x=fixture();
  try{
    const changed={...x.manifest,files:[...x.manifest.files,{
      path:'../unsafe.txt',bytes:4,sha256:digest(Buffer.from('test'))
    }]};
    writeFileSync(x.manifestPath,JSON.stringify(changed));
    let r=x.run();
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Invalid, duplicate, or out-of-scope/);
    assert.equal(existsSync(join(x.out,'assets/lunarunes/cards/00.png')),false);
    writeFileSync(x.manifestPath,JSON.stringify(x.manifest));
    const old=join(x.out,'assets/lunarunes/cards/00.png');
    mkdirSync(dirname(old),{recursive:true});
    writeFileSync(old,Buffer.from('different older LOC image'));
    r=x.run();
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Conflicting existing LOC iOS asset/);
    assert.equal(existsSync(join(x.out,'assets/lunarunes/cards/01.png')),false);
  }finally{rmSync(x.tmp,{recursive:true,force:true});}
});
