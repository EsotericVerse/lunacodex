#!/usr/bin/env node
/** Fail a LOC build if the repository starts tracking a second LRS code/art source.
 * LOC keeps Next routing, LOC DB/authorization adapters and the existing native
 * handoff; the single LRS source is consumed at an immutable Git revision.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {isLrsWebAsset} from './lrs-static-publish-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=JSON.parse(readFileSync(join(root,'config/lrs-source.json'),'utf8'));
if(release.schema!=='loc.lrs-pinned-source.v1'||
  release.repository!=='EsotericVerse/lunarunes'||
  !/^[a-f0-9]{40}$/.test(release.sourceCommit))
 throw Error('LOC LRS integration is not pinned to a verified Git revision');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})
 .split(String.fromCharCode(0)).filter(Boolean);
const isDuplicate=p=>{
 if(p.startsWith('app/lrunes/')&&p!=='app/lrunes/rune-asset-origin.mjs'&&!p.endsWith('/page.jsx'))return true;
 if(p==='app/daily/log/DailyLogClient.jsx'||p==='app/daily/log/daily-record-slots.mjs')return true;
 if(['app/styles/runes.css','app/styles/home-runes.css'].includes(p))return true;
 if(p.startsWith('modules/lrs/')||p.startsWith('modules/lrune/'))return true;
 if(p.startsWith('public/vendor/effekseer/')||p.startsWith('public/vendor/rune-semantic-icons/'))return true;
 if(p==='assets/site/icons/lrunes-favicon.png'||p==='LunarRunesCardCut.pdf')return true;
 if(isLrsWebAsset(p))return true;
 if(/^scripts\/(?:prepare-rune-|rune-effekseer-|diagnose-effekseer-smoke)/.test(p))return true;
 return false;
};
const duplicate=files.filter(isDuplicate);
if(duplicate.length)throw Error('LOC tracks '+duplicate.length+' duplicate LRS-owned paths: '+duplicate.slice(0,10).join(', '));
console.log('[loc:lrs] No checked-in LRS code or art; source SHA '+release.sourceCommit);
