// Minimal local server for LOC/esbuild static output. Cloudflare handles /api/* in Preview.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const root=path.resolve('out');
const sharedManifestPath=path.join(root,'_loc','shared-routes.json');
const sharedRoutes=fs.existsSync(sharedManifestPath)
  ?JSON.parse(fs.readFileSync(sharedManifestPath,'utf8')):{};

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.ico':'image/x-icon'};
const server=http.createServer((request,response)=>{
  const url=new URL(request.url||'/', 'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
    response.writeHead(502,{'content-type':'application/json; charset=utf-8'});
    response.end(JSON.stringify({error:'本機靜態伺服器不執行 SQL。請在 Cloudflare Pages Preview 測試 API。'}));
    return;
  }
  const pathname=decodeURIComponent(url.pathname);
  const virtual=pathname.endsWith('/index.html')?pathname.slice(0,-'index.html'.length):pathname;
  const normalized=virtual.endsWith('/')?virtual:virtual+'/';
  // Browser smoke and local Web preview honor the same authored route map
  // as Cloudflare Pages' generated 200 rewrites. IPA still owns index.html.
  const file=Object.hasOwn(sharedRoutes,normalized)
    ?path.join(root,'_loc','shell.html')
    :path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){
    response.writeHead(403);response.end();return;
  }
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){response.writeHead(404);response.end('Not Found');return;}
    response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).on('error',()=>response.destroy()).pipe(response);
  });
});
const port=Number(process.env.PORT||8000);
server.listen(port,'127.0.0.1',()=>console.log('LOC static dev: http://127.0.0.1:'+port));
