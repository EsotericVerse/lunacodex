import http from 'node:http';
import {runComputeJob} from '../../app/loc/compute/operations.mjs';
import {COMPUTE_PROTOCOL,COMPUTE_MAX_BYTES} from '../../app/loc/compute/contract.mjs';

const server=http.createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');
  if(req.method==='GET'&&req.url==='/health'){res.end(COMPUTE_PROTOCOL);return;}
  if(req.method!=='POST'||req.url!=='/compute'){res.statusCode=404;res.end();return;}
  try{
    let bytes=0;const chunks=[];
    for await(const chunk of req){
      bytes+=chunk.length;
      if(bytes>COMPUTE_MAX_BYTES){res.statusCode=413;res.end();return;}
      chunks.push(chunk);
    }
    const job=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const data=await runComputeJob(job);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({protocol:COMPUTE_PROTOCOL,data}));
  }catch{
    // Never log article contents, rules or import payloads.
    res.statusCode=422;res.end();
  }
});
server.requestTimeout=45000;
const port=Number(process.env.PORT||8080);
if(!Number.isInteger(port)||port<1||port>65535)
  throw new Error('Invalid LOC Compute port');
server.listen(port,'0.0.0.0');
