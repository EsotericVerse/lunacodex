// Bounded WHATWG streams for LOC MCP/native traffic. Parser: MIT @streamparser/json.
import {JSONParser} from '@streamparser/json';

export class BodyTooLargeError extends Error {
  constructor(limit){
    super('Payload exceeds '+limit+' bytes');
    this.name='BodyTooLargeError';
    this.httpStatus=413;
  }
}
async function consume(body,limit,accept){
  if(!body?.getReader)throw new SyntaxError('Empty response body');
  const reader=body.getReader();
  let size=0,finished=false;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done){finished=true;break}
      size+=value.byteLength;
      if(size>limit)throw new BodyTooLargeError(limit);
      accept(value);
    }
  }finally{
    if(!finished)await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
// Root-only emission avoids the parser's default repeated nested-value callbacks.
export async function readBoundedJson(body,limit){
  const parser=new JSONParser({paths:['$'],stringBufferSize:65536});
  let root,seen=false;
  parser.onValue=({value})=>{if(seen)throw new SyntaxError('Multiple JSON roots');root=value;seen=true};
  await consume(body,limit,chunk=>parser.write(chunk));
  if(!parser.isEnded)parser.end();
  if(!seen)throw new SyntaxError('Invalid or empty JSON');
  return root;
}
// SSE framing is text, not JSON; cap its UTF-8 input before parsing events.
export async function readBoundedText(body,limit){
  const decoder=new TextDecoder();
  let text='';
  await consume(body,limit,chunk=>{text+=decoder.decode(chunk,{stream:true})});
  return text+decoder.decode();
}
