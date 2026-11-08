import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {parseUniversalImportFile,UNIVERSAL_IMPORT_ACCEPT} from '../app/loc/universal-file-import.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const file=(name,body,size=Buffer.byteLength(body))=>({name,size,text:async()=>body});

const binaryFile=(name,bytes)=>{
  const data=Buffer.from(bytes);
  return {
    name,size:data.byteLength,
    arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),
    text:async()=>data.toString('utf8')
  };
};

test('Traditional Chinese selector reads both UTF-8 and Big5, preserving English',async()=>{
  const utf8='# 繁體中文和 English 混合\n\n正常文字';
  const [unicode]=await parseUniversalImportFile(binaryFile('utf8.md',Buffer.from(utf8,'utf8')),{importLocale:'zh-Hant'});
  assert.equal(unicode.title,'繁體中文和 English 混合');
  assert.equal(unicode.content,utf8);
  assert.equal(unicode.language,undefined);
  // # 繁體中文，Hello！ encoded in Big5.
  const legacy=Buffer.concat([Buffer.from('# '),Buffer.from('c163c5e9a4a4a4e5a14148656c6c6fa149','hex')]);
  const [big5]=await parseUniversalImportFile(binaryFile('big5.md',legacy),{importLocale:'zh-Hant'});
  assert.equal(big5.title,'繁體中文，Hello！');
  assert.equal(big5.content,'# 繁體中文，Hello！');
});

test('Simplified Chinese selector reads UTF-8 and GB18030 without language tagging',async()=>{
  const utf8='# 简体中文和 English 混合';
  const [unicode]=await parseUniversalImportFile(binaryFile('utf8.md',Buffer.from(utf8,'utf8')),{importLocale:'zh-Hans'});
  assert.equal(unicode.title,'简体中文和 English 混合');
  assert.equal(unicode.content,utf8);
  // # 简体中文，Hello！ encoded in GB18030.
  const legacy=Buffer.concat([Buffer.from('# '),Buffer.from('bcf2cce5d6d0cec4a3ac48656c6c6fa3a1','hex')]);
  const [gb18030]=await parseUniversalImportFile(binaryFile('gb18030.md',legacy),{importLocale:'zh-Hans'});
  assert.equal(gb18030.title,'简体中文，Hello！');
  assert.equal(gb18030.content,'# 简体中文，Hello！');
  assert.equal(gb18030.language,undefined);
});

test('Big5 and UTF-8 versions of the same document share one content-derived UID',async()=>{
  const txt='# 繁體中文，Hello！';
  const old=Buffer.concat([Buffer.from('# '),Buffer.from('c163c5e9a4a4a4e5a14148656c6c6fa149','hex')]);
  const [a]=await parseUniversalImportFile(binaryFile('old.md',old),{importLocale:'zh-Hant'});
  const [b]=await parseUniversalImportFile(binaryFile('new.md',Buffer.from(txt,'utf8')),{importLocale:'zh-Hant'});
  assert.equal(a.uid,b.uid);
});

test('UTF-16 with BOM is decoded before legacy fallback',async()=>{
  const text='# 混合 English';
  const fileBody=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]);
  const [row]=await parseUniversalImportFile(binaryFile('utf16.md',fileBody),{importLocale:'zh-Hant'});
  assert.equal(row.content,text);
});

test('Galaxy Markdown v1 preserves headings and content while mapping metadata',async()=>{
  const text=[
    '---','loc_format: galaxy-md/v1','title: "時空靈魂震盪論"',
    'created_at: 2026-10-24','site: ChatGPT','location: 台灣',
    'searchable: true','statistics_able: false','---','',
    '# 原始標題','','**內文** 與 [連結](https://example.com)。','','- A','- B'
  ].join('\n');
  const rows=await parseUniversalImportFile(file('essay.md',text));
  assert.equal(rows.length,1);
  const row=rows[0];
  assert.equal(row.title,'時空靈魂震盪論');
  assert.equal(row.createtime,'2026-10-24');
  assert.equal(row.site,'ChatGPT');
  assert.equal(row.location,'台灣');
  assert.equal(row.searchable,true);
  assert.equal(row.statistics_able,false);
  assert.match(row.content,/# 原始標題\n\n\*\*內文\*\*/);
  assert.match(row.uid,/^[0-9A-V]{8}$/);
  assert.equal((await parseUniversalImportFile(file('essay.md',text)))[0].uid,row.uid);
});

test('ordinary Markdown without metadata imports with H1 title and repeat-safe UID',async()=>{
  const doc='# 我的筆記\n\n## 子標題\n\n保留 **強調**。\n';
  const [first]=await parseUniversalImportFile(file('notes.md',doc));
  const [again]=await parseUniversalImportFile(file('renamed.md',doc));
  assert.equal(first.title,'我的筆記');
  assert.equal(first.uid,again.uid);
  assert.equal(first.content,doc.trim());
  assert.equal(first.createtime,null);
  const [modified]=await parseUniversalImportFile(file('notes.md',doc+'增加一行\n'));
  assert.notEqual(modified.uid,first.uid);
});

test('Markdown respects a supplied stable UID even when content changes',async()=>{
  const mk=body=>file('essay.md','---\nuid: AB12CD34\n---\n'+body);
  const [first]=await parseUniversalImportFile(mk('# 初稿'));
  const [revised]=await parseUniversalImportFile(mk('# 修訂'));
  assert.equal(first.uid,'AB12CD34');
  assert.equal(revised.uid,'AB12CD34');
});

test('explicit Base62 UID retains mixed case across repeated Markdown imports',async()=>{
  const input=body=>file('mixed.md','---\nuid: aB12cD34\n---\n'+body);
  const [one]=await parseUniversalImportFile(input('# Original'));
  const [two]=await parseUniversalImportFile(input('# Edited'));
  assert.equal(one.uid,'aB12cD34');
  assert.equal(two.uid,'aB12cD34');
});

test('CRLF and UTF-8 BOM are handled without losing Markdown',async()=>{
  const doc='\uFEFF---\r\ntitle: "摘要"\r\ncreated_at: "2026-10-24T09:00:00+08:00"\r\n---\r\n\r\n# 內容\r\n\r\n一段話';
  const [row]=await parseUniversalImportFile(file('a.md',doc));
  assert.equal(row.title,'摘要');
  assert.equal(row.createtime,'2026-10-24T09:00:00+08:00');
  assert.equal(row.content,'# 內容\n\n一段話');
});

test('bad explicit metadata is rejected rather than silently substituted',async()=>{
  await assert.rejects(parseUniversalImportFile(file('bad.md','---\nloc_format: galaxy-md/v2\n---\n# txt')),/不支援/);
  await assert.rejects(parseUniversalImportFile(file('bad.md','---\nuid: bad-id\n---\n# txt')),/uid/);
  await assert.rejects(parseUniversalImportFile(file('bad.md','---\nsearchable: maybe\n---\n# txt')),/true 或 false/);
  await assert.rejects(parseUniversalImportFile(file('bad.md','---\ncreated_at: nonsense\n---\n# txt')),/created_at/);
  await assert.rejects(parseUniversalImportFile(file('bad.md','---\nloc_format: galaxy-md\/v1\n# no end')),/缺少結束/);
  await assert.rejects(parseUniversalImportFile(file('empty.md','')),/為空/);
});

test('non-Galaxy markdown with a horizontal rule is preserved',async()=>{
  const doc='---\n# Not frontmatter\n\n正文';
  const [row]=await parseUniversalImportFile(file('ordinary.md',doc));
  assert.equal(row.content,doc);
  assert.equal(row.title,'Not frontmatter');
});

test('document size limit and JSON import remain unchanged',async()=>{
  await assert.rejects(parseUniversalImportFile(file('huge.md','# a',128*1024*1024+1)),/超過/);
  const json='[{"title":"舊資料","content":"文字"}]';
  const rows=await parseUniversalImportFile(file('archive.json',json));
  assert.deepEqual(rows,[{title:'舊資料',content:'文字'}]);
});

test('standalone import offers JSON, ZIP archives and Galaxy Markdown without Office dependency',async()=>{
  assert.equal(UNIVERSAL_IMPORT_ACCEPT,'.zip,.json,.md');
  for(const ext of ['csv','xlsx','docx','pdf','epub','html']){
    await assert.rejects(parseUniversalImportFile(file('unsupported.'+ext,'plain text')),/不支援的匯入格式/);
  }
});
