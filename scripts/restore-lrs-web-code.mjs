#!/usr/bin/env node
/**
 * LOC Web borrows the exact, immutable LRS SOURCE revision for its small
 * LOC-owned daily/culture/statistics adapters. Never tracks a second LRS
 * implementation or copies cards, photos, Effekseer, WASM or other media.
 *
 * Native packaging is separate: restore-lrs-native-ui.mjs consumes the
 * workflow's explicitly pinned LRS checkout and this script MUST NOT run.
 */
import {spawnSync} from 'node:child_process';
import {readFile,readdir,mkdir,copyFile,rm,stat} from 'node:fs/promises';
import {join,dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {adaptRestoredLrsLocale} from './adapt-lrs-locale-imports.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(await readFile(join(root,'config/lrs-source.json'),'utf8'));
const SHA=/^[a-f0-9]{40}$/;
if(cfg.schema!=='loc.lrs-pinned-source.v1'||
 cfg.repository!=='EsotericVerse/lunarunes'||!SHA.test(cfg.sourceCommit)||
 !/^(?:[0-9]+(?:\.[0-9]+)?R|[0-9]+\.[0-9]+\.[0-9]+)$/.test(cfg.releaseVersion))throw Error('Invalid immutable LRS source contract');
if(process.env.LOC_NATIVE_RUNE_ASSETS==='1'||process.env.NEXT_PUBLIC_LOC_NATIVE_BUNDLE==='1'){
 console.log('[loc:lrs] Native flow owns pinned full Rune UI; Web source restore skipped');
 process.exit(0);
}
function git(args,{cwd=root}={}){
 const cmd=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
 if(cmd.error||cmd.status!==0)throw Error('Pinned LRS Git operation failed: '+
  args.slice(0,3).join(' ')+' '+String(cmd.stderr||cmd.error||'').slice(0,300));
 return cmd.stdout.trim();
}
const cache=join(root,'node_modules','.cache','loc-lrs-source',cfg.sourceCommit);
let ready=false;
try{ready=git(['-C',cache,'rev-parse','HEAD'])===cfg.sourceCommit;}catch{}
if(!ready){
 await rm(cache,{recursive:true,force:true});
 await mkdir(cache,{recursive:true});
 git(['init','-q',cache]);
 git(['-C',cache,'remote','add','origin','https://github.com/EsotericVerse/lunarunes.git']);
 git(['-C',cache,'sparse-checkout','init','--no-cone']);
 git(['-C',cache,'sparse-checkout','set','--no-cone',
  '/app/lrunes/**','/app/daily/log/**',
  '/app/styles/runes.css','/app/styles/home-runes.css',
  '/modules/lrs/**','/release/version.json']);
 git(['-C',cache,'-c','protocol.version=2','fetch','--depth=1','--filter=blob:none','origin',cfg.sourceCommit]);
 git(['-C',cache,'checkout','--detach','FETCH_HEAD']);
}
if(git(['-C',cache,'rev-parse','HEAD'])!==cfg.sourceCommit)
 throw Error('LRS source checkout differs from immutable SHA');
const version=JSON.parse(await readFile(join(cache,'release/version.json'),'utf8'));
if(version.schema!=='lunarunes.release-version.v1'||version.version!==cfg.releaseVersion)
 throw Error('Pinned LRS source version does not match LOC integration contract');

// A checked-in LOC Rune implementation is forbidden. LOC-owned Next routes,
// its Rune asset origin adapter and data/authorization adapters are retained.
const tracked=new Set(git(['ls-files','-z']).split(String.fromCharCode(0)).filter(Boolean));
const wanted=[];
const allowed=/\.(?:jsx?|mjs|tsx?|css|json)$/i;
async function collect(dir){
 let entries;try{entries=await readdir(join(cache,dir),{withFileTypes:true});}
 catch(error){if(error?.code==='ENOENT')return;throw error;}
 for(const item of entries){
  if(item.isSymbolicLink())throw Error('LRS source symlink is forbidden');
  const rel=dir+'/'+item.name;
  if(item.isDirectory()){await collect(rel);continue;}
  if(!item.isFile()||!allowed.test(rel)||rel.endsWith('/page.jsx'))continue;
  if(rel==='app/lrunes/rune-asset-origin.mjs')continue;
  if(tracked.has(rel))throw Error('LOC still tracks duplicate LRS source: '+rel);
  wanted.push(rel);
 }
}
for(const dir of ['app/lrunes','app/daily/log','modules/lrs'])
 await collect(dir);
for(const file of ['app/styles/runes.css','app/styles/home-runes.css']){
 if(tracked.has(file))throw Error('LOC still tracks duplicate LRS source style: '+file);
 if(!(await stat(join(cache,file))).isFile())throw Error('Missing LRS source: '+file);
 wanted.push(file);
}
for(const file of ['app/lrunes/DailyRuneAnalytics.jsx',
 'app/lrunes/DailyRuneCalendarSettings.jsx','app/daily/log/DailyLogClient.jsx',
 'modules/lrs/rune/rune-directory.mjs','modules/lrs/rune/asset-url.mjs']){
 if(!wanted.includes(file))throw Error('Pinned LRS revision lacks required runtime source: '+file);
}
for(const rel of wanted){
 const dest=resolve(root,...rel.split('/'));
 if(!dest.startsWith(root+sep))throw Error('Unsafe LRS source destination');
 await mkdir(dirname(dest),{recursive:true});
 await copyFile(join(cache,...rel.split('/')),dest);
}
await adaptRestoredLrsLocale(root);
console.log('[loc:lrs] Source-only '+cfg.releaseVersion+' @ '+cfg.sourceCommit.slice(0,12)+
 ': '+wanted.length+' code files, no media, no LOC copies committed');
