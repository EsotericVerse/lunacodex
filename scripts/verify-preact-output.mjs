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
    return item.isFile()&&/^page\.(jsx|js|tsx)$/.test(item.name)?[sub]:[];
  });
}
const pageRoutes=pageFiles(app).map(file=>{
  const dir=path.posix.dirname(file);
  return '/'+(dir==='.'?'':dir+'/');
});
const required=['/','/culture/','/search/','/statics/','/trace/','/settings/','/admin/','/my-phone/','/lo3rwang/','/lrunes/'];
for(const route of required)if(!pageRoutes.includes(route))throw Error('Required LOC route absent: '+route);
// Validate the actual esbuild CSS entry output, not an assumed filename.
if(!exists(path.join(out,'_loc','build-report.json')))throw Error('LOC build-report missing');
const report=JSON.parse(read(path.join(out,'_loc','build-report.json')));
if(!/^\/_loc\/[^?#]+\.css$/.test(report.sharedCss)||!exists(path.join(out,report.sharedCss.slice(1))))
  throw Error('LOC shared CSS missing or invalid: '+report.sharedCss);
if(report.runtime!=='Native React + optional Preact island'||report.bundler!=='esbuild'||report.routes!==pageRoutes.length)
  throw Error('LOC Preact route manifest mismatch');
if(report.editorCss!=='/_loc/routes/editor.css'||!exists(path.join(out,report.editorCss.slice(1))))
  throw Error('LOC editor-on-demand stylesheet missing: '+report.editorCss);
if(!exists(path.join(out,'_loc','routes','public-preferences.js')))
  throw Error('Native Preact preferences island missing');
if(fs.existsSync(path.join(out,'_next')))throw Error('Next.js assets left in LOC export');
const css=read(path.join(out,report.sharedCss.slice(1)));
if(/assets\/pics\//.test(css))throw Error('LOC CSS still bundles raw source image paths');
for(const name of ['LOC-culture','LOC-statics','LOC-search','LOC-admin','scope-culture','scope-statics']){
  const old=path.join(out,'_loc','assets');
  if(fs.existsSync(old)&&fs.readdirSync(old).some(file=>file.startsWith(name+'-')&&/\.(?:jpg|jpeg|png|webp)$/.test(file)))
    throw Error('LOC duplicated Web image in JS/CSS assets: '+name);
}

if(!fs.existsSync(path.join(out,'pics')))throw Error('LOC image URL path /pics not staged');
if(native&&fs.existsSync(path.join(out,'pics','64Card_org')))throw Error('IPA contains originals');
for(const route of pageRoutes){
  const entry=path.join(out,route.slice(1),'index.html');
  if(!exists(entry))throw Error('Missing route: '+route);
  const html=read(entry);
  if(!html.includes('href="'+report.sharedCss+'"'))throw Error('LOC shared CSS not linked from '+route);
  const publicHome=!native&&['/','/lo3rwang/','/lrunes/'].includes(route);
  const src=html.match(/<script type="module" src="(\/_loc\/routes\/p\d+\.js)"><\/script>/)?.[1];
  if(publicHome){
    if(html.includes('href="'+report.editorCss+'"'))
      throw Error('LOC public homepage should not download editor CSS: '+route);
    if(src||!html.includes('id="loc-static-upgrade"')||!html.includes('data-loc-upgrade="edit"'))
      throw Error('LOC public home must not automatically start Preact: '+route);
    if(!html.includes('class="loc-view loc-home"')||!html.includes('loc-home-block__header'))
      throw Error('LOC public home published content missing: '+route);
  }else if(!src||!exists(path.join(out,src.slice(1))))
    throw Error('Missing executable Preact bundle for '+route);
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
