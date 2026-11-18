#!/usr/bin/env node
/**
 * Restore native-only LunaRunes UI in the existing, temporary LOC checkout.
 * LOC Web remains link-only; no source files are committed back to LOC.
 * Native files come from the exact LunaRunes SHA checked out by LOC Actions.
 *
 * Usage: restore-lrs-native-ui.mjs <LRS checkout> <LOC checkout>
 */
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative,join,dirname,sep} from 'node:path';
import {adaptRestoredLrsLocale} from './adapt-lrs-locale-imports.mjs';

const [runeArg,locArg,...extra]=process.argv.slice(2);
if(!runeArg||!locArg||extra.length)
  throw Error('Usage: restore-lrs-native-ui.mjs <LRS checkout> <LOC checkout>');
const lrs=resolve(runeArg),loc=resolve(locArg);
if(lrs===loc||lrs.startsWith(loc+sep)||loc.startsWith(lrs+sep))
  throw Error('LOC and LRS checkout directories must be separate');

const originalFiles=['app/lrunes/RuneUnifiedView.jsx',
  'app/card/page.jsx','app/card/duel/page.jsx','app/daily/log/DailyLogClient.jsx',
  'app/game/page.jsx','modules/lrs/rune/rune-directory.mjs'];
for(const name of originalFiles){
  const file=join(lrs,...name.split('/'));
  if(!(await readFile(file)).length)throw Error('Missing native LRS source: '+name);
}

const excludedScopeDirs=/^app\/lrunes\/(?:culture|search|statics|trace|manage)\//;
const sourceDirs=['app/lrunes','app/card','app/daily','app/game','modules/lrs'];
let count=0;
async function walk(dir){
  for(const item of await readdir(join(lrs,dir),{withFileTypes:true})){
    if(item.isSymbolicLink())throw Error('Native LRS source must not contain symlinks: '+dir);
    const rel=dir+'/'+item.name;
    if(excludedScopeDirs.test(rel)||
       ['app/lrunes/RunesClient.jsx','app/lrunes/RuneIntroSection.jsx',
        'app/lrunes/RuneCardEntryBubbles.jsx','app/lrunes/rune-asset-origin.mjs'].includes(rel))continue;
    // Every LOC Next route, including lrunes Scope, stays owned by LOC.
    if(rel.endsWith('/page.jsx'))continue;
    if(item.isDirectory()){await walk(rel);continue;}
    if(!item.isFile())throw Error('Unexpected native LRS source type: '+rel);
    const source=join(lrs,...rel.split('/'));
    const target=join(loc,...rel.split('/'));
    if(!relative(loc,target).startsWith('..')){
      await mkdir(dirname(target),{recursive:true});
      await cp(source,target,{force:true});
      count++;
    }else throw Error('Refusing native LRS path escape');
  }
}
for(const dir of sourceDirs)await walk(dir);
// Update only the temporary native restored file, not the LRS repository.
await adaptRestoredLrsLocale(loc);

// The original Rune CSS and public-facing image assets are native-only LOC
// checkout inputs now. The LOC Web source/release never carries these files.
const nativeStyles=['app/styles/runes.css','app/styles/home-runes.css'];
const runePictures=['01.soul.jpg','01.soul_s.jpg','02_connection.jpg','02_connection_s.jpg',
  '03_life.jpg','03_life_s.jpg','04_nature.jpg','04_nature_s.jpg',
  '05_mineral.jpg','05_mineral_s.jpg','06_element.jpg','06_element_s.jpg',
  '07_order.jpg','07_order_s.jpg','08_disorder.jpg','08_disorder_s.jpg',
  '09_specia.jpg','09_special_s.jpg',
  'LunaRunes-hero.jpg','LunaRunes-hero_s.webp','LunaRunes.webp',
  'LunaRunesGame.jpg','lrunes66_overview.jpg','lrunes66_overview_s.jpg'];
for(const rel of [...nativeStyles,...runePictures.map(name=>'assets/pics/'+name)]){
  const source=join(lrs,...rel.split('/'));
  if(!(await readFile(source)).length)throw Error('Missing native Rune asset: '+rel);
  const target=join(loc,...rel.split('/'));
  await mkdir(dirname(target),{recursive:true});
  await cp(source,target,{force:true});
}


// LOC retains the same lrunes Scope homepage on Web and iOS.
// No native build step may replace its homepage component with LRS RunesClient.
// LRS supplies only feature implementations to the existing LOC IPA build.

// Restore native-only feature entrypoints in the temporary IPA checkout.
// Web entrypoints stay independent LRS links; the lrunes Scope homepage is untouched.
const nativeEntrypoints=[
 ['app/card/page.jsx',["import RuneArtNav from '../lrunes/Rune3DNav';","import RuneCardHub from '../lrunes/RuneCardHub';"].join('\n'),'<RuneCardHub Navigation={RuneArtNav}/>'],
 ['app/card/duel/page.jsx',"import RuneUnifiedView from '../../lrunes/RuneUnifiedView';",'<RuneUnifiedView feature="duel" defaultView="3d"/>'],
 ['app/card/daily/page.jsx',"import RuneUnifiedView from '../../lrunes/RuneUnifiedView';",'<RuneUnifiedView feature="daily" defaultView="3d"/>'],
 ['app/card/list/page.jsx',"import RuneUnifiedView from '../../lrunes/RuneUnifiedView';",'<RuneUnifiedView feature="list" defaultView="3d"/>'],
 ['app/game/page.jsx',"import GameBoard from '../../modules/lrs/boardgame/GameBoard.jsx';",'<GameBoard/>'],
 ['app/daily/log/page.jsx',"import DailyLogClient from './DailyLogClient';",'<DailyLogClient/>'],
 ['app/daily/page.jsx',"import DailyLogClient from './log/DailyLogClient';",'<DailyLogClient/>']
];
for(const [relativePath,nativeImport,render] of nativeEntrypoints){
 const file=join(loc,...relativePath.split('/'));
 const existing=await readFile(file,'utf8');
 if(!existing.includes('import LrsWebRedirect from ')||!existing.includes('return <LrsWebRedirect path='))
   throw Error('LOC Web-only entrypoint contract changed: '+relativePath);
 const rewritten=existing
   .replace(/^import LrsWebRedirect from [^\n]+;\n/m,nativeImport+'\n')
   .replace(/return <LrsWebRedirect path="[^"]+"\/>;/, 'return '+render+';');
 await writeFile(file,rewritten);
}
await writeFile(join(loc,'app/daily/trend/page.jsx'),"export {metadata,default} from '../log/page';\n");
await writeFile(join(loc,'app/game/room/page.jsx'),"export {metadata,default} from '../page';\n");

const globals=join(loc,'app/globals.css');
let css=await readFile(globals,'utf8');
for(const line of ['@import "./styles/home-runes.css";','@import "./styles/runes.css";']){
  if(!css.includes(line))css=css.replace('@import "./styles/home-content.css";',
    line+'\n@import "./styles/home-content.css";');
}
await writeFile(globals,css);
// Retain the original native-only PDF download without restoring it in LOC Web.
const pdf='assets/lunarunes/source/LunarRunesCardCut.pdf';
const pdfFile=join(lrs,...pdf.split('/'));
if(!(await readFile(pdfFile)).length)throw Error('Missing original LRS PDF');
await mkdir(dirname(join(loc,...pdf.split('/'))),{recursive:true});
await cp(pdfFile,join(loc,...pdf.split('/')),{force:true});

console.log('LOC native draw/game dependencies from pinned LRS: '+count+' source files; LOC Scope homepage unchanged');
