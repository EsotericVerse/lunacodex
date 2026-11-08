// JSON and Galaxy Markdown import. ZIP archives are parsed by the separate
// archive streaming pipeline; no Office/PDF parser is part of this module.
import {ARCHIVE_JSON_MAX_BYTES,importRowsFromJson} from './import-batch.mjs';
import {MAX_DOCUMENT_BYTES} from './query-batch-size.mjs';
export {UNIVERSAL_IMPORT_ACCEPT} from './import-batch.mjs';

// The selected *import language* is only an encoding fallback hint. It is
// never stored on Galaxy rows and never converts the article's language.
// A UTF-8 file wins for every language, including Traditional Chinese.
const LEGACY_TEXT_ENCODINGS=Object.freeze({
  'zh-Hant':'big5','zh-Hans':'gb18030',en:'windows-1252',ja:'shift_jis'
});
const TEXT_DOCUMENT_TYPES=new Set(['csv','tsv','html','htm','tex']);
export async function decodeImportText(file,importLocale='zh-Hant'){
  if(typeof file?.arrayBuffer!=='function')return file.text();
  const bytes=new Uint8Array(await file.arrayBuffer());
  const decoder=(label)=>new TextDecoder(label,{fatal:true}).decode(bytes);
  try{
    if(bytes[0]===0xff&&bytes[1]===0xfe)return decoder('utf-16le');
    if(bytes[0]===0xfe&&bytes[1]===0xff)return decoder('utf-16be');
    // UTF-16 without BOM: consider the regular alternating NUL pattern.
    if(bytes.length>=12){
      let even=0,odd=0;
      const limit=Math.min(bytes.length,2048);
      const pairs=Math.floor(limit/2);
      for(let i=0;i<pairs*2;i+=2){
        if(bytes[i]===0)even++;
        if(bytes[i+1]===0)odd++;
      }
      if(odd>pairs*0.4&&even<pairs*0.05)return decoder('utf-16le');
      if(even>pairs*0.4&&odd<pairs*0.05)return decoder('utf-16be');
    }
    return decoder('utf-8');
  }catch(utf8Error){
    try{
      const text=decoder(LEGACY_TEXT_ENCODINGS[importLocale]||'big5');
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text.slice(0,16000)))
        throw new Error('文件含有不正常的控制字元');
      return text;
    }catch{
      throw new Error('檔案無法以 UTF-8 或選定語系的舊式編碼正確解讀；請確認匯入語系及來源。');
    }
  }
}
function extensionOf(name){
  return String(name||'').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()||'';
}
// Galaxy Markdown v1 is a Markdown document with optional, scalar YAML
// frontmatter. Retain Markdown as the article body instead of flattening it
// through the generic document extractor (which discards formatting).
const GALAXY_MARKDOWN_FORMAT='galaxy-md/v1';
const MARKDOWN_HEADER_KEYS=new Set([
  'loc_format','uid','title','created_at','createtime','site',
  'location','searchable','statistics_able'
]);
function scalarFrontmatter(value){
  const raw=String(value||'').trim();
  if((raw.startsWith('"')&&raw.endsWith('"'))||
     (raw.startsWith("'")&&raw.endsWith("'"))){
    if(raw.startsWith('"')){
      try{return JSON.parse(raw);}catch{throw new Error('Markdown 檔頭的引號字串格式有誤。');}
    }
    return raw.slice(1,-1).replace(/''/g,"'");
  }
  return raw;
}
function markdownFrontmatter(input){
  const text=String(input||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const match=/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if(!match){
    if(text.startsWith('---\n')&&/^loc_format\s*:/m.test(text.slice(0,4096)))
      throw new Error('Galaxy Markdown 檔頭缺少結束分隔線 ---。');
    return {fields:Object.create(null),body:text};
  }
  if(match[0].length>65536)throw new Error('Markdown 檔頭超過 64 KiB。');
  const fields=Object.create(null);
  let hasMetadata=false;
  for(const line of match[1].split('\n')){
    if(!line.trim()||/^\s*#/.test(line))continue;
    const pair=/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(line);
    // Non-scalar YAML is not a Galaxy metadata contract. Preserve the
    // original document unless it explicitly claims to be Galaxy Markdown.
    if(!pair){
      if(/^loc_format\s*:/m.test(match[1]))
        throw new Error('Galaxy Markdown v1 檔頭僅支援單行 key: value 欄位。');
      return {fields:Object.create(null),body:text};
    }
    const key=pair[1].toLowerCase();
    if(MARKDOWN_HEADER_KEYS.has(key)){
      if(Object.prototype.hasOwnProperty.call(fields,key))
        throw new Error('Markdown 檔頭有重複欄位：'+key);
      fields[key]=scalarFrontmatter(pair[2]);
      hasMetadata=true;
    }
  }
  return hasMetadata?{fields,body:text.slice(match[0].length)}:
    {fields:Object.create(null),body:text};
}
function optionalMarkdownBoolean(value,key){
  if(value===undefined)return undefined;
  if(value===true||value===false)return value;
  if(/^(true|1)$/i.test(String(value)))return true;
  if(/^(false|0)$/i.test(String(value)))return false;
  throw new Error('Markdown 檔頭 '+key+' 必須為 true 或 false。');
}
async function stableMarkdownUid(source){
  if(!globalThis.crypto?.subtle?.digest)
    throw new Error('此裝置無法安全計算 Markdown 文件識別碼。');
  const bytes=new TextEncoder().encode(GALAXY_MARKDOWN_FORMAT+'\n'+source);
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  // 8 uppercase base-32 characters (40 bits), matching Galaxy's 8-char UID.
  let value=0n;
  for(const part of hash.slice(0,5))value=(value<<8n)|BigInt(part);
  return value.toString(32).toUpperCase().padStart(8,'0');
}
export async function parseGalaxyMarkdownFile(file,{importLocale='zh-Hant'}={}){
  const original=await decodeImportText(file,importLocale);
  const {fields,body}=markdownFrontmatter(original);
  const content=body.trim();
  if(!content)throw new Error('Markdown 文件沒有正文內容。');
  if(fields.loc_format&&fields.loc_format!==GALAXY_MARKDOWN_FORMAT)
    throw new Error('不支援的 Galaxy Markdown 版本：'+fields.loc_format);
  const date=fields.created_at||fields.createtime||null;
  if(date&&!Number.isFinite(Date.parse(String(date))))
    throw new Error('Markdown 檔頭的 created_at 日期無效。');
  const explicitUid=String(fields.uid||'').trim();
  if(explicitUid&&!/^[a-z0-9]{8}$/i.test(explicitUid))
    throw new Error('Markdown 檔頭的 uid 必須是 8 位英數字。');
  const heading=/^#\s+(.+)\s*$/m.exec(content)?.[1]?.trim();
  const title=String(fields.title||heading||file.name.replace(/\.md$/i,'')).trim();
  const uid=explicitUid||await stableMarkdownUid(
    String(original).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'));
  const searchable=fields.searchable===undefined?true:optionalMarkdownBoolean(fields.searchable,'searchable');
  const statistics=fields.statistics_able===undefined?true:optionalMarkdownBoolean(fields.statistics_able,'statistics_able');
  return [{
    uid,title,content,createtime:date,
    ...(fields.site?{site:String(fields.site)}:{}),
    ...(fields.location?{location:String(fields.location)}:{}),
    statics:statistics,culture:statistics,search:searchable,trace:searchable&&statistics,
      list:searchable,keyword:searchable&&statistics,others:true,extract:true
  }];
}

export async function parseUniversalImportFile(file,{recordPath='',importLocale='zh-Hant'}={}){
  if(!file||typeof file.name!=='string')throw new Error('請選擇有效的匯入檔案。');
  const type=extensionOf(file.name);
  if(type==='json'){
    if(!Number.isFinite(file.size)||file.size<=0||file.size>ARCHIVE_JSON_MAX_BYTES)
      throw new Error('JSON 檔案為空或超過 50 MiB 單檔上限；未讀取或解析。');
    const parsed=JSON.parse(await decodeImportText(file,importLocale));
    return importRowsFromJson(parsed,recordPath);
  }
  if(type==='md'){
    if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_DOCUMENT_BYTES)
      throw new Error('Markdown 文件為空或超過 128 MiB 單檔上限。');
    return parseGalaxyMarkdownFile(file,{importLocale});
  }
  throw new Error('不支援的匯入格式：'+(type||'未知')+'；請使用 ZIP、JSON 或 Galaxy Markdown。');
}
