// LOC-only adaptation of the pinned LRS 1.0.2 source during temporary restore.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const TARGET='app/lrunes/DailyRuneAnalytics.jsx';
const OLD_IMPORT="import featureZh from '../i18n/feature-sections/dailyRune.zh_tw.js';";
const OLD_CALL="useFeatureCopy('dailyRune',featureZh)";
const NEW_CALL="useFeatureCopy('dailyRune')";
export function adaptLrsLocaleSourceText(source){
  const text=String(source);
  if(!text.includes(OLD_IMPORT)){
    if(!text.includes(OLD_CALL)&&text.includes(NEW_CALL))return text;
    throw Error('Pinned LRS daily locale contract changed');
  }
  if(!text.includes(OLD_CALL))throw Error('Pinned LRS daily locale hook contract changed');
  const updated=text.replace(OLD_IMPORT,'').replaceAll(OLD_CALL,NEW_CALL);
  if(updated.includes('featureZh')||updated.includes(OLD_IMPORT)||updated.includes(OLD_CALL))
    throw Error('LRS adapter left retired zh_tw dependency');
  return updated;
}
export async function adaptRestoredLrsLocale(root){
  const file=join(root,...TARGET.split('/'));
  const source=await readFile(file,'utf8');
  const changed=adaptLrsLocaleSourceText(source);
  if(changed!==source)await writeFile(file,changed);
}
