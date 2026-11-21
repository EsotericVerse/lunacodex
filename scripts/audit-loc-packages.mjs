// LOC direct dependency usage audit. No package is deleted solely based on this scan.
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const deps=Object.keys(pkg.dependencies||{}),dev=Object.keys(pkg.devDependencies||{});
const monitored=['app','packages','modules','functions','scripts','tests','services'];
const exts=new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.css','.scss']);
const files=[];
function walk(folder){
  if(!fs.existsSync(folder))return;
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    if(['node_modules','dist','out','.next'].includes(item.name))continue;
    const file=path.join(folder,item.name);
    if(item.isDirectory())walk(file);
    else if(item.isFile()&&exts.has(path.extname(item.name)))files.push(file);
  }
}
for(const dir of monitored)walk(path.join(root,dir));
const imported=new Map([...deps,...dev].map(name=>[name,new Set()]));
const escaped=name=>name.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  const rel=path.relative(root,file).replaceAll('\\','/');
  for(const name of imported.keys()){
    const regex=new RegExp("(?:from\\s*['\\\"]|import\\s*\\(\\s*['\\\"]|import\\s*['\\\"]|require\\s*\\(\\s*['\\\"]|@import\\s*['\\\"]|@use\\s*['\\\"])"+escaped(name)+"(?:/|['\\\"])");
    if(regex.test(source))imported.get(name).add(rel);
  }
}
// Build-time generation and native packaging do not show up as ordinary imports.
const generated=new Map([
  ['react-dom',['scripts/build-preact-static.mjs: generated React-compatible entry']],
  ['@capacitor/ios',['.github/workflows/ios-device-build.yml: native toolchain']],
  ['typescript',['TypeScript source / tsconfig toolchain']],
  ['@types/node',['Node 22 build scripts and TypeScript ambient definitions']]
]);
for(const [name,uses] of generated){
  if(imported.has(name))for(const use of uses)imported.get(name).add(use);
}
const candidates=[...imported].filter(([,uses])=>uses.size===0).map(([name])=>name);
if(pkg.dependencies?.next||fs.existsSync(path.join(root,'node_modules','next')))
  throw Error('Next.js package still installed in LOC');
console.log('[LOC PKG] '+deps.length+' runtime + '+dev.length+' build direct packages; scanned '+files.length+' source files; unused-name candidates: '+JSON.stringify(candidates));
for(const name of candidates)console.log('[LOC PKG candidate] '+name+' requires peer/runtime verification before removal');
