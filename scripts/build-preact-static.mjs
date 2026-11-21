import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {NATIVE_STATIC_ROUTE_SCRIPT,INITIAL_THEME_SCRIPT} from '../app/modular/runtime/theme-bootstrap.mjs';
import {renderPublicScopeHome} from './render-loc-static-home.mjs';

const root=process.cwd();
const out=path.join(root,'out');
const scratch=path.join(root,'.loc-preact-build');
const abs=p=>path.join(root,p);
const require=createRequire(import.meta.url);
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
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
fs.rmSync(out,{recursive:true,force:true});
fs.rmSync(scratch,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
fs.mkdirSync(scratch,{recursive:true});
try{
  run(['run','prebuild']);
  const allPages=pages(abs('app')).sort();
  if(allPages.length<60)throw new Error('LOC route loss: '+allPages.length);
  const entryPoints={'_loc/site':abs('app/globals.css')};
  const records=[];
  for(let i=0;i<allPages.length;i++){
    const name='_loc/routes/p'+i;
    const file=allPages[i];
    const route='/'+(path.posix.dirname(file)==='.'?'':path.posix.dirname(file)+'/');
    const entry=path.join(scratch,'entry-'+i+'.jsx');
    fs.writeFileSync(entry,[
      "import {createRoot} from 'react-dom/client';",
      "import {h} from 'preact';",
      'import Shell from '+JSON.stringify(abs('app/AppShell.jsx'))+';',
      'import Page from '+JSON.stringify(abs('app/'+file))+';',
      "createRoot(document.getElementById('loc-root')).render(h(Shell,null,h(Page)));"
    ].join('\n'));
    entryPoints[name]=entry;
    const source=fs.readFileSync(abs('app/'+file),'utf8');
    const title=source.match(/title:\s*['"]([^'"]+)['"]/)?.[1]||'LOC 月典';
    const description=source.match(/description:\s*['"]([^'"]+)['"]/)?.[1]||'';
    const noIndex=/noIndex:\s*true|index:\s*false/.test(source);
    records.push({route,name,title,description,noIndex});
  }
  const preact=path.dirname(require.resolve('preact/package.json'));
  const alias={
    react:path.join(preact,'compat'),
    'react-dom':path.join(preact,'compat'),
    'react-dom/client':path.join(preact,'compat','client'),
    'react-dom/server':path.join(preact,'compat','server'),
    'react-dom/test-utils':path.join(preact,'test-utils'),
    'react/jsx-runtime':path.join(preact,'jsx-runtime'),
    'react/jsx-dev-runtime':path.join(preact,'jsx-dev-runtime')
  };
  const compiled=await build({
    entryPoints,outdir:out,bundle:true,splitting:true,format:'esm',
    platform:'browser',target:'es2022',jsx:'automatic',jsxImportSource:'react',
    alias,logLevel:'warning',minify:true,metafile:true,
    entryNames:'_loc/routes/[name]',chunkNames:'_loc/chunks/[name]-[hash]',
    assetNames:'_loc/assets/[name]-[hash]',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file','.png':'file','.svg':'file','.webp':'file','.gif':'file','.jpg':'file','.jpeg':'file','.avif':'file'},
    define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'loc-next-removal',setup(ctx){
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
  console.log('[LOC styles] '+cssHref+'; CSS assets='+cssOutputs.length);
  for(const page of records){
    const staticHome=!native?renderPublicScopeHome({route:page.route,entry:page.name}):null;
    const dest=path.join(out,page.route.slice(1));
    fs.mkdirSync(dest,{recursive:true});
    const scope=page.route.startsWith('/lrunes/')?'theme-4':'theme-7';
    const css=fs.existsSync(path.join(out,page.name+'.css'))?'<link rel="stylesheet" href="/'+page.name+'.css">':'';
    const html=[
      '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
      '<title>'+escape(page.title)+'</title>',
      '<meta name="description" content="'+escape(page.description)+'">',
      page.noIndex?'<meta name="robots" content="noindex,nofollow">':'',
      '<link rel="canonical" href="https://loc.lo3rwang.cc'+page.route+'">',
      '<link rel="icon" href="/assets/site/icons/loc-favicon.png">',
      '<link rel="stylesheet" href="'+cssHref+'">',css,
      '<script id="loc-native-static-route">'+NATIVE_STATIC_ROUTE_SCRIPT+'</script>',
      '<script id="loc-theme-bootstrap">'+INITIAL_THEME_SCRIPT+'</script>',
      '</head><body class="loc-app-shell'+(staticHome?' loc-static-reading':'')+'"><div id="loc-root">',
      staticHome?staticHome.html:'<main class="scope-main"><section class="scope-page"><header class="loc-card scope-hero"><h1>'+escape(page.title)+'</h1></header></section></main>',
      '</div>',
      staticHome?staticHome.loader:'<script type="module" src="/'+page.name+'.js"></script>',
      '</body></html>'
    ].join('');
    fs.writeFileSync(path.join(dest,'index.html'),html);
  }
  fs.cpSync(abs('public'),out,{recursive:true,force:true});
  if(native&&fs.existsSync(path.join(out,'pics','64Card_org')))
    throw new Error('Native export contains raw card originals');
  fs.writeFileSync(path.join(out,'_loc','build-report.json'),JSON.stringify({
    runtime:'Preact',bundler:'esbuild',routes:records.length,sharedCss:cssHref,
    jsBytes:Object.entries(compiled.metafile.outputs).filter(([p])=>p.endsWith('.js')).reduce((sum,[,v])=>sum+v.bytes,0)
  }));
  console.log('[LOC] Preact + esbuild: '+records.length+' static HTML routes, '+(native?'IPA':'Web')+' target.');
}catch(error){
  fs.rmSync(out,{recursive:true,force:true});
  throw error;
}finally{
  fs.rmSync(scratch,{recursive:true,force:true});
}
