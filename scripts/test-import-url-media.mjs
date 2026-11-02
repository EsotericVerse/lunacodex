import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {archiveAttachmentReferences,createArchiveEvidenceCollector,prepareArchiveMedia,isArchiveMediaUrl,auditArchiveUrlAttributes} from '../app/loc/archive-media-evidence.mjs';
import {normalizeImportMedia,mappedImportValue} from '../app/loc/import-batch.mjs';
import {runeDrawText} from '../app/loc/rune-draw-text.mjs';
import {extractImportCoordinates,importMapUrlCoordinates} from '../app/loc/import-geocoordinates.mjs';

test('article url uses the dedicated url field, never content or unrelated links',()=>{
  const articleUrl='https://www.facebook.com/posts/original';
  const record={url:articleUrl,post_url:'https://www.facebook.com/posts/other',
    content:'提到 https://outside.example.test/story 的內文',
    link:'https://outside.example.test/elsewhere'};
  assert.equal(mappedImportValue(record,'url'),articleUrl);
  assert.equal(mappedImportValue({content:record.content,link:record.link},'url'),'');
  assert.equal(mappedImportValue({content:record.content,url:articleUrl},'content'),record.content);
  assert.equal(mappedImportValue({content:record.content,url:articleUrl},'url'),articleUrl);
});

test('Google Maps location URL resolves [latitude,longitude] without external requests',()=>{
  const url='https://www.google.com/maps/我家@25.047924,121.517081,17z';
  assert.deepEqual(importMapUrlCoordinates(url),{latitude:25.047924,longitude:121.517081});
  assert.deepEqual(extractImportCoordinates({place:{name:'我家',url}}),
    {latitude:25.047924,longitude:121.517081});
  assert.deepEqual(extractImportCoordinates({label_values:[{dict:[{dict:[{value:url}]}]}]}),
    {latitude:25.047924,longitude:121.517081});
  assert.equal(importMapUrlCoordinates('https://example.com/maps/@25.047924,121.517081,17z'),null);
});

test('article URL and image URL stay separate with no EXIF or GPS',()=>{
  const articleUrl='https://www.facebook.com/posts/123';
  const imageUrl='https://cdn.example.test/photos/abc.jpg';
  const record={url:articleUrl,attachments:[{data:[{media:{uri:'photos/abc.jpg',url:imageUrl,type:'image'}}]}]};
  const refs=archiveAttachmentReferences(record);
  assert.deepEqual(refs,[{uri:'photos/abc.jpg',mediaType:'image',url:imageUrl}]);
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({platform:'facebook',sourcePath:'posts.json',attachments:refs},'TEST0001');
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:10});
  const plan=prepareArchiveMedia(evidence,new Set(['TEST0001']));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].url,imageUrl);
  assert.equal(plan.media[0].__article_uid,'TEST0001');
  assert.equal(plan.exif.length,0);
  assert.equal(plan.media[0].url===articleUrl,false);
});

test('standalone media URL is not lost when no ZIP photo or EXIF exists',()=>{
  const url='https://cdn.example.test/images/direct.png';
  assert.equal(isArchiveMediaUrl(url),true);
  assert.deepEqual(archiveAttachmentReferences({url}).map(row=>row.url),[url]);
});

test('dedicated media URL wins when a media object also contains a post permalink',()=>{
  const postUrl='https://www.instagram.com/p/abc123/';
  const imageUrl='https://cdn.example.test/image?id=001';
  const result=archiveAttachmentReferences({media:[{
    url:postUrl,image_url:imageUrl,type:'image'
  }]});
  assert.equal(result.length,1);
  assert.equal(result[0].url,imageUrl);
  assert.equal(result[0].mediaType,'image');
  const normalized=normalizeImportMedia([{url:postUrl,image_url:imageUrl}],{
    article_uid:'TEST0001'
  });
  assert.equal(normalized.records[0].url,imageUrl);
});


test('reimport never updates a saved media URL and still refuses conflicting UID URLs',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(panel,/updateRows\(galaxyMedia/);
  assert.match(panel,/媒體 UID 已存在，但網址不同/);
});


test('media timestamp retains own source time, otherwise inherits post time',()=>{
  const linked='2020-09-01T02:00:00.000Z';
  const own=normalizeImportMedia([{url:'https://example.test/own.jpg',
    creation_timestamp:1577836800}],{createtime:linked,article_uid:'ART00001'});
  assert.equal(own.records[0].createtime,'2020-01-01T00:00:00.000Z');
  const inherited=normalizeImportMedia([{url:'https://example.test/inherited.jpg'}],
    {createtime:linked,article_uid:'ART00001'});
  assert.equal(inherited.records[0].createtime,linked);
  const unknown=normalizeImportMedia([{url:'https://example.test/unlinked.jpg'}]);
  assert.equal(unknown.records[0].createtime,null);
});

test('full importer passes article dates to ZIP and linked media-only records',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/const articleTimes=new Map\(analyzed\.valid\.map\(row=>\[String\(row\.uid\),row\.createtime\]\)\)/);
  assert.match(panel,/archiveEvidence,new Set\(knownArticleIds\.keys\(\)\),articleTimes/);
  assert.match(panel,/createtime:record\.createtime\|\|articleTimes\.get\(owner\)\|\|null/);
});


test('rune draw is a Galaxy media subtype with meta_tags text, not a separate article',()=>{
  const result=normalizeImportMedia([{
    media_type:'runes',title:'抽牌結果',
    meta_tags:'{"cards":[{"rune":"月","direction":"正位","position":1}]}'
  }],{article_uid:'ART00001'});
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].media_type,'runes');
  assert.equal(result.records[0].title,'抽牌結果');
  assert.equal(result.records[0].url,null);
  assert.equal(result.records[0].meta_tags,'月 正位');
  assert.equal(result.records[0].__article_uid,'ART00001');
  assert.equal(result.references.length,0);
});

test('image description stays on galaxy_media.meta_tags and preserves its own URL',()=>{
  const result=normalizeImportMedia([{
    media_type:'image',title:'旅行照片',url:'https://example.test/image.jpg',
    description:'傍晚的橋面'
  }],{article_uid:'ART00001'});
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].meta_tags,'傍晚的橋面');
  assert.equal(result.records[0].url,'https://example.test/image.jpg');
  assert.equal(result.records[0].__article_uid,'ART00001');
});


test('legacy rune_references are interpreted as rune media without a Galaxy article',()=>{
  const legacy={cards:[{rune:'土',direction:'半逆',position:1}]};
  const normalized=normalizeImportMedia([{rune_references:legacy}],{article_uid:'ART00001'});
  assert.equal(normalized.records.length,1);
  assert.equal(normalized.records[0].media_type,'runes');
  assert.deepEqual(normalized.records[0].rune_references,legacy);
  assert.equal(normalized.records[0].__article_uid,'ART00001');
  const importer=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(importer,/const \{rune_references,media_type:legacyType,\.\.\.rest\}=source/);
  assert.match(importer,/type:'rune',title:'抽牌結果'/);
  assert.match(importer,/existingRuneByArticle/);
  assert.doesNotMatch(importer,/writeBatch:batch=>insertRows\(galaxyMedia,batch\.map\(record=>\(\{/);
});


test('top-level rune references attach to existing text articles or stand alone as media',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.ok(panel.includes("if(content&&runeResultText)mediaRecords.push({"));
  assert.ok(panel.includes("media_type:'rune',title:'抽牌結果'"));
  assert.ok(panel.includes("const type=String(value('media_type')||(runeResultText?'rune':'')).trim();"));
  assert.ok(panel.includes("media_type:type,title:rawTitle||(type==='rune'?'抽牌結果':null)"));
  assert.ok(panel.includes("existingRuneByArticle"));
});


test('nested media descriptions preserve JSON rather than object-to-string corruption',()=>{
  const tags={alt:'台北夜景',camera:'mobile'};
  const image=normalizeImportMedia([{media_type:'image',url:'https://example.test/night.jpg',meta_tags:tags}],{article_uid:'ART00001'});
  assert.equal(image.records[0].meta_tags,JSON.stringify(tags));
  const spread={cards:[{rune:'月',direction:'正位'}]};
  const rune=normalizeImportMedia([{media_type:'runes',meta_tags:spread}],{article_uid:'ART00001'});
  assert.equal(rune.records[0].meta_tags,'月 正位');
  assert.equal(rune.records.length,1);
});


test('production archive import uses JSON URLs only; EXIF never enters media or articles',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(panel,/onMediaMetadata\s*:/);
  assert.doesNotMatch(panel,/onMediaEntry\s*:/);
  assert.doesNotMatch(panel,/\.rpc\('save_archive_media_exif'/);
  assert.doesNotMatch(panel,/meta_tags:.*archivePlan\.exif/);
  assert.match(panel,/prepareArchiveMedia\(/);
  assert.match(panel,/syncImportedMedia\(/);
});

test('no-URL media may reuse an exact owner-linked record, never title alone',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/const mediaEvidenceKey=\(item,owner\)=>/);
  assert.match(panel,/!owner\|\|!type\|\|!metadata\|\|!title\|\|!Number\.isFinite\(stamp\)/);
  assert.match(panel,/existingOwnerMediaByKey=new Map\(\)/);
  assert.match(panel,/const storedEvidenceUid=evidenceKey\?existingOwnerMediaByKey\.get\(evidenceKey\):null/);
  assert.match(panel,/if\(storedEvidenceUid\)\{attach\(owner,storedEvidenceUid\);continue;\}/);
  assert.match(panel,/if\(evidenceKey\)existingOwnerMediaByKey\.set\(evidenceKey,String\(mediaId\)\)/);
});

test('nested url attribute audit counts post, media and place separately',()=>{
  const raw={url:'https://www.facebook.com/posts/abc',data:[{
    place:{name:'中和福和宮',coordinate:{latitude:25.001625,longitude:121.501576},
      url:'https://www.facebook.com/pages/temple/813051948710450'}
  },{
    attachments:[{data:[{media:{uri:'photos/a.jpg',url:'https://cdn.test/a.jpg'}}]}]
  }]};
  assert.deepEqual(auditArchiveUrlAttributes(raw),
    {total:3,article:1,media:1,place:1,other:0,truncated:false});
});

test('place url under data is not miscounted as media or article',()=>{
  const raw={data:[{place:{name:'新馬辣',url:'https://facebook.com/100090108969407',
    coordinate:{latitude:25.01111,longitude:121.46434}}}]};
  assert.deepEqual(auditArchiveUrlAttributes(raw),
    {total:1,article:0,media:0,place:1,other:0,truncated:false});
});

test('nested attribute audit reports when capped rather than pretending complete',()=>{
  const raw={data:Array.from({length:12},(_,i)=>({url:'https://example.test/'+i}))};
  const result=auditArchiveUrlAttributes(raw,{maxNodes:4});
  assert.equal(result.truncated,true);
  assert.ok(result.total<12);
});


test('Meta candidate CDN URL is recovered and paired with its original filename',()=>{
  const url='https://cdn.example.test/asset?token=valid';
  const refs=archiveAttachmentReferences({media:[{
    uri:'photos/holiday.jpg',
    image_versions2:{candidates:[{url,width:1080,height:1080}]}
  }]});
  assert.deepEqual(refs,[{uri:'photos/holiday.jpg',mediaType:'image',url}]);
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({platform:'instagram',sourcePath:'posts.json',attachments:refs},'ARTICLE1');
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:123});
  const plan=prepareArchiveMedia(evidence,new Set(['ARTICLE1']));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].url,url);
  assert.match(plan.media[0].title,/holiday\.jpg$/);
  assert.equal(plan.media[0].__article_uid,'ARTICLE1');
});

test('Meta candidate URL without a ZIP-local path is still a real media URL',()=>{
  const url='https://cdn.example.test/v?media=abc123';
  assert.deepEqual(archiveAttachmentReferences({
    media:[{image_versions2:{candidates:[{url}]}}]
  }),[{uri:url,mediaType:'image',url}]);
});


test('URI-only Meta ZIP image never produces a persisted media row or article media link',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({
    platform:'facebook',sourcePath:'your_posts_1.json',
    attachments:[{uri:'photos/only-local.jpg',mediaType:'image',url:null}]
  },'POST0001');
  collector.onMediaEntry({path:'photos/only-local.jpg'});
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:200});
  const plan=prepareArchiveMedia(evidence,new Set(['POST0001']));
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
});

test('JSON media URL persists without reading ZIP image bytes and keeps article link',()=>{
  const url='https://cdn.example.test/media?token=123';
  const collector=createArchiveEvidenceCollector();
  const attachments=archiveAttachmentReferences({media:[{
    uri:'photos/image.jpg',image_versions2:{candidates:[{url}]}
  }]});
  collector.onRecord({platform:'instagram',attachments},'POST0002');
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:200});
  const plan=prepareArchiveMedia(evidence,new Set(['POST0002']));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].url,url);
  assert.equal(plan.mediaLinks.length,1);
});

test('LOC production import only reads JSON, never invokes ZIP image or EXIF processors',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(panel,/onMediaMetadata\s*:/);
  assert.doesNotMatch(panel,/onMediaEntry\s*:/);
  assert.doesNotMatch(panel,/嘗試讀取 EXIF/);
});


test('ZIP import preview counts real article permalinks separately from media URLs',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/articleWithUrl:imported\.filter\(item=>Boolean\(item\.raw\?\.url\)\)\.length/);
  assert.match(panel,/archiveSummary\.articleWithUrl/);
  assert.match(panel,/文章原始網址/);
});

test('rune card JSON becomes one readable line, with no object braces',()=>{
  const draw={cards:[
    {role:'原因',rune:'辰',direction:'逆位',position:1},
    {role:'原因',rune:'靈',direction:'半逆',position:2},
    {role:'建議',rune:'果',direction:'正位',position:3}
  ]};
  assert.equal(runeDrawText(draw),'辰 逆位，靈 半逆，果 正位');
  assert.equal(runeDrawText(JSON.stringify(draw)),'辰 逆位，靈 半逆，果 正位');
  assert.equal(runeDrawText('月 正位，韻 半正'),'月 正位，韻 半正');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/const runeResultText=runeDrawText\(importedRuneReferences\)/);
});
