// Ship EXACTLY the Extension's original LunArcus rainbow Hero with the iOS
// static export. A build-time copy avoids network images in the native App
// and does not fork, recolor, re-encode or duplicate the creative asset.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
const legacySource=path.join(root,'extensions','loc-galaxy-link','assets','lunarcus-rainbow-hero.avif');
const {readFileSync}=fs;
const cfg=JSON.parse(readFileSync(path.join(root,'config','las-native-hero.json'),'utf8'));
if(cfg.schema!=='loc.las-native-hero.v1'||cfg.repository!=='EsotericVerse/lunarcus'||
   !/^[a-f0-9]{40}$/.test(cfg.sourceCommit)||
   cfg.sourcePath!=='plugins/chrome/assets/lunarcus-rainbow-hero.avif')
  throw new Error('Invalid LAS native Hero source contract');
const lasCheckout=path.resolve(root,'../las-source');
const source=fs.existsSync(legacySource)?legacySource:path.join(lasCheckout,...cfg.sourcePath.split('/'));
function verifyLasSource(){
  if(source===legacySource)return;
  const result=spawnSync('git',['-C',lasCheckout,'rev-parse','HEAD'],{encoding:'utf8'});
  if(result.status!==0||result.stdout.trim()!==cfg.sourceCommit)
    throw new Error('LAS native Hero checkout is missing or does not match pinned source SHA');
}

const targets=[
  path.join(root,'assets','site','local','lunarcus-rainbow-hero.avif'),
  path.join(root,'public','assets','site','local','lunarcus-rainbow-hero.avif')
];
// This LAS-owned artwork is only packaged for the LOC native application.
// Web-only builds must not depend on a file removed from LOC when Extension
// ownership moved to LAS. Never substitute unrelated LOC/LRS artwork.
if(process.env.LOC_NATIVE_RUNE_ASSETS!=='1'){
  console.log('[local-scope] skipping LAS-owned native Hero in LOC Web build');
}else{
  verifyLasSource();
  if(!fs.existsSync(source))throw new Error('Required native Galaxy Link Hero source is missing');
  for(const target of targets){
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
  }
  console.log('[local-scope] packaged unchanged native Extension Hero artwork');
}
