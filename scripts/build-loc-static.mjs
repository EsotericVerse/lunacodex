import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {NATIVE_STATIC_ROUTE_SCRIPT,INITIAL_THEME_SCRIPT} from '../app/modular/runtime/theme-bootstrap.mjs';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const out=path.join(root,'out');
const scratch=path.join(root,'.loc-esbuild-build');
const abs=p=>path.join(root,p);
const command=process.platform==='win32'?'npm.cmd':'npm';
const native=process.env.LOC_NATIVE_BUNDLE==='1';
function run(args){
  const r=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
  if(r.status!==0)throw new Error('npm '+args.join(' ')+' failed: '+r.status);
}
function pages(folder,relative=''){
  return fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>{
    const sub=path.posix.join(relative,item.name);
    if(item.isDirectory())return pages(path.join(folder,item.name),sub);
    return item.isFile()&&/^page\.(jsx|js|tsx)$/.test(item.name)?[sub]:[];
  });
}
fs.rmSync(out,{recursive:true,force:true});
fs.rmSync(scratch,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
fs.mkdirSync(scratch,{recursive:true});
try{
  run(['run','prebuild']);
  const allPages=pages(abs('app')).sort();
  if(allPages.length<60)throw new Error('LOC route loss: '+allPages.length);
  const entryPoints={
    '_loc/site':abs('app/globals.css'),
    '_loc/editor':abs('app/styles/editor.css'),
    'public-preferences':abs('app/loc/public-home-preferences.jsx')
  };
  const records=[];
  for(let i=0;i<allPages.length;i++){
    const name='_loc/routes/p'+i;
    const file=allPages[i];
    const route='/'+(path.posix.dirname(file)==='.'?'':path.posix.dirname(file)+'/');
    const entry=path.join(scratch,'entry-'+i+'.jsx');
    fs.writeFileSync(entry,[
      "import {createRoot} from 'react-dom/client';",
      "import {createElement} from 'react';",
      'import Shell from '+JSON.stringify(abs('app/AppShell.jsx'))+';',
      'import Page from '+JSON.stringify(abs('app/'+file))+';',
      "createRoot(document.getElementById('loc-root')).render(createElement(Shell,null,createElement(Page)));"
    ].join('\n'));
    entryPoints[name]=entry;
    const source=fs.readFileSync(abs('app/'+file),'utf8');
    const title=source.match(/title:\s*['"]([^'"]+)['"]/)?.[1]||'LOC 月典';
    const description=source.match(/description:\s*['"]([^'"]+)['"]/)?.[1]||'';
    const noIndex=/noIndex:\s*true|index:\s*false/.test(source);
    records.push({route,name,title,description,noIndex});
  }
  const compiled=await build({
    entryPoints,outdir:out,bundle:true,splitting:true,format:'esm',
    platform:'browser',target:'es2022',jsx:'automatic',jsxImportSource:'react',
    logLevel:'warning',minify:true,metafile:true,
    entryNames:'_loc/routes/[name]',chunkNames:'_loc/chunks/[name]-[hash]',
    assetNames:'_loc/assets/[name]-[hash]',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file','.png':'file','.svg':'file','.webp':'file','.gif':'file','.jpg':'file','.jpeg':'file','.avif':'file'},
    define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'loc-native-assets',setup(ctx){
      // Web and IPA both resolve staged /pics URLs; never rebundle images into CSS.
      ctx.onResolve({filter:/^\/pics\//},args=>({path:args.path,external:true}));
      ctx.onResolve({filter:/^next\//},args=>({errors:[{text:'Unsupported legacy Next import: '+args.path}]}));
      ctx.onResolve({filter:/^@blocknote\/(?:core\/fonts\/inter|mantine\/style|react\/style)\.css$/},args=>{
        // The CSS "style" export condition is not selected by esbuild for some
        // BlockNote packages. Resolve their actual published stylesheet instead.
        const found=args.path.match(/^(@blocknote\/[^/]+)\/(.+)$/);
        if(!found)return null;
        const pkgDir=abs('node_modules/'+found[1]);
        const pkg=JSON.parse(fs.readFileSync(path.join(pkgDir,'package.json'),'utf8'));
        const definition=pkg.exports?.['./'+found[2]];
        const findCss=entry=>{
          if(typeof entry==='string')return entry;
          if(!entry||typeof entry!=='object')return '';
          for(const key of ['style','import','default','require','browser']){
            const found=findCss(entry[key]);
            if(found)return found;
          }
          return '';
        };
        const spec=findCss(definition);
        const candidates=[
          ...(spec?[path.resolve(pkgDir,spec)]:[]),
          path.join(pkgDir,found[2]),
          path.join(pkgDir,'dist',found[2]),
          path.join(pkgDir,'dist',path.basename(found[2]))
        ];
        const resolved=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
        return resolved?{path:resolved}:{errors:[{text:'Required LOC editor CSS missing: '+args.path}]};
      });
    }}]
  });
  const cssOutputs=Object.entries(compiled.metafile.outputs).filter(([file])=>file.endsWith('.css'));
  const sharedCss=cssOutputs.find(([,meta])=>String(meta.entryPoint||'').endsWith('app/globals.css'));
  if(!sharedCss)throw new Error('LOC global CSS output missing: '+JSON.stringify(cssOutputs.map(([file,meta])=>({file,entryPoint:meta.entryPoint}))));
  const cssHref='/'+path.relative(out,path.resolve(root,sharedCss[0])).replaceAll('\\','/');
  if(!fs.existsSync(path.join(out,cssHref.slice(1))))throw new Error('LOC global CSS file not found at '+cssHref);
  const editorCssHref='/_loc/routes/editor.css';
  if(!fs.existsSync(path.join(out,editorCssHref.slice(1))))
    throw new Error('LOC editor-only stylesheet missing: '+editorCssHref);
  console.log('[LOC styles] '+cssHref+'; CSS assets='+cssOutputs.length);
  // Server-side rendering uses the canonical LOC Block components and the
  // already-installed ReactDOMServer at BUILD time only.
  const staticRenderer=path.join(scratch,'public-home-ssr.mjs');
  await build({
    entryPoints:[abs('scripts/render-public-home.jsx')],
    outfile:staticRenderer,bundle:true,platform:'node',format:'esm',
    packages:'external',jsx:'automatic',jsxImportSource:'react',
    target:'node22',logLevel:'warning'
  });
  const {renderPublicScopeHome}=await import(pathToFileURL(staticRenderer).href);
  // Python owns the HTML document protocol; React/JS own unchanged content
  // and interactive bundles. Publish one batch without a per-page Python launch.
  const htmlPages=[];
  for(const page of records){
    const staticHome=!native?renderPublicScopeHome({route:page.route,entry:page.name}):null;
    const css=fs.existsSync(path.join(out,page.name+'.css'))?'<link rel="stylesheet" href="/'+page.name+'.css">':'';
    htmlPages.push({...page,cssHref,css,staticHome,
      nativeStaticScript:NATIVE_STATIC_ROUTE_SCRIPT,themeScript:INITIAL_THEME_SCRIPT});
  }
  const htmlManifest=path.join(scratch,'loc-static-pages.json');
  fs.writeFileSync(htmlManifest,JSON.stringify(htmlPages));
  const pythonScript=abs('modules/loc/python/html_protocol.py');
  const pythonArgs=process.platform==='win32'?
    ['-3',pythonScript,htmlManifest,out]:[pythonScript,htmlManifest,out];
  const published=spawnSync(process.platform==='win32'?'py':'python3',pythonArgs,
    {cwd:root,stdio:'inherit'});
  if(published.error||published.status!==0)
    throw new Error('LOC Python HTML protocol build failed: '+
      (published.error?.message||published.status));
  fs.cpSync(abs('public'),out,{recursive:true,force:true});
  if(native&&fs.existsSync(path.join(out,'pics','64Card_org')))
    throw new Error('Native export contains raw card originals');
  fs.writeFileSync(path.join(out,'_loc','build-report.json'),JSON.stringify({
    runtime:'Native React + optional Preact island',bundler:'esbuild',routes:records.length,sharedCss:cssHref,editorCss:editorCssHref,
    jsBytes:Object.entries(compiled.metafile.outputs).filter(([p])=>p.endsWith('.js')).reduce((sum,[,v])=>sum+v.bytes,0)
  }));
  console.log('[LOC] esbuild native React features + optional Preact islands: '+records.length+' HTML routes; '+(native?'IPA':'Web')+' target.');
}catch(error){
  fs.rmSync(out,{recursive:true,force:true});
  throw error;
}finally{
  fs.rmSync(scratch,{recursive:true,force:true});
}
