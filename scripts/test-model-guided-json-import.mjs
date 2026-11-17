// Focused source-driven JSON import tests. Run with node --test.
// No database, credentials, deployment or unrelated project dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceImportModel} from '../packages/zenstack/import-source-models.mjs';
import {importRowsFromJson,mappedImportValue} from '../app/loc/import/batch.mjs';
import {parseUniversalImportFile} from '../app/loc/import/universal-file.mjs';

const wordpress={ID:341,post_title:'我的文章',post_content:'內容正文',post_date:'2023-06-10'};
const notion={id:'nt-77',object:'block',type:'paragraph',
  paragraph:{rich_text:[{plain_text:'第一段'},{plain_text:'第二段'}]}};
const fakeFile=(filename,payload)=>{
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  return {name:filename,size:bytes.length,arrayBuffer:async()=>bytes.buffer};
};

test('selected source determines collection, not the first global data array',()=>{
  const file={wp_posts:[wordpress],results:[notion]};
  assert.deepEqual(importRowsFromJson(file,'','WordPress'),[wordpress]);
  assert.deepEqual(importRowsFromJson(file,'','Notion'),[notion]);
  assert.equal(mappedImportValue(importRowsFromJson(file,'','WordPress')[0],
    'content',{},'WordPress'),'內容正文');
  assert.equal(mappedImportValue(importRowsFromJson(file,'','Notion')[0],
    'content',{},'Notion'),'第一段第二段');
});

test('ambiguous arrays are rejected unless the operator specifies a record path',()=>{
  const payload={posts:[{post_content:'a'}],data:[{post_content:'b'}]};
  assert.throws(()=>importRowsFromJson(payload,'','WordPress'),/多個資料陣列/);
  assert.throws(()=>importRowsFromJson(payload),/多個資料陣列/);
  assert.deepEqual(importRowsFromJson(payload,'posts','WordPress'),payload.posts);
});

test('a source row with its own data array remains a single article',()=>{
  const fb={fbPostId:'fb-1',contentText:'分享',data:[{post:'正文'}]};
  assert.deepEqual(importRowsFromJson(fb,'','Facebook'),[fb]);
});

test('JSON reader passes the selected source into the existing row selection',async()=>{
  const file=fakeFile('export.json',{wp_posts:[wordpress],results:[notion]});
  assert.deepEqual(await parseUniversalImportFile(file,{source:'WordPress'}),[wordpress]);
  assert.deepEqual(await parseUniversalImportFile(file,{source:'Notion'}),[notion]);
  await assert.rejects(parseUniversalImportFile(file,{}),/多個資料陣列/);
});

test('selection remains declarative and never invents cross-platform IDs',()=>{
  assert.equal(sourceImportModel('Facebook').recordPaths.includes('posts'),true);
  assert.equal(sourceImportModel('WordPress').recordPaths.includes('wp_posts'),true);
  assert.equal(sourceImportModel('Notion').recordPaths.includes('results'),true);
  assert.equal(sourceImportModel('Facebook').fields.globalGraphId,undefined);
  assert.equal(sourceImportModel('Instagram').fields.fbPostId,undefined);
});
