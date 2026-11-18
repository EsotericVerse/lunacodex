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
    if(excludedScopeDirs.test(rel)||rel==='app/lrunes/RunesClient.jsx')continue;
    // LOC's own Scope route and homepage are never overwritten by LRS.
    if(rel==='app/lrunes/page.jsx'||rel==='app/lrunes/rune-asset-origin.mjs')continue;
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

// The LOC Web settings page links to LRS rather than loading native-only
// daily Rune settings. Restore that original dependency for the IPA export.
const preferences=join(loc,'app/loc/preferences/GlobalSettings.jsx');
let preferencesCode=await readFile(preferences,'utf8');
const webSettings="const DailyRuneCalendarSettings=dynamic(()=>import('./LrsDailySettingsLink'),{loading:PanelLoading});";
const nativeSettings="const DailyRuneCalendarSettings=dynamic(()=>import('../../lrunes/DailyRuneCalendarSettings'),{loading:PanelLoading});";
if(!preferencesCode.includes(webSettings)&&!preferencesCode.includes(nativeSettings))
  throw Error('Native LRS settings import contract changed');
preferencesCode=preferencesCode.replace(webSettings,nativeSettings);
await writeFile(preferences,preferencesCode);

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
