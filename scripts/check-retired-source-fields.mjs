// One regex pass over executable source. Only active source files count.
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const folders=['app','workers','extensions','functions','zenstack'];
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
for(const folder of folders)visit(path.join(root,folder));
if(findings.length)throw Error('Retired source field still referenced:\n'+findings.join('\n'));
console.log('Source-field regex clean: '+checked+' active source files scanned.');
