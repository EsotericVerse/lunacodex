// Read the matching JSON-RPC reply without waiting for a long-lived MCP SSE stream to close.
// Upstream tokens and tool authorization stay in the existing Provider Manager.
export async function readUpstreamSseReply(body,id,validate,maxBytes=300000){
  if(!body?.getReader)throw new Error('Empty upstream MCP SSE response');
  const reader=body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,pending='',dataLines=[],finished=false;
  function finishEvent(){
    if(!dataLines.length)return null;
    const data=dataLines.join('\n');
    dataLines=[];
    let message;
    try{message=JSON.parse(data)}catch{return null}
    if(message?.jsonrpc!=='2.0'||message.id!==id)return null;
    const result=validate(message,id);
    if(!result)throw new Error('Invalid upstream MCP response');
    return result;
  }
  function acceptLine(line){
    if(line.endsWith('\r'))line=line.slice(0,-1);
    if(line==='')return finishEvent();
    if(line.startsWith('data:'))dataLines.push(line.slice(5).replace(/^ /,''));
    return null;
  }
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done){finished=true;break}
      bytes+=value.byteLength;
      if(bytes>maxBytes)throw new Error('Upstream MCP SSE exceeds size limit');
      pending+=decoder.decode(value,{stream:true});
      let newline;
      while((newline=pending.indexOf('\n'))!==-1){
        const line=pending.slice(0,newline);
        pending=pending.slice(newline+1);
        const matched=acceptLine(line);
        if(matched)return matched;
      }
    }
    pending+=decoder.decode();
    if(pending){
      const matched=acceptLine(pending);
      if(matched)return matched;
    }
    const matched=finishEvent();
    if(matched)return matched;
    throw new Error('Upstream MCP response is missing its request ID');
  }finally{
    // Never wait for an upstream stream to close or acknowledge cancellation.
    if(!finished)void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
