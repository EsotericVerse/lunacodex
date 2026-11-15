// Offline signature inspection of a small file prefix. Names/extensions are deliberately ignored.
// This provides a hint for choosing a future parser; it never rewrites or parses the stored file.
export const PRIVATE_SNIFF_BYTES=96*1024;
const CODES=Object.freeze({
  'msn-xml':'疑似 MSN／Windows Live Messenger XML 對話',
  'chat-xml':'疑似 XML 對話紀錄（來源未確認）',
  'chat-text':'疑似文字對話紀錄（來源未確認）',
  'json':'JSON 資料',
  'xml':'XML 文件',
  'html':'HTML 文件',
  'text':'一般文字',
  'zip':'ZIP 封裝檔',
  'pdf':'PDF 文件',
  'sqlite':'SQLite 資料庫',
  'image':'圖片',
  'binary':'二進位資料',
  'unknown':'無法辨識的檔案'
});
const first=(bytes,...n)=>n.every((v,i)=>bytes[i]===v);
const validText=string=>string&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(string.slice(0,16000));
function guessEncoding(bytes){
  if(first(bytes,0xef,0xbb,0xbf))return {name:'utf-8',confidence:'high'};
  if(first(bytes,0xff,0xfe))return {name:'utf-16le',confidence:'high'};
  if(first(bytes,0xfe,0xff))return {name:'utf-16be',confidence:'high'};
  const limit=Math.min(bytes.length,Math.floor(8192/2)*2);
  let even=0,odd=0;
  for(let i=0;i<limit;i+=2){if(bytes[i]===0)even++;if(bytes[i+1]===0)odd++;}
  if(limit>=8&&odd>limit*.12&&even<limit*.015)return {name:'utf-16le',confidence:'medium'};
  if(limit>=8&&even>limit*.12&&odd<limit*.015)return {name:'utf-16be',confidence:'medium'};
  return {name:'utf-8',confidence:'medium'};
}
function decode(bytes,encoding,fatal=false){
  try{return new TextDecoder(encoding,{fatal}).decode(bytes);}catch{return null;}
}
function signature(bytes){
  if(first(bytes,0x50,0x4b,0x03,0x04)||first(bytes,0x50,0x4b,0x05,0x06))return 'zip';
  if(first(bytes,0x25,0x50,0x44,0x46,0x2d))return 'pdf';
  if(new TextDecoder('ascii').decode(bytes.subarray(0,16))==='SQLite format 3\u0000')return 'sqlite';
  if(first(bytes,0x89,0x50,0x4e,0x47)||first(bytes,0xff,0xd8,0xff)||first(bytes,0x47,0x49,0x46,0x38)||first(bytes,0x52,0x49,0x46,0x46)&&new TextDecoder('ascii').decode(bytes.subarray(8,12))==='WEBP')return 'image';
  if(first(bytes,0x1f,0x8b))return 'binary'; // gzip; not a text file
  if(first(bytes,0xd0,0xcf,0x11,0xe0))return 'binary'; // legacy Office/OLE
  return '';
}
function entry(kind,encoding='',certainty='low',reason=''){
  return {kind,label:CODES[kind],encoding,certainty,reason,textual:['msn-xml','chat-xml','chat-text','json','xml','html','text'].includes(kind)};
}
export function detectPrivateFileContent(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input||0);
  if(!bytes.length)return entry('unknown','','low','檔案沒有內容或樣本為空');
  const magic=signature(bytes);
  if(magic)return entry(magic,'','high','依據檔案二進位標頭');
  const guessed=guessEncoding(bytes);
  let encoding=guessed.name;
  let source=decode(bytes,encoding,true);
  if(source===null){
    // Fallback for legacy Chinese chat exports. Other legacy encodings may need manual choice.
    if(encoding!=='utf-8')source=decode(bytes,encoding);
    else{
      const big5=decode(bytes,'big5');
      if(validText(big5)){
        const replacement=(big5.match(/\ufffd/g)||[]).length;
        const han=(big5.match(/[\u3400-\u9fff]/g)||[]).length;
        if(han>0&&replacement<Math.max(2,big5.length*.005)){
          source=big5;encoding='big5';
        }
      }
    }
  }
  if(!validText(source))return entry('binary','','medium','文字編碼檢查不通過；沒有猜測文件格式');
  const trimmed=source.replace(/^\ufeff/,'').trimStart();
  // An XML declaration overrides a heuristic only when it names a decoder we can actually use.
  const declaration=trimmed.match(/^<\?xml\s[^>]*\bencoding\s*=\s*["']([^"']+)["']/i);
  if(declaration){
    const name=declaration[1].trim().toLowerCase();
    const normalized=/^(?:utf-16|utf-16le)$/.test(name)?'utf-16le':name;
    const recoded=decode(bytes,normalized,true);
    if(recoded!==null&&validText(recoded)){
      encoding=normalized;source=recoded;
    }
  }
  const sample=source.replace(/^\ufeff/,'').slice(0,PRIVATE_SNIFF_BYTES);
  const xml=/^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<([a-z][\w:.-]*)[\s>]/i.test(sample);
  const msg=/<(?:\w+:)?Message\b[^>]*\bDateTime\s*=\s*["'][^"']+["']/i.test(sample);
  const sender=/<(?:\w+:)?From\b[^>]*>[\s\S]{0,1200}?<(?:\w+:)?User\b[^>]*\bFriendlyName\s*=/i.test(sample);
  const content=/<(?:\w+:)?Text\b[^>]*>/i.test(sample);
  const msnLog=/<(?:\w+:)?Log\b[^>]*\bFirstSessionID\s*=/i.test(sample);
  if(xml&&msg&&sender&&content&&msnLog)
    return entry('msn-xml',encoding,'high','具有 MSN Log、訊息時間、發話者與文字節點');
  if(xml&&msg&&sender&&content)
    return entry('msn-xml',encoding,'medium','符合 MSN 訊息節點模式，但缺少來源標記');
  if(xml&&/<(?:\w+:)?Message\b/i.test(sample)&&/<(?:\w+:)?(?:From|Sender|Participant)\b/i.test(sample))
    return entry('chat-xml',encoding,'medium','具有 XML 訊息及發話者結構');
  if(xml)return entry('xml',encoding,'high','符合 XML 開頭結構');
  if(/^\s*<!doctype\s+html\b|^\s*<html\b/i.test(sample))return entry('html',encoding,'high','具有 HTML 文件標記');
  if(/^\s*[\[{]/.test(sample)){
    // Partial large JSON samples might be truncated: do not require complete JSON parsing.
    try{JSON.parse(sample);return entry('json',encoding,'high','可讀取的 JSON 結構');}
    catch{
      if(/^\s*\{\s*"[^"]+"\s*:|^\s*\[\s*\{/s.test(sample))
        return entry('json',encoding,'medium','具有 JSON 結構特徵，可能只讀到部分檔案');
    }
  }
  const lines=sample.split(/\r?\n/).slice(0,60);
  const chatLines=lines.filter(line=>/^\s*(?:\[?\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}[^\]]{0,25}\]?|\[?\d{1,2}:\d{2}(?::\d{2})?\]?)\s+[^:：\n]{1,60}[:：]\s*\S/.test(line));
  if(chatLines.length>=3)return entry('chat-text',encoding,'medium','多行符合「時間＋發話者＋內容」排列');
  return entry('text',encoding,guessed.confidence,'文字可解碼，但目前未辨識出特定對話格式');
}
