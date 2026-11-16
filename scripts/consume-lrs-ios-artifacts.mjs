#!/usr/bin/env node
/**
 * LOC iOS packaging: copy verified, real Rune files into the existing
 * LOC static export. LOC Web remains URL-only once the LRS service goes live.
 * No image regeneration, code rewriting, cache, remote download, or new IPA.
 *
 * Usage: node scripts/consume-lrs-ios-artifacts.mjs <LRS dist/ios> <LOC out>
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join,resolve,sep,dirname,posix} from 'node:path';

const [sourceArg,exportArg,...extra]=process.argv.slice(2);
if(!sourceArg||!exportArg||extra.length)
  throw Error('Usage: consume-lrs-ios-artifacts.mjs <LRS dist/ios> <LOC out>');
const source=resolve(sourceArg);
const exportRoot=resolve(exportArg);
if(source===exportRoot)throw Error('Rune artifacts and app export must be separate directories');
const manifest=JSON.parse(await readFile(join(source,'rune-artifacts.json'),'utf8'));
if(manifest?.schema!=='lunarunes.artifacts.v1'||manifest.target!=='ios'||
   typeof manifest.sourceCommit!=='string'||!manifest.sourceCommit||
   !Array.isArray(manifest.files))
  throw Error('Unsupported LunaRunes iOS manifest');
if(!(await lstat(join(exportRoot,'index.html'))).isFile())
  throw Error('Expected completed LOC static export; missing out/index.html');
const allowed=['assets/lunarunes/cards/','assets/pics/','assets/site/icons/',
  'vendor/effekseer/','vendor/rune-semantic-icons/'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const entries=new Map();
const cards=new Set();
const groups=new Set();
let hasNotice=false,hasFavicon=false;
for(const entry of manifest.files){
  const rel=entry?.path;
  if(typeof rel!=='string'||!rel||!allowed.some(prefix=>rel.startsWith(prefix))||
     rel.startsWith('/')||rel.includes('\\')||posix.normalize(rel)!==rel||
     rel.split('/').some(p=>!p||p==='.'||p==='..')||entries.has(rel)||
     !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
     !/^[0-9a-f]{64}$/.test(entry.sha256))
    throw Error('Invalid, duplicate, or out-of-scope LunaRunes artifact path/metadata');
  const sourceFile=resolve(source,...rel.split('/'));
  if(!sourceFile.startsWith(source+sep))throw Error('Unsafe Rune source path');
  if(!(await lstat(sourceFile)).isFile())throw Error('Rune source is not a regular file: '+rel);
  const bytes=await readFile(sourceFile);
  if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)
    throw Error('Rune file checksum mismatch: '+rel);
  if(/^assets\/lunarunes\/cards\/\d{2}\.png$/.test(rel)){
    if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
      throw Error('Invalid original Rune PNG signature: '+rel);
    cards.add(rel);
  }
  if(/^assets\/pics\/[^/]+\.(?:jpg|jpeg|png)$/i.test(rel))groups.add(rel);
  if(rel==='vendor/effekseer/NOTICE.txt')hasNotice=true;
  if(rel==='assets/site/icons/lrunes-favicon.png')hasFavicon=true;
  const dest=resolve(exportRoot,...rel.split('/'));
  if(!dest.startsWith(exportRoot+sep))throw Error('Unsafe Rune destination path');
  // Fail closed on a conflicting LOC asset; do not silently overwrite a
  // changed, still-serving native file while another Agent owns the source.
  let previous=null;
  try{previous=await readFile(dest)}
  catch(error){if(error?.code!=='ENOENT')throw error}
  if(previous!==null&&!previous.equals(bytes))
    throw Error('Conflicting existing LOC iOS asset: '+rel);
  entries.set(rel,{dest,bytes,exists:previous!==null});
}
if(cards.size!==67||groups.size!==9||!hasNotice||!hasFavicon)
  throw Error('LRS iOS artifact missing one of 67 cards, nine group arts, favicon or attribution');
for(let i=0;i<=66;i++)if(!cards.has('assets/lunarunes/cards/'+String(i).padStart(2,'0')+'.png'))
  throw Error('Missing canonical Rune card number '+i);
if(manifest.includesEffects===true){
  for(const required of ['vendor/effekseer/effekseer.js','vendor/effekseer/effekseer.wasm'])
    if(!entries.has(required))throw Error('Incomplete LRS native effect runtime: '+required);
}
// All checks succeeded before writing anything to the generated LOC export.
for(const {dest,bytes,exists} of entries.values()){
  if(exists)continue;
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,bytes,{flag:'wx'});
}
console.log('LOC iOS handoff verified: '+cards.size+' Rune cards, '+groups.size+
  ' groups; total '+entries.size+' files; effects='+Boolean(manifest.includesEffects));
