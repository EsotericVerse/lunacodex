// Ship EXACTLY the Extension's original LunArcus rainbow Hero with the iOS
// static export. A build-time copy avoids network images in the native App
// and does not fork, recolor, re-encode or duplicate the creative asset.
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const source=path.join(root,'extensions','loc-galaxy-link','assets','lunarcus-rainbow-hero.avif');
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
  if(!fs.existsSync(source))throw new Error('Required native Galaxy Link Hero source is missing');
  for(const target of targets){
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target);
  }
  console.log('[local-scope] packaged unchanged native Extension Hero artwork');
}
