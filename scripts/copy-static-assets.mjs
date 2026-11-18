import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'out');

const assetsSource=path.join(root,'assets');
const assetsTarget=path.join(output,'assets');
const native=process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1';
if(!fs.existsSync(assetsSource))throw new Error('Static asset source missing: assets');
fs.rmSync(assetsTarget,{recursive:true,force:true});
// Master artwork and original pics are selectively published below, never twice.
const unpublishedSource=path.join(assetsSource,'lunarunes','source');
const pictureOriginals=path.join(assetsSource,'pics');
fs.cpSync(assetsSource,assetsTarget,{recursive:true,
  filter:source=>![unpublishedSource,pictureOriginals].some(
    folder=>source===folder||source.startsWith(folder+path.sep))});

// LOC pics/ is independent from LRS and is published on LOC Web.
// Native packaging continues to exclude non-ASCII raw card filenames.
const picsSource=path.join(assetsSource,'pics');
const picsTarget=path.join(output,'pics');
const EXCLUDED_PICS_DIRS=native?[path.join(picsSource,'64Card_org')]:[];
if(!fs.existsSync(picsSource))throw new Error('Static asset source missing: pics');
fs.rmSync(picsTarget,{recursive:true,force:true});
fs.cpSync(picsSource,picsTarget,{recursive:true,
  filter:source=>!EXCLUDED_PICS_DIRS.some(excluded=>source===excluded||source.startsWith(excluded+path.sep))});

console.log(`[static-assets] LOC ${native?'native':'Web'} assets published from LOC repository only.`);
