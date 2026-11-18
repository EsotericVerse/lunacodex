import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'out');
const assetsSource=path.join(root,'assets');
const assetsTarget=path.join(output,'assets');
const picsSource=path.join(assetsSource,'pics');
const picsTarget=path.join(output,'pics');

if(!fs.existsSync(assetsSource))throw new Error('Static asset source missing: assets');
if(!fs.existsSync(picsSource))throw new Error('Static asset source missing: pics');

// Keep LOC image assets in their existing published locations.
// assets/pics is published at /pics, not duplicated under /assets/pics.
fs.rmSync(assetsTarget,{recursive:true,force:true});
fs.cpSync(assetsSource,assetsTarget,{recursive:true,
  filter:source=>source!==picsSource&&!source.startsWith(picsSource+path.sep)});
fs.rmSync(picsTarget,{recursive:true,force:true});
fs.cpSync(picsSource,picsTarget,{recursive:true});

console.log('[static-assets] LOC assets published at /assets and /pics.');
