#!/usr/bin/env node
// LOC Channel 1: write-only CLI, independent of Clerk, MCP and scopeid.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const sources={c:'chat',p:'github_pr',m:'media'};
const [, ,category,action,filepath]=process.argv;
if(!(category in sources)||!['s','save'].includes(action)){
 console.error('Usage: loc {c|p|m} {s|save} [record.json] (or pipe JSON through stdin)');
 process.exitCode=2;
}else try{
 const endpoint=process.env.LOC_CHANNEL1_URL,token=process.env.LOC_CHANNEL1_TOKEN;
 if(!endpoint||!endpoint.startsWith('https://')||!token)throw Error('LOC_CHANNEL1_URL and LOC_CHANNEL1_TOKEN required');
 let input;
 if(filepath)input=await readFile(filepath,'utf8');
 else{const chunks=[];for await(const x of process.stdin)chunks.push(x);input=Buffer.concat(chunks).toString('utf8');}
 const value=JSON.parse(input);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON object required');
 const record={...value,id:value.id||randomUUID(),source:value.source||sources[category],content:String(value.content||''),captured_at:value.captured_at||new Date().toISOString()};
 if(!record.content)throw Error('Record content cannot be empty');
 const response=await fetch(endpoint.replace(/\/$/,'')+'/v1/record',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(record)});
 if(!response.ok)throw Error('KV HTTP '+response.status+': '+(await response.text()).slice(0,200));
 console.log(JSON.stringify(await response.json()));
}catch(error){console.error('loc:',error.message);process.exitCode=1;}
