// Disposable LOC-only compatibility probe. No changes to main, SQL, or IPA.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const output=path.join(root,'out','preact-compat-check');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'loc-preact-check-'));
const npm=process.platform==='win32'?'npm.cmd':'npm';
fs.mkdirSync(output,{recursive:true});
const report={target:'LOC Preact esbuild compatibility',date:new Date().toISOString(),packages:{preact:'10.29.8',esbuild:'0.28.2',locBlockNote:'0.55.0'},cases:[]};
function writeReport(){
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('[preact-check] '+JSON.stringify(report));
}
try{
  const install=spawnSync(npm,['install','--prefix',sandbox,'--no-save','--no-package-lock','--no-audit','--no-fund','preact@10.29.8','esbuild@0.28.2'],{cwd:root,encoding:'utf8',timeout:130000});
  if(install.status!==0)throw Error('Isolated install failed: '+(install.stderr||install.stdout||String(install.error)).slice(-2200));
  const {build}=await import(pathToFileURL(path.join(sandbox,'node_modules','esbuild','lib','main.js')).href);
  const p=path.join(sandbox,'node_modules','preact');
  const alias={
    react:path.join(p,'compat'),
    'react-dom':path.join(p,'compat'),
    'react-dom/client':path.join(p,'compat','client'),
    'react-dom/server':path.join(p,'compat','server'),
    'react-dom/test-utils':path.join(p,'test-utils'),
    'react/jsx-runtime':path.join(p,'jsx-runtime'),
    'react/jsx-dev-runtime':path.join(p,'jsx-dev-runtime')
  };
  const common={
    bundle:true,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',
    jsxImportSource:'react',alias,logLevel:'silent',minify:true,
    define:{'process.env.NODE_ENV':'"production"'},
    loader:{'.woff':'file','.woff2':'file','.ttf':'file','.png':'file','.svg':'file','.webp':'file','.gif':'file'},
    assetNames:'assets/[name]-[hash]',metafile:true
  };
  const cases=[
    {
      name:'BlockNote-0.55-Mantine-Motion',
      contents:[
        "import React,{useState} from 'react';",
        "import {createRoot} from 'react-dom/client';",
        "import {useCreateBlockNote} from '@blocknote/react';",
        "import {BlockNoteView} from '@blocknote/mantine';",
        "import {motion} from 'motion/react';",
        "function App(){const editor=useCreateBlockNote();const [changes,setChanges]=useState(0);",
        "return <div><motion.div id='motion-check' initial={{opacity:0}} animate={{opacity:1}}>motion</motion.div>",
        "<div id='editor-check'><BlockNoteView editor={editor} onChange={()=>setChanges(n=>n+1)}/></div>",
        "<output id='changes'>{changes}</output></div>;}",
        "createRoot(document.getElementById('root')).render(<App/>);",
        "window.__locPreactProbe={kind:'basic',rootRequested:true};"
      ].join('\n')
    },
    {
      name:'Actual-LOC-BlockNoteEditorClient',
      contents:[
        "import React,{useState} from 'react';",
        "import {createRoot} from 'react-dom/client';",
        "import BlockNoteEditorClient from './app/loc/editor/BlockNoteEditorClient.jsx';",
        "function App(){const [changes,setChanges]=useState(0);return <div id='editor-check'>",
        "<BlockNoteEditorClient initialBlocks={[{type:'paragraph',content:[]}]} onHtmlChange={()=>setChanges(n=>n+1)}/>",
        "<output id='changes'>{changes}</output></div>;}",
        "createRoot(document.getElementById('root')).render(<App/>);",
        "window.__locPreactProbe={kind:'LOC-original',rootRequested:true};"
      ].join('\n')
    }
  ];
  for(let i=0;i<cases.length;i++){
    const testcase=cases[i],stem=i===0?'basic':'loc';
    try{
      const result=await build({...common,
        stdin:{contents:testcase.contents,resolveDir:root,sourcefile:stem+'.jsx',loader:'jsx'},
        entryNames:stem,outdir:output,write:true
      });
      const files=Object.keys(result.metafile.outputs).map(name=>({name:path.relative(root,name),bytes:result.metafile.outputs[name].bytes}));
      report.cases.push({name:testcase.name,status:'bundle-pass',files});
    }catch(err){
      report.cases.push({name:testcase.name,status:'bundle-fail',error:String(err?.message||err).slice(0,5000)});
    }
  }
  const selected=report.cases[1].status==='bundle-pass'?'loc':report.cases[0].status==='bundle-pass'?'basic':null;
  if(selected){
    fs.writeFileSync(path.join(output,'index.html'),
      '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>LOC Preact isolated smoke test</title>'+
      '<link rel="stylesheet" href="./'+selected+'.css">'+
      '<style>body{font-family:Arial,sans-serif;padding:24px}#root{max-width:800px;margin:auto}</style>'+
      '<script>window.__locPreactErrors=[];addEventListener("error",e=>window.__locPreactErrors.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__locPreactErrors.push(String(e.reason)));</script>'+
      '</head><body><h1>LOC Preact compatibility probe ('+selected+')</h1>'+
      '<div id="root"></div><script type="module" src="./'+selected+'.js"></script></body></html>');
    report.smokePage='preact-compat-check/index.html';
    report.browserCandidate=selected;
  }
}catch(error){
  report.setupError=String(error?.message||error);
}finally{
  writeReport();
  fs.rmSync(sandbox,{recursive:true,force:true});
}
