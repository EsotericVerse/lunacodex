#!/usr/bin/env node
// Write-only LOC CLI. Accepts a JSON object from stdin or a file.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const sources={c:'chatgpt.com',p:'github.com',m:'web'};
const [,,category,action,file]=process.argv;
if(!(category in sources)||!['s','save'].includes(action)){
 console.error('Usage: loc {c|p|m} s [record.json] (or pipe a JSON object on stdin)');
 process.exitCode=2;
}else try{
 const endpoint=process.env.LOC_CHANNEL1_URL,token=process.env.LOC_CHANNEL1_TOKEN;
 if(!endpoint||!endpoint.startsWith('https://')||!token)throw Error('LOC_CHANNEL1_URL and LOC_CHANNEL1_TOKEN are required');
 let raw;
 if(file)raw=await readFile(file,'utf8');
 else{const parts=[];for await(const p of process.stdin)parts.push(p);raw=Buffer.concat(parts).toString('utf8');}
 const input=JSON.parse(raw);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('JSON object required');
 const content=String(input.content||'');
 if(!content)throw Error('content required');
 if(content.length>140000)throw Error('CLI content exceeds 140000 chars; split into chunks');
 const id=randomUUID(),group_id=randomUUID();
 const record={...input,id,group_id,part_index:0,part_count:1,
  source:String(input.source||sources[category]),title:String(input.title||'LOC 紀錄'),
  url:String(input.url||''),content,captured_at:input.captured_at||new Date().toISOString()};
 const batch={id:randomUUID(),records:[record]};
 const res=await fetch(endpoint.replace(/\/$/,'')+'/v1/batch',{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify(batch)});
 if(!res.ok)throw Error('KV HTTP '+res.status+': '+(await res.text()).slice(0,200));
 const result=await res.json();if(result.accepted!==true)throw Error('KV did not acknowledge');
 console.log(JSON.stringify(result));
}catch(e){console.error('loc:',e.message);process.exitCode=1;}
