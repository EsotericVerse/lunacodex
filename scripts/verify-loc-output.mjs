// Build artifact contract for all LOC static routes, Cloudflare Pages and IPA.
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'out'),app=path.join(root,'app');
const native=process.env.LOC_NATIVE_BUNDLE==='1';
const read=(p)=>fs.readFileSync(p,'utf8');
const exists=p=>fs.existsSync(p)&&fs.statSync(p).isFile();
function pageFiles(folder,relative=''){
  return fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>{
    const sub=path.posix.join(relative,item.name),full=path.join(folder,item.name);
    if(item.isDirectory())return pageFiles(full,sub);
    return item.isFile()&&item.name==='page.html'?[sub]:[];
  });
}
const pageSources=pageFiles(app);
const pageRoutes=pageSources.map(file=>{
  const dir=path.posix.dirname(file);
  return '/'+(dir==='.'?'':dir+'/');
});
if(pageSources.length!==80)throw Error('LOC authored HTML document count changed: '+pageSources.length);
for(const file of pageSources){
  if(!exists(path.join(app,file)))throw Error('Missing authored HTML: '+file);
  if(exists(path.join(app,path.posix.dirname(file),'page.jsx')))
    throw Error('Old JSX page wrapper remains: '+file);
}
const required=['/','/culture/','/search/','/statics/','/trace/','/settings/','/admin/','/my-phone/','/lo3rwang/','/lrunes/'];
for(const route of required)if(!pageRoutes.includes(route))throw Error('Required LOC route absent: '+route);
// Validate the actual esbuild CSS entry output, not an assumed filename.
if(!exists(path.join(out,'_loc','build-report.json')))throw Error('LOC build-report missing');
const report=JSON.parse(read(path.join(out,'_loc','build-report.json')));
if(!/^\/_loc\/[^?#]+\.css$/.test(report.sharedCss)||!exists(path.join(out,report.sharedCss.slice(1))))
  throw Error('LOC shared CSS missing or invalid: '+report.sharedCss);
if(report.runtime!=='HTML documents + on-demand React'||report.bundler!=='esbuild'||report.routes!==pageRoutes.length)
  throw Error('LOC static route manifest mismatch');
if(report.editorCss!=='/_loc/routes/editor.css'||!exists(path.join(out,report.editorCss.slice(1))))
  throw Error('LOC editor-on-demand stylesheet missing: '+report.editorCss);
if(!exists(path.join(out,'_loc','routes','public-preferences.js')))
  throw Error('LOC Preact preferences island missing');
// A framework version must not reintroduce React-to-Preact mapping or Next-style shims.
const source=read(path.join(root,'scripts','build-loc-static.mjs'));
if(source.includes('preact/compat')||/\balias\s*:\s*\{/.test(source))
  throw Error('LOC build contains forbidden React/Preact compatibility mapping');
for(const stale of ['dynamic.jsx','navigation.js','link.jsx']){
  if(fs.existsSync(path.join(root,'app','modular','runtime',stale)))
    throw Error('LOC has a retired Next-style runtime adapter: '+stale);
}
if(fs.existsSync(path.join(out,'_next')))throw Error('Next.js assets left in LOC export');
const css=read(path.join(out,report.sharedCss.slice(1)));
if(/assets\/pics\//.test(css))throw Error('LOC CSS still bundles raw source image paths');
for(const name of ['LOC-culture','LOC-statics','LOC-search','LOC-admin','scope-culture','scope-statics']){
  const old=path.join(out,'_loc','assets');
  if(fs.existsSync(old)&&fs.readdirSync(old).some(file=>file.startsWith(name+'-')&&/\.(?:jpg|jpeg|png|webp)$/.test(file)))
    throw Error('LOC duplicated Web image in JS/CSS assets: '+name);
}

if(fs.readdirSync(path.join(out,'_loc','routes')).some(file=>/^p\\d+\\.js$/.test(file)))
  throw Error('Per-page React entrypoint emitted by HTML builder');
if(!exists(path.join(out,'_loc','routes','interactive.js')))
  throw Error('Shared interactive HTML entrypoint missing');
if(!fs.existsSync(path.join(out,'pics')))throw Error('LOC image URL path /pics not staged');
if(native&&fs.existsSync(path.join(out,'pics','64Card_org')))throw Error('IPA contains originals');
for(const route of pageRoutes){
  const entry=path.join(out,route.slice(1),'index.html');
  if(!exists(entry))throw Error('Missing route: '+route);
  const html=read(entry);
  if(!html.includes('href="'+report.sharedCss+'"'))throw Error('LOC shared CSS not linked from '+route);
  const publicHome=!native&&['/','/lo3rwang/','/lrunes/'].includes(route);
  const src=html.match(/<script type="module" src="(\/_loc\/routes\/interactive\.js)"><\/script>/)?.[1];
  if(publicHome){
    if(html.includes('href="'+report.editorCss+'"'))
      throw Error('LOC public homepage should not download editor CSS: '+route);
    if(src||!html.includes('id="loc-static-upgrade"')||!html.includes('data-loc-upgrade="edit"'))
      throw Error('LOC public home must not automatically start Preact: '+route);
    if(!html.includes('class="loc-view loc-home"')||!html.includes('loc-home-block__header'))
      throw Error('LOC public home published content missing: '+route);
    if(!html.includes('type="application/ld+json"'))
      throw Error('LOC public home structured data missing: '+route);
  }else if(html.includes('data-loc-component="work"')){
    if(src||!html.includes('author-role-grid')||!html.includes('scope-home-composition'))
      throw Error('Author Work must be fully published HTML: '+route);
  }else if(html.includes('data-loc-component="outbound"')){
    if(src||!html.includes('https://lrs.lo3rwang.cc/'))
      throw Error('LRS outbound HTML must link directly without React: '+route);
  }else if(!src||!exists(path.join(out,src.slice(1))))
    throw Error('Missing executable LOC interaction bundle for '+route);
  if(!publicHome&&!html.includes('data-loc-component='))
    throw Error('HTML feature metadata missing: '+route);
  if(!html.includes('id="loc-theme-bootstrap"')||!html.includes('id="loc-native-static-route"'))
    throw Error('Lost native/theme bootstraps at '+route);
  if(/_next\/|__next|next\/navigation/i.test(html))throw Error('Next.js leaked into route '+route);
}
const api=JSON.parse(read(path.join(out,'_routes.json')));
if(!api.include?.includes('/api/loc-public-query')||!api.include?.includes('/api/loc-permissions'))
  throw Error('Cloudflare SQL/permissions route contract missing');
const pkg=JSON.parse(read(path.join(root,'package.json')));
if('next' in pkg.dependencies)throw Error('Next remains a LOC runtime dependency');
console.log('[LOC QA] '+pageRoutes.length+' static/interactive HTML routes and entrypoint files valid; static CSS, themes, native bootstrap, SQL Functions routing, images: OK. JS bytes='+report.jsBytes+'; target='+(native?'IPA':'Web'));
