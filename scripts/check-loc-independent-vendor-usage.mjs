// LOC cutover evidence: an exact case-insensitive legacy-provider regex
// scan of first-party runtime sources and deploy/build configurations.
// Negative regression tests intentionally mention forbidden vendor names;
// historical migrations, test fixtures and manual workflows are not runtime imports.
// A passing result therefore means active-runtime scan, not every repository byte.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const directories=['app','workers','functions','extensions','services',
  'zenstack','public'];
const rootFiles=['package.json','next.config.mjs','open-next.config.ts',
  'Dockerfile','vercel.json'];
const extensions=new Set(['.js','.mjs','.cjs','.jsx','.ts','.tsx',
  '.json','.jsonc','.yml','.yaml','.html','.toml']);
const skip=/^(?:public\/vendor\/|extensions\/[^/]+\/vendor\/)/;
// Reject legacy identity/provider SDK coupling. The Neon serverless package
// below is a PostgreSQL WebSocket transport, not an identity provider: it is
// required by the existing Cloudflare LOC Auth Worker and Kysely dialect.
// The exception is deliberately limited to its exact import and dependency
// declaration. Any other use of @neondatabase/* remains a failure.
const coupling=/(@clerk\/|@supabase\/|@neondatabase\/)/ig;
const allowedPgDriverLines=new Map([
  ['workers/loc-authority/auth.mjs',
    /^import\s+\{\s*Pool\s*,\s*neonConfig\s*\}\s+from\s+['"]@neondatabase\/serverless['"];?\s*$/],
  ['package.json',
    /^\s*"@neondatabase\/serverless"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+",?\s*$/]
]);
const results=[];
const approvedPgDriver=[];
function check(path){
  const relativePath=relative(root,path).replaceAll('\\','/');
  if(skip.test(relativePath))return;
  const value=readFileSync(path,'utf8');
  const lines=value.split(/\r?\n/);
  lines.forEach((line,index)=>{
    // Documentation/comments are not runtime imports or provider configuration.
    // Keep rejection fixtures in tests; actual executable references still fail.
    if(/^(?:\/\/|\/\*|\*|<!--|#)/.test(line.trimStart()))return;
    coupling.lastIndex=0;
    const matches=[...line.matchAll(coupling)];
    if(!matches.length)return;
    if(allowedPgDriverLines.get(relativePath)?.test(line)){
      approvedPgDriver.push({path:relativePath,line:index+1});
      return;
    }
    results.push({path:relativePath,line:index+1,
      matches:[...new Set(matches.map(match=>match[0].toLowerCase()))]});
  });
}
function walk(dir){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())walk(path);
    else if(entry.isFile()&&extensions.has(extname(path)))check(path);
  }
}
for(const dir of directories)walk(join(root,dir));
for(const name of rootFiles){
  const path=join(root,name);
  if(existsSync(path))check(path);
}
if(results.length){
  for(const result of results.slice(0,250))
    process.stderr.write(result.path+':'+result.line+' ['+result.matches.join(', ')+']\n');
  if(results.length>250)process.stderr.write('... '+(results.length-250)+' more lines\n');
  process.stderr.write('LOC active-runtime legacy provider coupling: '+results.length+' lines; FAIL\n');
  process.exitCode=1;
}else process.stdout.write('LOC legacy identity provider coupling: 0 lines; PASS ('+
  approvedPgDriver.length+' approved PostgreSQL transport declarations)\n');
