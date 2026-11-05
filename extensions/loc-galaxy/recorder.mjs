// Stage 3: explicit, user-provided source records only; never invent conversation text.
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function timestamp(value){
  if(typeof value!=='string'||!ISO.test(value)||!Number.isFinite(Date.parse(value)))
    throw Error('對話時間必須是含時區的 ISO 8601');
  return value;
}
export function validateConversation(input){
  if(!input||Array.isArray(input)||typeof input!=='object')
    throw Error('請選擇包含完整對話資訊的 JSON 物件');
  const conversation_id=String(input.conversation_id||'').trim();
  if(!conversation_id||conversation_id.length>200||/[\u0000-\u001f]/.test(conversation_id))
    throw Error('來源 conversation_id 不合法');
  const updated_at=timestamp(input.updated_at);
  if(!Array.isArray(input.records)||input.records.length<1||input.records.length>100)
    throw Error('每次只能匯入 1–100 則來源訊息');
  const seen=new Set();
  const records=input.records.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||
      !['user','assistant'].includes(r.role)||
      (r.role==='user'&&r.kind!=='original')||
      (r.role==='assistant'&&r.kind!=='advice'))
      throw Error('第 '+(i+1)+' 則訊息的 role/kind 不符合來源契約');
    const message_id=String(r.message_id||'').trim();
    if(!message_id||message_id.length>250||seen.has(message_id))
      throw Error('來源 message_id 缺失或重複');
    seen.add(message_id);
    if(typeof r.text!=='string'||!r.text.trim())
      throw Error('第 '+(i+1)+' 則訊息沒有原文');
    return {role:r.role,kind:r.kind,sent_at:timestamp(r.sent_at),text:r.text,message_id};
  });
  if(records.some(r=>Date.parse(r.sent_at)>Date.parse(updated_at)))
    throw Error('來源訊息時間晚於 updated_at');
  if(JSON.stringify(records).length>120000)
    throw Error('本批內容超出 Galaxy Record 限額，請由來源拆批');
  const uid=input.uid;
  if(uid!==undefined&&!/^[A-Za-z0-9]{8}$/.test(String(uid)))
    throw Error('接續話題 UID 必須是八碼 Base62');
  return {conversation_id,updated_at,records,...(uid?{uid:String(uid)}:{})};
}
