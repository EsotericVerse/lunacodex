// Node-only, bounded-memory staging of a complete logical LOC dataset.
// The SQL scan writes NDJSON on local temporary disk. FlexSearch holds only
// ONE shard in memory at a time; neither SQL nor Cloudflare KV is modified
// until the complete source scan has passed count/UID checks.
import {mkdtemp,open,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const UID=/^[A-Za-z0-9]{8}$/;
const MAX_SHARD_JSON_BYTES=16*1024*1024;

export async function stageAndPublishLocIndex({
  rows,expected,scopeId,dbId,shardCount=32,shardOf,documentId,
  makeIndex,publish,stageDirectory=tmpdir()
}){
  if(!rows||typeof rows[Symbol.asyncIterator]!=='function'||
     !Number.isSafeInteger(expected)||expected<0||
     !Number.isSafeInteger(shardCount)||shardCount<1||shardCount>256||
     typeof shardOf!=='function'||typeof documentId!=='function'||
     typeof makeIndex!=='function'||typeof publish!=='function')
    throw new TypeError('Invalid bounded LOC index builder configuration');
  const directory=await mkdtemp(join(stageDirectory,'loc-index-'));
  const paths=Array.from({length:shardCount},(_,i)=>join(directory,'s'+i+'.ndjson'));
  const handles=new Array(shardCount).fill(null);
  const counts=new Array(shardCount).fill(0);
  const seen=new Set();
  let uploaded=0,committed=false;
  try{
    for await(const row of rows){
      const uid=String(row?.uid||'');
      if(!UID.test(uid)||seen.has(uid)||typeof row?.content!=='string')
        throw Error('Invalid, missing or duplicated source Galaxy UID: '+uid);
      seen.add(uid);
      if(seen.size>expected)throw Error('Source increased during index scan');
      const shard=shardOf(uid);
      if(!Number.isInteger(shard)||shard<0||shard>=shardCount)
        throw Error('Invalid FlexSearch shard');
      if(!handles[shard])handles[shard]=await open(paths[shard],'a');
      await handles[shard].writeFile(JSON.stringify({uid,content:row.content})+'\n');
      counts[shard]++;
    }
    if(seen.size!==expected)
      throw Error('SQL coverage mismatch: expected '+expected+', scanned '+seen.size);
    for(let i=0;i<shardCount;i++){
      if(handles[i]){await handles[i].close();handles[i]=null;}
    }
    await publish({phase:'begin',count:seen.size,shards:counts.filter(Boolean).length});
    for(let shard=0;shard<shardCount;shard++){
      if(!counts[shard])continue;
      const index=makeIndex();
      const input=createReadStream(paths[shard],{encoding:'utf8'});
      const lines=createInterface({input,crlfDelay:Infinity});
      try{
        for await(const line of lines){
          const {uid,content}=JSON.parse(line);
          index.add(documentId({scopeId,dbId,uid}),content);
        }
      }finally{lines.close();input.destroy();}
      const parts={};
      await index.export(async(key,value)=>{
        if(value!==undefined&&value!==null)parts[key]=value;
      });
      const size=Buffer.byteLength(JSON.stringify({shard,scopeId,dbId,parts}),'utf8');
      if(size>MAX_SHARD_JSON_BYTES)
        throw Error('One FlexSearch shard exceeds the bounded upload limit: '+shard);
      await publish({phase:'shard',shard,parts,count:counts[shard]});
      uploaded++;
    }
    await publish({phase:'commit',count:seen.size,shards:uploaded});
    committed=true;
    return {indexed:seen.size,shards:uploaded,complete:true};
  }finally{
    for(const h of handles)if(h)await h.close().catch(()=>{});
    await rm(directory,{recursive:true,force:true});
    if(!committed&&uploaded)console.warn('[LOC Search] Incomplete shard upload; index coverage must stay disabled');
  }
}
