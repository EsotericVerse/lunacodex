// LOC's build-time Router manifest for one physical Web feature shell.
// The 80 authored page.html files remain the source of per-route meaning.
// On Web, Cloudflare Pages rewrites only those known paths to this one shell;
// API, assets, SEO homepages, legacy redirects and outbound services are not
// routed through a new JavaScript framework or runtime database query.
const featureComponents=new Set(['loc','settings','features','phone']);
const escapeScript=value=>JSON.stringify(value)
  .replaceAll('<','\\u003c').replaceAll('>','\\u003e')
  .replaceAll('&','\\u0026');

export function sharedWebRoutes(pages){
  return pages.filter(page=>featureComponents.has(page.component)&&
    !['/','/lo3rwang/','/lrunes/'].includes(page.route));
}
export function shellRouteManifest(pages){
  return Object.fromEntries(sharedWebRoutes(pages).map(page=>[page.route,{
    component:page.component,scope:page.scope,view:page.view,
    section:page.section||'',title:page.title,
    description:page.description||'',noIndex:page.noIndex===true
  }]));
}
export function shellRouteBootstrap(pages){
  const manifest=shellRouteManifest(pages);
  // Resolve before loading the interactive page. The existing LOC HTML
  // canvas, nav and six-key dock are reused without another AppShell mount.
  return '<script id="loc-shared-route-bootstrap">(()=>{'+
    'const routes='+escapeScript(manifest)+';'+
    'const raw=location.pathname.replace(/\\/index\\.html$/,"/");'+
    'const key=raw.endsWith("/")?raw:raw+"/";'+
    'const page=routes[key];'+
    'if(!page){document.body.dataset.locComponent="invalid";return;}'+
    'const body=document.body;'+
    'body.dataset.locComponent=page.component;'+
    'body.dataset.locScope=page.scope;'+
    'body.dataset.locView=page.view;'+
    'if(page.section)body.dataset.locSection=page.section;'+
    'else delete body.dataset.locSection;'+
    'document.title=page.title;'+
    'const description=document.querySelector("meta[name=description]");'+
    'if(description)description.content=page.description;'+
    'const canonical=document.querySelector("link[rel=canonical]");'+
    'if(canonical)canonical.href="https://loc.lo3rwang.cc"+key;'+
    'const robots=document.querySelector("meta[name=robots]");'+
    'if(page.noIndex&&!robots){const m=document.createElement("meta");'+
      'm.name="robots";m.content="noindex,nofollow";document.head.append(m);}'+
    'const heading=document.getElementById("loc-static-feature-title");'+
    'if(heading)heading.textContent=page.title;'+
    'const main=document.querySelector("[data-loc-view]");'+
    'if(main){main.dataset.locView=page.view;main.dataset.locScope=page.scope;}'+
    'const base=page.scope==="loc"?"/":"/"+page.scope+"/";'+
    'const feature=page.view==="keywords"?"statics":page.view==="sourceManage"?"culture":'+
      'page.view==="searchManage"?"search":page.view==="manage"?"trace":'+
      'page.component==="settings"||page.component==="features"?"settings":page.view;'+
    'for(const link of document.querySelectorAll("[data-loc-feature-link]")){'+
    'const id=link.dataset.locFeatureLink;'+
    'link.href=id==="settings"?"/settings/?scopeid="+encodeURIComponent(page.scope):'+
      'base+(id==="home"?"":id+"/");'+
    'if(id===feature)link.setAttribute("aria-current","page");'+
    'else link.removeAttribute("aria-current");}'+
    'const dock=document.querySelector(".scope-feature-dock");'+
    'if(dock)dock.dataset.scope=page.scope;'+
    'for(const item of document.querySelectorAll("[data-loc-scope-link]")){'+
    'if(item.dataset.locScopeLink===page.scope)item.setAttribute("aria-current","page");'+
    'else item.removeAttribute("aria-current");}'+
  '})();</script>';
}
export function sharedWebRedirects(pages){
  return sharedWebRoutes(pages).flatMap(page=>{
    const root=page.route.endsWith('/')?page.route.slice(0,-1):page.route;
    // Explicit exact paths only: no catch-all to swallow assets or /api.
    return [root,root+'/'].filter(Boolean)
      .map(path=>path+' /_loc/shell.html 200');
  }).join('\n')+'\n';
}
export function sharedWebRobotsHeaders(pages){
  return sharedWebRoutes(pages)
    .filter(page=>page.noIndex)
    .map(page=>page.route+'\n  X-Robots-Tag: noindex, nofollow')
    .join('\n');
}
