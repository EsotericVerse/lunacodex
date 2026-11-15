import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'out');

const assetsSource=path.join(root,'assets');
const assetsTarget=path.join(output,'assets');
if(!fs.existsSync(assetsSource))throw new Error('Static asset source missing: assets');
fs.rmSync(assetsTarget,{recursive:true,force:true});
// Master artwork and original pics are selectively published below, never twice.
const unpublishedSource=path.join(assetsSource,'lunarunes','source');
const pictureOriginals=path.join(assetsSource,'pics');
fs.cpSync(assetsSource,assetsTarget,{recursive:true,
  filter:source=>![unpublishedSource,pictureOriginals].some(
    folder=>source===folder||source.startsWith(folder+path.sep))});

// pics/ is copied wholesale, the same as assets/ above: any image added here
// (including new subfolders) ships to the static export automatically, with
// no per-file whitelist to maintain by hand.
//
// One exception: pics/64Card_org/ holds the 66 raw, Chinese-filename rune
// card source images (the originals the numeric assets/lunarunes/cards/
// 01.png..66.png set is derived from). Nothing in the app reads them by
// path -- the draw UI resolves cards through the numeric set instead -- and
// their non-ASCII filenames fail the iOS workflow's "ASCII-only paths
// inside the IPA" check. They still live at their real published address
// (loc.lo3rwang.cc/pics/64Card_org/...) on the deployed website; this only
// keeps them out of the static export / native app bundle.
const picsSource=path.join(assetsSource,'pics');
const picsTarget=path.join(output,'pics');
const EXCLUDED_PICS_DIRS=[path.join(picsSource,'64Card_org')];
if(!fs.existsSync(picsSource))throw new Error('Static asset source missing: pics');
fs.rmSync(picsTarget,{recursive:true,force:true});
fs.cpSync(picsSource,picsTarget,{recursive:true,
  filter:source=>!EXCLUDED_PICS_DIRS.some(excluded=>source===excluded||source.startsWith(excluded+path.sep))});

const rootDownloads=['LunarRunesCardCut.pdf'];
for(const name of rootDownloads){
  const source=path.join(assetsSource,'lunarunes','source',name);
  if(!fs.existsSync(source))throw new Error(`Static asset source missing: ${name}`);
  fs.copyFileSync(source,path.join(output,name));
}

console.log(`[static-assets] copied assets/, pics/ (whole directory) and ${rootDownloads.length} governed root downloads into out/`);
