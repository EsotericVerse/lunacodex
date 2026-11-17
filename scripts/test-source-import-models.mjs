// Focused import boundary contracts. Run: node --test scripts/test-source-import-models.mjs
// No database connection, deployment, auth grant or persistent model required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {schema} from '../packages/zenstack/schema.mjs';
import {assertZModelSourceImportRecord} from '../packages/zenstack/import-validation.mjs';
import {SOURCE_IMPORT_MODELS,sourceImportModel} from '../packages/zenstack/import-source-models.mjs';
import {mappedImportValue,importRowsFromJson} from '../app/loc/import/batch.mjs';
import {canonicalImportSourceName,inferImportSourceFromFilename}
  from '../app/loc/source/name.mjs';
import {isPrivateStandaloneRow,filterStandalonePublicRows}
  from '../app/loc/archive/import-safety.mjs';

test('all external source models are ZModel value types, never SQL tables',()=>{
  for(const profile of SOURCE_IMPORT_MODELS){
    assert.ok(schema.typeDefs[profile.model],profile.model);
    assert.equal(schema.models[profile.model],undefined,profile.model);
    assert.equal(canonicalImportSourceName(profile.label),profile.label);
  }
  assert.equal(sourceImportModel('Notion',{object:'block'}).model,'NotionBlock');
  assert.equal(sourceImportModel('Threads',{object_type:'threads_public_reply'}).model,'ThreadsPublicReply');
  assert.equal(sourceImportModel('Threads',{id:'th1'}).model,'MetaFederatedPost');
  assert.equal(canonicalImportSourceName('some-unknown-site'),'Others');
});

test('WordPress SQL export and REST payload use one declared source contract',()=>{
  const sql={ID:51,post_title:'測試標題',post_content:'完整正文',post_date:'2023-10-01 09:15:00'};
  assert.equal(mappedImportValue(sql,'site_id',{},'WordPress'),51);
  assert.equal(mappedImportValue(sql,'title',{},'WordPress'),'測試標題');
  assert.equal(mappedImportValue(sql,'content',{},'WordPress'),'完整正文');
  const rest={id:93,title:{rendered:'REST 標題'},content:{rendered:'<p>完整文章</p>'},
    date:'2023-10-01T09:15:00'};
  assert.equal(mappedImportValue(rest,'title',{},'WordPress'),'REST 標題');
  assert.equal(mappedImportValue(rest,'content',{},'WordPress'),'<p>完整文章</p>');
  assert.equal(mappedImportValue(rest,'site_id',{},'WordPress'),93);
  // User-specified mapping always wins over a source's default fields.
  assert.equal(mappedImportValue({...sql,content:'原始值'},'content',{content:'content'},'WordPress'),'原始值');
  assert.equal(importRowsFromJson({wp_posts:[sql]}).length,1);
  assert.equal(inferImportSourceFromFilename('wp_posts.json'),'WordPress');
});

test('Notion rich-text array paths preserve all text spans in order, without recursive parsing',()=>{
  const block={object:'block',id:'b-1',type:'paragraph',created_time:'2023-05-01T00:00:00Z',
    paragraph:{rich_text:[{plain_text:'第一段'},{plain_text:'第二段'}]}};
  const [row]=importRowsFromJson({results:[block]});
  assert.equal(mappedImportValue(row,'content',{},'Notion'),'第一段第二段');
  assert.equal(mappedImportValue(row,'site_id',{},'Notion'),'b-1');
  const page={id:'p-1',properties:{Name:{title:[{plain_text:'頁面'},{plain_text:'名稱'}]}}};
  assert.equal(mappedImportValue(page,'title',{},'Notion'),'頁面名稱');
  assert.equal(inferImportSourceFromFilename('notion_export.json'),'Notion');
});

test('Meta post models retain platform-specific identity and do not forge Galaxy UID links',()=>{
  const fb={fbPostId:'fb-1',contentText:'Facebook 貼文',mediaUrls:['https://example.org/a.jpg']};
  assert.equal(mappedImportValue(fb,'site_id',{},'Facebook'),'fb-1');
  assert.equal(mappedImportValue(fb,'content',{},'Facebook'),'Facebook 貼文');
  assert.deepEqual(mappedImportValue(fb,'media',{},'Facebook'),['https://example.org/a.jpg']);
  const ig={igMediaId:'ig-1',caption:'Instagram 貼文'};
  assert.equal(mappedImportValue(ig,'site_id',{},'Instagram'),'ig-1');
  const th={id:'th-reply-1',root_post_id:'th-root-long',parent_id:'th-parent-long',
    object_type:'threads_public_reply',content:{text:'公開回覆'}};
  assert.equal(mappedImportValue(th,'content',{},'Threads'),'公開回覆');
  assert.equal(mappedImportValue(th,'site_id',{},'Threads'),'th-reply-1');
  assert.equal(mappedImportValue(th,'source_id',{},'Threads'),'');
  assert.equal(mappedImportValue(th,'ref_id',{},'Threads'),'');
});

test('private Messenger, IG DM and MSN use explicit paths but are not publishable',()=>{
  const messenger={object_type:'fb_messenger_message',message_id:'msg-1',thread_id:'chat-1',
    timestamp_ms:1794883200000,message_body:{text:'私人訊息'}};
  assert.equal(mappedImportValue(messenger,'content',{},'Messenger'),'私人訊息');
  assert.equal(mappedImportValue(messenger,'site_id',{},'Messenger'),'msg-1');
  assert.equal(isPrivateStandaloneRow(messenger),true);
  assert.throws(()=>filterStandalonePublicRows([messenger],false),/私人對話/);
  const dm={object_type:'instagram_direct_message',item_id:'ig-item-1',
    body:{text:'IG 私訊',shared_content:{thumbnail_url:'https://example.org/reel.jpg'}}};
  assert.equal(mappedImportValue(dm,'content',{},'Instagram DM'),'IG 私訊');
  assert.equal(mappedImportValue(dm,'media',{},'Instagram DM'),'https://example.org/reel.jpg');
  assert.equal(isPrivateStandaloneRow(dm),true);
  const msn={object_type:'msn_im_message',session_id:'s-1',
    body:{text:'早安',is_nudge:false}};
  assert.equal(mappedImportValue(msn,'content',{},'MSN'),'早安');
  assert.equal(isPrivateStandaloneRow(msn),true);
  assert.equal(inferImportSourceFromFilename('msn_messages.json'),'MSN');
});

test('X encrypted DMs never import ciphertext or a placeholder as genuine text',()=>{
  const dm={object_type:'twitter_direct_message',dm_id:'dm-1',
    ciphertext_body:'Base64EncryptedCiphertextString...',
    decrypted_body_fallback_placeholder:{text:'這是佔位字'}};
  assert.equal(mappedImportValue(dm,'content',{},'X DM'),'');
  assert.equal(isPrivateStandaloneRow(dm),true);
});

test('WordPress drafts remain private; public post records stay eligible',()=>{
  assert.equal(isPrivateStandaloneRow({post_status:'draft',post_content:'草稿'}),true);
  assert.equal(isPrivateStandaloneRow({type:'post',status:'private',content:{rendered:'秘密'}}),true);
  assert.equal(isPrivateStandaloneRow({post_status:'publish',post_content:'文章'}),false);
});

test('ZenStack-derived Zod schema validates source records without rewriting the payload',()=>{
  const wordpress={id:123,post_title:'文章',post_content:'內容'};
  assert.equal(assertZModelSourceImportRecord(wordpress,'WordPress'),wordpress);
  const notion={object:'block',id:'notion-block',type:'paragraph',
    paragraph:{rich_text:[{plain_text:'你好'}]}};
  assert.equal(assertZModelSourceImportRecord(notion,'Notion'),notion);
  assert.equal(assertZModelSourceImportRecord({timestamp_ms:1794883200000,contentText:'貼文'},'Facebook')
    .contentText,'貼文');
  assert.throws(()=>assertZModelSourceImportRecord({post_title:42},'WordPress',5),/來源 ZModel 驗證失敗/);
});
