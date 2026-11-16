// One regex pass over executable source. Only active source files count.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const folders=['app','services/workers','extensions','functions','packages/zenstack'];
const extensions=/\.(?:[cm]?js|jsx|tsx?|jsonc?|zmodel|sql|vue|py|rb|sh|swift|css|html)$/i;
const legacy=/DefaultArticleClass|\btxt_class\b/i;
const findings=[];
let checked=0;
function visit(dir){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name==='.next')continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())visit(file);
    else if(entry.isFile()&&extensions.test(entry.name)){
      checked++;
      const lines=readFileSync(file,'utf8').split(/\r?\n/);
      lines.forEach((line,i)=>{if(legacy.test(line))
        findings.push(path.relative(root,file)+':'+(i+1)+': '+line.trim().slice(0,180));});
    }
  }
}
for(const folder of folders){
  const dir=path.join(root,folder);
  // LRS and LAS workers/extensions migrated to independent repositories.
  // A retired directory's absence is correct; still scan every extant LOC
  // source tree rather than recreating or checking out another repository.
  if(!existsSync(dir))continue;
  visit(dir);
}
if(findings.length)throw Error('Retired source field still referenced:\n'+findings.join('\n'));
console.log('Source-field regex clean: '+checked+' active source files scanned.');
