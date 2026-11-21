// LOC native Node.js development server. No Express or website framework.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root=path.resolve('out');
const mime={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.avif':'image/avif',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.wasm':'application/wasm',
  '.ico':'image/x-icon'
};
const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url||'/', 'http://127.0.0.1');
    if(url.pathname==='/api/loc-framework'){
      const {onRequestGet}=await import('../functions/api/loc-framework.js');
      const result=request.method==='GET'
        ?await onRequestGet({request:new Request(url,{method:'GET'}),env:process.env})
        :new Response(JSON.stringify({error:'GET required'}),{status:405,
          headers:{'content-type':'application/json'}});
      response.writeHead(result.status,Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    if(url.pathname.startsWith('/api/')){
      response.writeHead(404,{'content-type':'application/json; charset=utf-8'});
      response.end(JSON.stringify({error:'Unknown LOC native API'}));return;
    }
    const pathname=decodeURIComponent(url.pathname);
    const relative=pathname.endsWith('/')?pathname+'index.html':
      path.extname(pathname)?pathname:pathname+'/index.html';
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep)){
      response.writeHead(403);response.end();return;
    }
    fs.stat(file,(error,stat)=>{
      if(error||!stat.isFile()){
        response.writeHead(404);response.end('Not Found');return;
      }
      response.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');
      fs.createReadStream(file).on('error',()=>response.destroy()).pipe(response);
    });
  }catch(error){
    response.writeHead(500,{'content-type':'text/plain; charset=utf-8'});
    response.end('LOC native server error');
    console.error('LOC development server',error?.message||error);
  }
});
const port=Number(process.env.PORT||8000);
server.listen(port,'127.0.0.1',()=>console.log('LOC Framework: http://127.0.0.1:'+port));
