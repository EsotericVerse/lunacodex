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
if(!fs.existsSync(source))throw new Error('Galaxy Link Hero source file is missing');
for(const target of targets){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(source,target);
}
console.log('[local-scope] using the Extension Hero artwork unchanged');
