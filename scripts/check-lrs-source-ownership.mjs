#!/usr/bin/env node
/** Keep standalone LRS game code/effects outside LOC; shared CSS and Scope pages are LOC-owned. */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {isLrsWebAsset} from './lrs-static-publish-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})
 .split(String.fromCharCode(0)).filter(Boolean);
const isDuplicate=p=>{
 if(p==='app/daily/log/DailyLogClient.jsx'||p==='app/daily/log/daily-record-slots.mjs')return true;
 if(p.startsWith('modules/lrs/')||p.startsWith('modules/lrune/'))return true;
 if(p.startsWith('public/vendor/effekseer/')||p.startsWith('public/vendor/rune-semantic-icons/'))return true;
 if(p==='assets/site/icons/lrunes-favicon.png'||p==='LunarRunesCardCut.pdf')return true;
 if(isLrsWebAsset(p))return true;
 if(/^scripts\/(?:prepare-rune-|rune-effekseer-|diagnose-effekseer-smoke)/.test(p))return true;
 return false;
};
const duplicate=files.filter(isDuplicate);
if(duplicate.length)throw Error('LOC tracks '+duplicate.length+' duplicate LRS-owned paths: '+duplicate.slice(0,10).join(', '));
console.log('[loc:lrs] LOC owns only its Scope, CSS and pictures; no LRS game code or effects.');
