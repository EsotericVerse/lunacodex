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
    return item.isFile()&&item.name==='page.html'?[sub]:[];
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
  if(allPages.length<60)throw new Error('LOC HTML document loss: '+allPages.length);
  const entryPoints={
    '_loc/site':abs('app/globals.css'),
    '_loc/editor':abs('app/styles/editor.css'),
    'public-preferences':abs('app/loc/public-home-preferences.jsx'),
    interactive:abs('app/loc/runtime/html-entry.jsx'),
    controls:abs('app/loc/runtime/html-controls.js')
  };
  const decode=s=>String(s||'').replace(/&(amp|quot|lt|gt|#39);/g,(_,key)=>
    ({amp:'&',quot:'"',lt:'<',gt:'>', '#39':"'"})[key]);
  const records=allPages.map(file=>{
    const route='/'+(path.posix.dirname(file)==='.'?'':path.posix.dirname(file)+'/');
    const markup=fs.readFileSync(abs('app/'+file),'utf8');
    const text=(pattern)=>decode(markup.match(pattern)?.[1]||'');
    const title=text(/<title>([^<]*)<\/title>/i)||'LOC 月典';
    const description=text(/<meta name="description" content="([^"]*)">/i);
    const noIndex=/<meta name="robots" content="noindex,nofollow">/i.test(markup);
    const attr=name=>text(new RegExp('\\bdata-loc-'+name+'="([^"]*)"','i'));
    const component=attr('component'),view=attr('view'),scope=attr('scope');
    const section=attr('section'),redirectTarget=attr('redirect');
    if(!['loc','outbound','legacy','phone','settings','features','work','bridge'].includes(component)||
      !view||!scope||!/^[a-z][a-z0-9]{0,14}$/.test(scope))
      throw Error('Invalid LOC HTML page attributes: '+file);
    if(component==='legacy'&&!redirectTarget)
      throw Error('Legacy URL must declare its destination: '+file);
    const relative=route.replace(/^\/lrunes\//,'/').slice(1).replace(/\/$/,'');
    return {route,name:'_loc/routes/interactive',title,description,noIndex,
      component,view,scope,section,redirectTarget,relative};
  });
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
  const {renderPublicScopeHome,renderPublicFeatureFrame}=await import(pathToFileURL(staticRenderer).href);
  for(const page of records){
    const staticHome=renderPublicScopeHome({route:page.route,entry:page.name,native});
    const dest=path.join(out,page.route.slice(1));
    fs.mkdirSync(dest,{recursive:true});
    const outbound=page.component==='outbound';
    const target=outbound?'https://lrs.lo3rwang.cc/'+page.relative+'/':'';
    const current=page.component==='settings'||page.component==='features'?'settings':
      page.view==='searchManage'?'search':
      page.view==='sourceManage'?'culture':
      ['keywords','keywordManage'].includes(page.view)?'statics':
      page.view==='manage'&&page.relative.includes('trace')?'trace':page.view;
    const frame=staticHome?staticHome.html:
      renderPublicFeatureFrame({scopeId:page.scope,title:page.title,link:target,
        feature:current,work:page.component==='work',native});
    const attrs=' data-loc-component="'+escape(page.component)+'" data-loc-view="'+
      escape(page.view)+'" data-loc-scope="'+escape(page.scope)+'"'+
      (page.section?' data-loc-section="'+escape(page.section)+'"':'')+
      (page.redirectTarget?' data-loc-redirect="'+escape(page.redirectTarget)+'"':'');
    const load=staticHome?staticHome.loader:
      page.component==='work'?'':outbound?'<script>location.replace('+JSON.stringify(target)+')</script>':
      page.component==='legacy'
        ?'<script>if(location.protocol!=="capacitor:"){const next=new URL('+
          JSON.stringify(page.redirectTarget)+',location.href);'+
          'const old=new URL(location.href);for(const [k,v] of old.searchParams)'+
          'if(!next.searchParams.has(k))next.searchParams.append(k,v);'+
          'next.hash=old.hash;location.replace(next.href);}</script>'+
          '<script type="module" src="/'+page.name+'.js"></script>'
        :'<script type="module" src="/'+page.name+'.js"></script>';
    const html=[
      '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
      '<title>'+escape(page.title)+'</title>',
      '<meta name="description" content="'+escape(page.description)+'">',
      page.noIndex?'<meta name="robots" content="noindex,nofollow">':'',
      '<link rel="canonical" href="https://loc.lo3rwang.cc'+page.route+'">',
      '<link rel="icon" href="/assets/site/icons/loc-favicon.png">',
      '<link rel="stylesheet" href="'+cssHref+'">',
      '<script id="loc-native-static-route">'+NATIVE_STATIC_ROUTE_SCRIPT+'</script>',
      '<script id="loc-theme-bootstrap">'+INITIAL_THEME_SCRIPT+'</script>',
      '</head><body class="loc-app-shell'+(staticHome&&!staticHome.live?' loc-static-reading':'')+'"'+attrs+'>',
      '<div id="loc-root">'+frame+'</div>',
      "<script id=\"loc-html-controls\">(()=>{try{\n  const theme=document.querySelector('[data-loc-control=\"theme\"]');\n  if(theme){\n    const scope=(location.pathname.startsWith('/scope-shell/')?new URLSearchParams(location.search).get('scopeid')||'loc':document.body.dataset.locScope||'loc');\n    const value=JSON.parse(sessionStorage.getItem('loc-user-theme-selection-v1')||'{}')[scope];\n    const selected=/^[1-8]$/.test(String(value??''))?'theme-'+value:String(value||'');\n    if([...theme.options].some(option=>option.value===selected))theme.value=selected;\n  }\n}catch{}\ndocument.addEventListener('change',async event=>{\n  const input=event.target.closest?.('[data-loc-control]');\n  if(!input)return;\n  try{\n    const module=await import('/_loc/routes/controls.js');\n    await module.applyHtmlPreference(input.dataset.locControl,input.value,\n      (location.pathname.startsWith('/scope-shell/')?new URLSearchParams(location.search).get('scopeid')||'loc':document.body.dataset.locScope||'loc'));\n  }catch(error){console.error('LOC preference failed',error);}\n});})();</script>",load,
      '</body></html>'
    ].join('');
    fs.writeFileSync(path.join(dest,'index.html'),html);
  }
  fs.cpSync(abs('public'),out,{recursive:true,force:true});
  if(native&&fs.existsSync(path.join(out,'pics','64Card_org')))
    throw new Error('Native export contains raw card originals');
  fs.writeFileSync(path.join(out,'_loc','build-report.json'),JSON.stringify({
    runtime:'HTML documents + on-demand React',bundler:'esbuild',routes:records.length,sharedCss:cssHref,editorCss:editorCssHref,
    jsBytes:Object.entries(compiled.metafile.outputs).filter(([p])=>p.endsWith('.js')).reduce((sum,[,v])=>sum+v.bytes,0)
  }));
  console.log('[LOC] HTML documents + on-demand features: '+records.length+' HTML routes; '+(native?'IPA':'Web')+' target.');
}catch(error){
  fs.rmSync(out,{recursive:true,force:true});
  throw error;
}finally{
  fs.rmSync(scratch,{recursive:true,force:true});
}
