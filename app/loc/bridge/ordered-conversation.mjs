// Ordered MCP conversation projection. No provider selection, new SQL table,
// semantic re-comparison, capture-time sorting or user-scroll control.
const PREFIX='[[LOC-OrderedConversation:v1]]\n';
const END='\n[[/LOC-OrderedConversation]]\n';
const MAX_MESSAGES=10000;
const TEXT_MAX=140000;
const reject=(message,status=400)=>{throw Object.assign(new Error(message),{httpStatus:status});};
const safeId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&
 !/[\u0000-\u001f\u007f]/.test(id);
function plainMessage(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||
    !safeId(row.message_id)||!['user','assistant'].includes(row.role)||
    typeof row.text!=='string'||!row.text.trim()||row.text.length>TEXT_MAX||
    !Number.isSafeInteger(row.source_order)||row.source_order<0||
    (row.parent_id!=null&&!safeId(row.parent_id)))
   reject('Original message id, role and source ordinal are required');
 return {message_id:row.message_id,role:row.role,
  source_order:row.source_order,parent_id:row.parent_id||null,text:row.text};
}
export function orderedBatch(records){
 if(!Array.isArray(records)||!records.length)
   reject('Ordered conversation batch requires messages');
 const ids=new Set(),positions=new Set();
 return records.map(raw=>{
  const row=plainMessage(raw);
  if(ids.has(row.message_id)||positions.has(row.source_order))
    reject('Duplicate message ID or source ordinal in one batch',409);
  ids.add(row.message_id);positions.add(row.source_order);
  return row;
 });
}
export function readOrdered(content){
 if(typeof content!=='string'||!content.startsWith(PREFIX))return null;
 const at=content.indexOf(END,PREFIX.length);
 if(at<0)reject('Invalid ordered conversation envelope',409);
 let source;
 try{source=JSON.parse(content.slice(PREFIX.length,at));}catch{reject('Invalid ordered conversation JSON',409);}
 if(!source||source.version!==1||!Array.isArray(source.messages)||
    !source.messages.length||source.messages.length>MAX_MESSAGES)
   reject('Invalid ordered conversation state',409);
 const messages=source.messages.map(plainMessage);
 const ids=new Set(messages.map(x=>x.message_id));
 const positions=new Set(messages.map(x=>x.source_order));
 if(ids.size!==messages.length||positions.size!==messages.length)
   reject('Stored conversation order conflicts',409);
 return messages;
}
export function mergeOrdered(previous,incoming){
 const existing=previous==null?[]:readOrdered(previous);
 if(previous!=null&&!existing)
   reject('Legacy conversation format cannot be rewritten as ordered data',409);
 const byId=new Map(existing.map(row=>[row.message_id,row]));
 const byOrder=new Map(existing.map(row=>[row.source_order,row.message_id]));
 let added=0;
 for(const row of orderedBatch(incoming)){
  const prior=byId.get(row.message_id);
  // Retry is identity-idempotent. Changing source order or text requires a
  // separate explicit revision; it must not silently rewrite a prior turn.
  if(prior){
   if(prior.source_order!==row.source_order||prior.role!==row.role||
      prior.parent_id!==row.parent_id)
     reject('Existing message ID has conflicting source position',409);
   // A retry is identified by the stable message ID and location, not by
   // scanning/re-comparing the message body. Revisions are a separate action.
   continue;
  }
  if(byOrder.has(row.source_order))
    reject('Original turn ordinal belongs to another message',409);
  byId.set(row.message_id,row);
  byOrder.set(row.source_order,row.message_id);
  added++;
 }
 if(byId.size>MAX_MESSAGES)reject('Conversation exceeds message bound',413);
 const messages=[...byId.values()].sort((a,b)=>a.source_order-b.source_order);
 const header=PREFIX+JSON.stringify({version:1,messages})+END;
 const readable=messages.map(row=>'### '+(row.source_order+1)+'. '+
   (row.role==='user'?'使用者':'AI 回覆')+'  #'+row.message_id+
   '\n\n'+row.text).join('\n\n');
 return {content:header+'\n'+readable,added,count:messages.length,
  first_order:messages[0]?.source_order??null};
}
