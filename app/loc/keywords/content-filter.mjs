// CURRENT scan-only typed projection, not a physical content column, CMS
// migration or replacement article renderer. Match filtered visible title/body;
// retain original Galaxy title/content/HTML for readers and editors.
// Read-only scan projection. Galaxy title/content and their HTML remain unchanged.
const CONTENT_FIELDS=new Set(['text','content','body','paragraph','paragraphs',
  'message','description','lyric','lyrics','story','article','html','blocks',
  'children','rows','cells','heading','caption','quote','excerpt','summary']);
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ensp:' ',emsp:' ',
  ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',
  hellip:'…',bull:'•',middot:'·',copy:'©',reg:'®'};
const ENTITY=/&(?:#(?:x[0-9a-f]{1,7}|[0-9]{1,8})|[a-z][a-z0-9]{1,20});/giu;
const NOISE_BLOCK=/<(script|style|template|noscript|iframe|svg|canvas|nav|aside|footer|form|select)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/giu;
const TAG=/<\/?[a-z][a-z0-9:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>/giu;
const PARTIAL_TAG=/<\/?\s*(?:div|span|script|style|section|article|header|footer|main|nav|p|br|hr|a|img|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|button|input|textarea|form|label|select|svg|path|iframe|link|meta)\b[^<>\r\n]*$/gimu;
const DATE_LABEL=/^(?:日期|時間|發表日期|發文日期|發布日期|date|published|posted)\s*[:：]\s*(.+)$/iu;
const DATE_VALUE=/^(?:\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,3}年\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}\/\d{4})(?:[\sT][0-2]?\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)?(?:\s|$|[（(])/u;
const TITLE_LABEL=/^(?:標題|文章標題|title)\s*[:：]\s*(.+)$/iu;
const DIVIDER=/^[=＝\-─—_*]{4,}$/u;
function unescapeHtml(text){
  return text.replace(ENTITY,entity=>{
    const name=entity.slice(1,-1).toLowerCase();
    if(!name.startsWith('#'))return ENTITIES[name]??' ';
    const hex=name[1]==='x';
    const code=Number.parseInt(name.slice(hex?2:1),hex?16:10);
    return Number.isInteger(code)&&code>31&&code<=0x10ffff&&
      !(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):' ';
  });
}
function fromStructured(value){
  const trimmed=value.trim();
  if(!/^[{[]/.test(trimmed)||!/[}\]]$/.test(trimmed))return null;
  let data;
  try{data=JSON.parse(trimmed)}catch{return null;}
  const out=[];
  const walk=(node,allowed=false,depth=0)=>{
    if(depth>12||out.length>10000)return;
    if(typeof node==='string'){if(allowed)out.push(node);return;}
    if(Array.isArray(node)){for(const child of node)walk(child,allowed,depth+1);return;}
    if(!node||typeof node!=='object')return;
    for(const [key,child] of Object.entries(node)){
      if(CONTENT_FIELDS.has(key.toLowerCase()))walk(child,true,depth+1);
      else if(child&&typeof child==='object')walk(child,false,depth+1);
    }
  };
  // A top-level array of paragraphs may be strings; nested metadata object
  // keys still require an explicit text field before their strings are used.
  walk(data,true);
  return out.join('\n');
}
function stripLegacyPrefix(text){
  const lines=text.replace(/\r\n?/gu,'\n').split('\n');
  let cursor=0,hasHeader=false;
  // Only leading metadata, never date mentions inside the actual article.
  while(cursor<lines.length&&cursor<16){
    const line=lines[cursor].trim();
    if(!line){
      if(hasHeader){cursor++;continue;}
      break;
    }
    const date=line.match(DATE_LABEL);
    if(date&&DATE_VALUE.test(date[1])){hasHeader=true;cursor++;continue;}
    const title=line.match(TITLE_LABEL);
    if(title){
      // A title embedded in the old header is still meaningful search text.
      lines[cursor]=title[1];hasHeader=true;cursor++;continue;
    }
    if(hasHeader&&DIVIDER.test(line)){cursor++;continue;}
    break;
  }
  if(!hasHeader)return text;
  return lines.slice(0,cursor).filter(line=>{
    const trimmed=line.trim();
    return trimmed&&!DATE_LABEL.test(trimmed)&&!DIVIDER.test(trimmed);
  }).concat(lines.slice(cursor)).join('\n');
}
export function content_filter(value,{legacyHeader=true}={}){
  if(value==null)return '';
  let text=typeof value==='string'?value:String(value);
  const structured=fromStructured(text);
  if(structured!==null)text=structured;
  // An inexpensive fast path avoids HTML parsing for ordinary plain prose.
  if(/[<&\x60\[]|https?:\/\//iu.test(text)){
    text=unescapeHtml(text);
    text=text.replace(/<!--[\s\S]*?-->/gu,' ')
      .replace(/<!doctype\b[^>]*>/giu,' ')
      .replace(NOISE_BLOCK,' ')
      .replace(/<br\b[^>]*\/?>|<\/(?:p|div|li|h[1-6]|section|article|tr)>/giu,'\n')
      .replace(TAG,' ')
      .replace(PARTIAL_TAG,' ')
      .replace(/(?:^|\n)[ \t]*\x60{3,}[^\n]*\n[\s\S]*?\n[ \t]*\x60{3,}(?=\n|$)/gu,'\n')
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/giu,' $1 ')
      .replace(/!\[[^\]]*\]\([^)]+\)/gu,' ')
      .replace(/\[(?:\/)?(?:gallery|caption|embed|playlist|audio|video|wp_[\w-]+|vc_[\w-]+)(?:\s+[^\]\r\n]*)?\]/giu,' ')
      .replace(/https?:\/\/[^\s<>"'\])]+/giu,' ');
  }
  text=text.replace(/[ \t]{2,}/gu,' ').replace(/\n[ \t]+/gu,'\n')
    .replace(/\n{3,}/gu,'\n\n');
  return (legacyHeader?stripLegacyPrefix(text):text).trim();
}
export function keywordScanText(row={}){
  const title=content_filter(row?.title,{legacyHeader:false});
  const body=content_filter(row?.content);
  return title&&body?title+'\n'+body:title||body;
}
