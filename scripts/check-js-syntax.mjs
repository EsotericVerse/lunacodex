import {readdirSync,readFileSync} from 'node:fs';
import {extname,join,relative} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {parse}=require('@babel/parser');
const root=process.cwd();
const included=new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts']);
const sourcePaths=['app','scripts','next.config.mjs','public/sw.js'];
const files=[];
function collect(path){
  const entries=readdirSync(path,{withFileTypes:true});
  for(const entry of entries){
    const full=join(path,entry.name);
    if(entry.isDirectory())collect(full);
    else if(entry.isFile()&&included.has(extname(entry.name)))files.push(full);
  }
}
for(const path of sourcePaths){
  if(path==='app'||path==='scripts')collect(path);
  else files.push(path);
}
files.sort();
let invalid=0;
for(const file of files){
  try{
    const ts=/\.(?:[cm]?ts|tsx)$/.test(file);
    parse(readFileSync(file,'utf8'),{
      sourceType:['.cjs','.cts'].includes(extname(file))?'commonjs':'module',
      plugins:ts?['typescript','jsx']:['jsx']
    });
  }catch(error){
    invalid++;
    const loc=error.loc?`:${error.loc.line}:${error.loc.column+1}`:'';
    console.error(`${relative(root,file)}${loc}: ${error.message}`);
  }
}
console.log(`Syntax: ${files.length} files checked, ${invalid} errors.`);
if(invalid)process.exitCode=1;
