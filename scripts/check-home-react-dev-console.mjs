// CI smoke test: visit the real Next.js *development* homepage and capture
// React's key warnings through Chromium DevTools. No Playwright/npm package added.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const url='http://127.0.0.1:3000/';
const homeClass='.loc-home-motion-block';
const keyWarning=/Each child in a list should have a unique ["']key["'] prop/i;
const chromeBin=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if(!chromeBin)throw new Error('Chrome/Chromium missing: developer-console smoke test cannot run');
if(typeof WebSocket!=='function')throw new Error('Node 22 WebSocket API is required');

const directory=mkdtempSync(join(tmpdir(),'loc-react-console-'));
const pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm';
const server=spawn(pnpm,['run','dev'],{
  cwd:process.cwd(),detached:process.platform!=='win32',
  env:{...process.env,CI:'true',NEXT_TELEMETRY_DISABLED:'1',PORT:'3000'},
  stdio:['ignore','pipe','pipe']
});
let serverLog='',browser=null,socket=null;
for(const output of [server.stdout,server.stderr])
  output.on('data',chunk=>{serverLog=(serverLog+chunk.toString()).slice(-30000);});
const notes=[];
const within=async(fn,ms,label)=>{
  const start=Date.now();
  while(Date.now()-start<ms){
    const value=await fn();
    if(value)return value;
    if(server.exitCode!==null)throw new Error('Next dev exited before '+label+': '+serverLog.slice(-2000));
    await sleep(500);
  }
  throw new Error('Timed out waiting for '+label+': '+serverLog.slice(-2000));
};
function stopServer(){
  if(process.platform!=='win32'&&server.pid){
    try{process.kill(-server.pid,'SIGTERM');return;}catch{}
  }
  try{server.kill('SIGTERM');}catch{}
}

try{
  await within(async()=>{
    try{return (await fetch(url)).status===200;}catch{return false;}
  },100000,'Next.js development server');

  browser=spawn(chromeBin,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--disable-extensions','--remote-allow-origins=*',
    '--remote-debugging-port=0','--user-data-dir='+directory,'about:blank'
  ],{stdio:'ignore'});
  const activePortFile=join(directory,'DevToolsActivePort');
  await within(()=>existsSync(activePortFile),30000,'Chrome DevTools port');
  const port=Number(readFileSync(activePortFile,'utf8').split('\n')[0]);
  assert.ok(Number.isInteger(port)&&port>0,'Invalid Chrome DevTools port');

  const tab=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})
    .then(r=>{if(!r.ok)throw new Error('Chrome tab failed: '+r.status);return r.json();});
  socket=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',()=>reject(new Error('Chrome CDP WebSocket failed')),{once:true});
  });

  let requestId=0;
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const data=JSON.parse(String(event.data));
    if(data.id){
      const waiter=pending.get(data.id);
      if(waiter){pending.delete(data.id);data.error?waiter.reject(new Error(JSON.stringify(data.error))):waiter.resolve(data.result);}
      return;
    }
    if(data.method==='Runtime.consoleAPICalled'){
      const p=data.params||{};
      if(['warning','error','assert'].includes(p.type))
        notes.push((p.args||[]).map(a=>String(a.value??a.description??'')).join(' '));
    }
    if(data.method==='Log.entryAdded'&&['warning','error'].includes(data.params?.entry?.level))
      notes.push(String(data.params.entry.text||''));
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++requestId;
    pending.set(id,{resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.navigate',{url});

  // The public snapshot contains five actual LOC homepage blocks. A single
  // placeholder is rendered before the async snapshot resolves and must NOT
  // count as proof that the real homepage has hydrated.
  const hydrated=await within(async()=>{
    const result=await call('Runtime.evaluate',{
      expression:'({count:document.querySelectorAll("'+homeClass+'").length,heading:document.querySelector(".loc-home-block__header h1")?.textContent?.trim()||""})',
      returnByValue:true
    });
    const data=result?.result?.value;
    return data?.count>=5&&data?.heading?data:null;
  },100000,'five published LOC homepage blocks and hero heading');

  // The warning can arrive after async published Blocks resolve/hydrate.
  await sleep(3000);
  const captured=[...notes,serverLog].join('\n');
  assert.doesNotMatch(captured,keyWarning,
    'React key warning still occurs in the real developer console');
  console.log('LOC development React console: '+hydrated.count+' published homepage blocks, hero '+JSON.stringify(hydrated.heading)+'; no missing key warning');
}finally{
  try{socket?.close();}catch{}
  try{browser?.kill('SIGTERM');}catch{}
  stopServer();
  rmSync(directory,{recursive:true,force:true});
}
