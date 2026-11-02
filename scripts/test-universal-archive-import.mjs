import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {importRowsFromJson} from '../app/loc/import-batch.mjs';
import {archiveRecordStreamPath,archiveRootContainers} from '../app/loc/archive-array-layout.mjs';
import {detectZipArchiveSource,inspectPrivateArchive} from '../app/loc/private-archive-universal.mjs';
import {archiveGalaxyRow} from '../app/loc/archive-galaxy-row.mjs';
import {archiveGalaxyRows} from '../app/loc/archive-caption-rows.mjs';
import {readImageExif} from '../app/loc/archive-exif.mjs';
import {createArchiveEvidenceCollector,prepareArchiveMedia} from '../app/loc/archive-media-evidence.mjs';
import {assertPrivateArchiveDestination,isPublicArchiveRecord,isPrivateArchiveEntry} from '../app/loc/archive-import-safety.mjs';

function asFile(name,bytes){
  const data=new Uint8Array(bytes);
  return {name,size:data.length,slice(start,end){
    return {arrayBuffer:async()=>data.slice(start,end).buffer};
  }};
}
const j=v=>strToU8(JSON.stringify(v));
async function parsed(name,files){
  const file=asFile(name,zipSync(files));
  const detected=await detectZipArchiveSource(file);
  const results=[];const exif=[];
  const summary=await inspectPrivateArchive(file,{
    onRecord:r=>{const row=archiveGalaxyRow(r);if(row)results.push(row);},
    onMediaMetadata:r=>exif.push(r)
  });
  return {detected,results,exif,summary};
}
test('Threads ZIP flows past detection into actual Galaxy-ready articles with original URL',async()=>{
  const a=await parsed('threads-archive.zip',{
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[
      {id:'threads-001',title:'台南散步',timestamp:1720000000,
        url:'https://www.threads.net/@writer/post/abc123'}
    ]})
  });
  assert.ok(a.detected.sources.includes('threads'));
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].site,'Threads');
  assert.equal(a.results[0].site_id,'threads-001');
  assert.equal(a.results[0].content,'台南散步');
  assert.equal(a.results[0].url,'https://www.threads.net/@writer/post/abc123');
});
test('Facebook ZIP keeps place, time and original permalink',async()=>{
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb100',timestamp:1720000000,data:[{post:'到高雄'}],
      attachments:[{data:[{place:{name:'高雄車站'}}]}],
      permalink:'https://www.facebook.com/post/123'
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].site,'Facebook');
  assert.equal(a.results[0].site_id,'fb100');
  assert.equal(a.results[0].location,'高雄車站');
  assert.equal(a.results[0].url,'https://www.facebook.com/post/123');
});
test('ZIP restores article URL nested inside post data.array without mistaking body, media, or place URLs',async()=>{
  const articleUrl='https://www.facebook.com/posts/real-post-123';
  const foreignUrl='https://outside.example.test/somebody-else';
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-nested-001',timestamp:1720000000,
      data:{array:[{post:'文章引用 '+foreignUrl,url:articleUrl}]},
      attachments:[{data:[{media:{uri:'photos/a.jpg',url:'https://cdn.example.test/a.jpg'}},
        {place:{name:'台北',url:'https://www.facebook.com/pages/place/123'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,articleUrl);
  assert.match(a.results[0].content,/outside\.example\.test/);
});

test('ZIP does not invent original post URL from body, media or check-in URL',async()=>{
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-no-permalink',timestamp:1720000000,
      data:{array:[{post:'請看 https://outside.example.test/news'}]},
      attachments:[{data:[{media:{uri:'photos/a.jpg',url:'https://cdn.example.test/a.jpg'}},
        {place:{name:'台北',url:'https://www.facebook.com/pages/place/123'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,undefined);
});

test('ZIP nested explicit permalink outranks a generic shared-link URL',async()=>{
  const permalink='https://www.threads.net/@writer/post/actual';
  const a=await parsed('threads-archive.zip',{
    'activity/threads/threads_posts.json':j([{id:'th-nested',timestamp:1720000000,
      title:'測試文章',url:'https://external.example.test/referenced',
      data:[{post:{permalink}}]}])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,permalink);
});

test('ChatGPT conversations.json becomes searchable dialogue instead of an inert ZIP scan',async()=>{
  const a=await parsed('chatgpt-export.zip',{
    'conversations.json':j([{
      id:'chat-001',title:'空間定錨',
      create_time:1720000000,
      mapping:{a:{message:{author:{role:'user'},create_time:1720000001,
        content:{content_type:'text',parts:['在板橋車站見面']}}},
      b:{message:{author:{role:'assistant'},create_time:1720000002,
        content:{content_type:'text',parts:['收到，依照原文紀錄。']}}}}
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].site,'ChatGPT');
  assert.equal(a.results[0].title,'空間定錨');
  assert.match(a.results[0].content,/\[user\].*板橋車站/s);
  assert.match(a.results[0].content,/\[assistant\].*依照原文紀錄/s);
});
test('Unrecognized archive still attempts generic text records and does not silently stop',async()=>{
  const a=await parsed('unknown-backup.zip',{
    'posts.json':j([{id:'p1',content:'一篇通用文章',timestamp:1720000000}])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].content,'一篇通用文章');
  assert.equal(a.results[0].site,'Archive');
});
function gpsJpeg(){
  // Minimal valid JPEG EXIF containing GPS latitude 25°02'N longitude 121°31'E.
  const t=new Uint8Array(174);
  const d=new DataView(t.buffer);
  t.set([73,73,42,0,8,0,0,0]);
  const w16=(p,v)=>d.setUint16(p,v,true),w32=(p,v)=>d.setUint32(p,v,true);
  w16(8,1);w16(10,0x8825);w16(12,4);w32(14,1);w32(18,26);
  w16(26,4);
  const entry=(i,tag,type,count,val)=>{
    const p=28+i*12;w16(p,tag);w16(p+2,type);w32(p+4,count);w32(p+8,val);
  };
  entry(0,1,2,2,78);entry(1,2,5,3,80);entry(2,3,2,2,104);entry(3,4,5,3,112);
  t.set([78,0],78);t.set([69,0],104);
  // reference tag with ASCII count 2 is inline in the IFD value field;
  // overwrite the value slot directly as TIFF requires.
  t.set([78,0,0,0],36);
  t.set([69,0,0,0],60);
  for(const [offset,degree,minute,second] of [[80,25,2,0],[112,121,31,0]]){
    [degree,minute,second].forEach((v,i)=>{w32(offset+i*8,v);w32(offset+i*8+4,1)});
  }
  const length=t.length+8;
  return Uint8Array.from([255,216,255,225,length>>8,length&255,69,120,105,102,0,0,...t,255,217]);
}
test('EXIF GPS is inspected locally from ZIP without importing image bytes',async()=>{
  const jpeg=gpsJpeg();
  const direct=readImageExif(jpeg,'photo.jpg');
  assert.ok(direct);
  assert.ok(Math.abs(direct.latitude-25.0333)<0.01);
  assert.ok(Math.abs(direct.longitude-121.5167)<0.01);
  const a=await parsed('mixed-archive.zip',{
    'posts.json':j([{content:'這是文章',id:'post1'}]),
    'photos/photo.jpg':jpeg
  });
  assert.equal(a.results.length,1);
  assert.equal(a.exif.length,1);
  assert.equal(a.summary.exifWithGps,1);
  assert.equal(a.results[0].content,'這是文章');
  assert.equal(a.results[0].location,undefined);
});

test('Threads ZIP post with time nested under media[] gets createtime from creation_timestamp',async()=>{
  const a=await parsed('threads-nested.zip',{
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[
      {media:[{uri:'',creation_timestamp:1788635184,title:'自己各時期的歌詞',
        cross_post_source:{source_app:'FB'}}]}
    ]})
  });
  assert.ok(a.detected.sources.includes('threads'));
  assert.equal(a.results.length,1);
  assert.ok(a.results[0].createtime,'createtime must not be empty');
  assert.equal(new Date(a.results[0].createtime).getTime(),1788635184*1000);
});

test('Meta-style nested times are found without per-platform key lists',async()=>{
  const a=await parsed('meta-nested.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      data:[{post:'測試貼文'}],
      attachments:[{data:[{media:{uri:'',creation_timestamp:1720000000,title:'測試貼文'}}]}]
    }]),
    'activity/instagram/posts.json':j([{
      media:[{uri:'',taken_at:1721000000,title:'IG 測試'}]
    }])
  });
  const times=a.results.map(r=>new Date(r.createtime).getTime()).sort((x,y)=>x-y);
  assert.deepEqual(times,[1720000000000,1721000000000]);
});

test('Threads, Facebook and Instagram ZIP images retain media URL and private EXIF evidence for Galaxy Media',async()=>{
  const jpeg=gpsJpeg();
  const file=asFile('meta-backups.zip',zipSync({
    'activity/threads/threads_posts.json':j([{id:'th1',title:'Threads 照片',timestamp:1720000000,
      photos:[{uri:'threads/photos/t.jpg',url:'https://media.example.test/threads.jpg',type:'image'}]}]),
    'your_facebook_activity/posts/your_posts_1.json':j([{id:'fb1',timestamp:1720000000,
      data:[{post:'Facebook 照片',attachments:[{data:[{media:{
        uri:'facebook/photos/f.jpg',url:'https://media.example.test/facebook.jpg',type:'image'
      }}]}]}]}]),
    'your_instagram_activity/posts/ig_posts.json':j([{id:'ig1',title:'Instagram 照片',timestamp:1720000000,
      media:[{uri:'instagram/media/i.jpg',url:'https://media.example.test/instagram.jpg',type:'image'}]}]),
    'threads/photos/t.jpg':jpeg,
    'facebook/photos/f.jpg':jpeg,
    'instagram/media/i.jpg':jpeg
  }));
  const collector=createArchiveEvidenceCollector(),uids=new Set();
  const summary=await inspectPrivateArchive(file,{
    onRecord:record=>{
      const article=archiveGalaxyRow(record);
      if(article){uids.add(article.uid);collector.onRecord(record,article.uid);}
    },
    onMediaEntry:item=>collector.onMediaEntry(item),
    onMediaMetadata:item=>collector.onExif(item)
  });
  const rows=collector.rows({scopeId:'lo3rwang',archiveName:file.name,archiveSize:file.size});
  const plan=prepareArchiveMedia(rows,uids);
  assert.equal(summary.exifWithGps,3);
  assert.equal(rows.length,3);
  assert.equal(plan.media.length,3);
  assert.equal(plan.exif.length,3);
  assert.deepEqual(new Set(plan.exif.map(e=>e.platform)),new Set(['threads','facebook','instagram']));
  assert.equal(plan.media.every(row=>row.url?.startsWith('https://media.example.test/')),true);
  assert.equal(plan.media.every(row=>row.__article_uid&&uids.has(row.__article_uid)),true);
  assert.equal(plan.media.every(row=>!('latitude' in row)&&!('longitude' in row)),true);
  assert.equal(plan.exif.every(row=>Math.abs(row.latitude-25.0333)<0.01),true);
});
test('Media-only archive remains importable and its EXIF is retained',async()=>{
  const file=asFile('photos.zip',zipSync({'photos/only.jpg':gpsJpeg()}));
  const collector=createArchiveEvidenceCollector();
  const summary=await inspectPrivateArchive(file,{
    onRecord:()=>{throw new Error('Unexpected article');},
    onMediaEntry:item=>collector.onMediaEntry(item),
    onMediaMetadata:item=>collector.onExif(item)
  });
  const rows=collector.rows({scopeId:'lo3rwang',archiveName:file.name,archiveSize:file.size});
  const plan=prepareArchiveMedia(rows,new Set());
  assert.equal(summary.acceptedRows,0);
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,1);
  assert.equal(plan.exif[0].media_uid,null);
});

test('Threads ZIP with Facebook Messenger backup only imports public posts',async()=>{
  const file=asFile('threads-mixed.zip',zipSync({
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[
      {id:'threads-100',title:'公開 Threads 貼文',timestamp:1720000000,
        text:'這是一篇公開貼文'}
    ]}),
    'your_facebook_activity/messages/inbox/example/message_1.json':j({
      participants:[{name:'Test A'},{name:'Test B'}],
      messages:[{sender_name:'Test A',timestamp_ms:1720000000000,
        content:'這是測試私訊，禁止轉成公開文章'}]
    })
  }));
  const detected=await detectZipArchiveSource(file);
  assert.ok(detected.sources.includes('threads'));
  assert.ok(detected.sources.includes('messenger'));
  assert.doesNotThrow(()=>assertPrivateArchiveDestination(false,detected.sources));
  const publicRows=[];
  let rejected=0;
  await inspectPrivateArchive(file,{onRecord:record=>{
    if(!isPublicArchiveRecord(record)){rejected++;return;}
    const article=archiveGalaxyRow(record);
    if(article)publicRows.push(article);
  }});
  assert.equal(publicRows.length,1);
  assert.equal(publicRows[0].site,'Threads');
  assert.equal(publicRows[0].content.includes('公開'),true);
  assert.equal(publicRows[0].content.includes('私訊'),false);
  assert.ok(rejected>=1);
  assert.equal(isPrivateArchiveEntry('your_facebook_activity/messages/inbox/example/photo.jpg'),true);
});
test('Standalone Threads public JSON uses archive scanner without publishing private messages',async()=>{
  const file=asFile('threads_posts.json',j({text_post_app_text_posts:[
    {id:'threads-101',timestamp:1720000000,text:'僅公開貼文'},
    {sender_name:'Test Sender',timestamp_ms:1720000000000,content:'私訊格式不公開'}
  ]}));
  const accepted=[];
  let skipped=0;
  await inspectPrivateArchive(file,{onRecord:record=>{
    if(!isPublicArchiveRecord(record)){skipped++;return;}
    const article=archiveGalaxyRow(record);
    if(article)accepted.push(article);
  }});
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].site,'Threads');
  assert.equal(accepted[0].content,'僅公開貼文');
  assert.ok(skipped>=1);
});

test('Public Threads posts are imported from mixed Meta ZIP without reading private message entries',async()=>{
  const privateMessage={participants:[{name:'private-user'}],
    messages:[{sender_name:'private-user',content:'must-never-appear',timestamp_ms:1720000000000}]};
  const file=asFile('full-meta-backup.zip',zipSync({
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[
      {id:'threads-public',title:'公開文字',timestamp:1720000000}
    ]}),
    'your_facebook_activity/messages/inbox/private/message_1.json':j(privateMessage),
    'your_facebook_activity/messages/inbox/private/secret.jpg':gpsJpeg(),
    'conversations.json':j([{id:'chat-private',mapping:{secret:'do-not-parse'}}])
  }));
  const detected=await detectZipArchiveSource(file,{skipPrivateEntries:true});
  assert.ok(detected.sources.includes('threads'));
  assert.equal(detected.inspectedFiles,1,'private JSON and EXIF must not be inflated during public source inspection');
  assert.ok(!detected.structure?.sources?.some?.(entry=>String(entry).includes('private')));
  const records=[],media=[],exif=[];
  const summary=await inspectPrivateArchive(file,{
    skipPrivateEntries:true,
    onRecord:r=>records.push(r),
    onMediaEntry:r=>media.push(r),
    onMediaMetadata:r=>exif.push(r)
  });
  assert.equal(records.length,1);
  assert.equal(records[0].platform,'threads');
  assert.equal(records[0].text,'公開文字');
  assert.equal(summary.totalRows,1);
  assert.equal(summary.acceptedRows,1);
  assert.equal(summary.mediaFiles,0);
  assert.deepEqual(media,[]);
  assert.deepEqual(exif,[]);
  const localRecords=[];
  await inspectPrivateArchive(file,{onRecord:r=>localRecords.push(r)});
  assert.ok(localRecords.some(r=>r.platform==='messenger'));
});



test('full Facebook ZIP JSON inventory is independent of 160-file schema sampling',async()=>{
  const entries={};
  for(let n=0;n<180;n++)entries['your_facebook_activity/posts/batch_'+n+'.json']=j([{
    id:'post-'+n,timestamp:1720000000+n,data:[{post:'公開貼文 '+n}]
  }]);
  entries['your_facebook_activity/messages/inbox/contact/message_1.json']=j({
    participants:[{name:'A'}],messages:[{sender_name:'A',content:'PRIVATE'}]
  });
  entries['other/unknown.json']=j({settings:{theme:'dark'}});
  entries['your_facebook_activity/posts/photo.jpg']=strToU8('not an actual image');
  const file=asFile('facebook-inventory.zip',zipSync(entries));
  const found=await detectZipArchiveSource(file,{skipPrivateEntries:true});
  assert.equal(found.fileInventory.jsonFiles,182);
  assert.equal(found.fileInventory.privateJsonFiles,1);
  assert.equal(found.fileInventory.allFiles,183);
  assert.ok(found.inspectedFiles<180);
  const records=[];
  const summary=await inspectPrivateArchive(file,{skipPrivateEntries:true,onRecord:r=>records.push(r)});
  assert.equal(summary.jsonFilesSeen,182);
  assert.equal(summary.jsonFilesPrivate,1);
  assert.equal(summary.jsonFilesParsed,180);
  assert.equal(summary.jsonFilesUnrecognized,1);
  assert.equal(summary.jsonFilesOversize,0);
  assert.equal(summary.jsonFilesUnsupported,0);
  assert.equal(records.length,180);
});

test('Facebook repeated array envelopes preserve body, place, media and linked private EXIF',async()=>{
  const image='your_facebook_activity/posts/media/nested-photo.jpg';
  const post={id:'fb-array-01',timestamp:1720000000,
    title:'系統顯示：更新了近況',
    data:{array:[{post:'第一行\n第二行',
      attachments:{array:[{data:{array:[{media:{
        uri:image,url:'https://media.example.test/nested-photo.jpg',type:'image'
      }}]}}]}}]},
    attachments:{array:[{data:{array:[{place:{name:'某車站'}}]}}]}
  };
  const src=zipSync({
    'your_facebook_activity/posts/your_posts_1.json':j({array:{array:[post]}}),
    [image]:gpsJpeg()
  });
  const input=asFile('fb-deep-archive.zip',src);
  const collector=createArchiveEvidenceCollector();
  const articles=[];
  const result=await inspectPrivateArchive(input,{
    onRecord:record=>{
      const row=archiveGalaxyRow(record);
      if(row){articles.push(row);collector.onRecord(record,row.uid);}
    },
    onMediaEntry:item=>collector.onMediaEntry(item),
    onMediaMetadata:item=>collector.onExif(item)
  });
  assert.equal(result.acceptedRows,1);
  assert.equal(articles.length,1);
  assert.equal(articles[0].site,'Facebook');
  assert.equal(articles[0].content,'第一行\n第二行');
  assert.equal(articles[0].location,'某車站');
  assert.equal(articles[0].createtime,'2024-07-03T09:46:40.000Z');
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:input.name,archiveSize:input.size});
  const plan=prepareArchiveMedia(evidence,new Set(articles.map(row=>row.uid)));
  assert.equal(result.exifWithGps,1);
  assert.equal(plan.media.length,1);
  assert.equal(plan.exif.length,1);
  assert.equal(plan.media[0].url,'https://media.example.test/nested-photo.jpg');
  assert.equal(plan.media[0].__article_uid,articles[0].uid);
  assert.ok(Math.abs(plan.exif[0].latitude-25.0333)<0.01);
  assert.equal(articles[0].place_id,undefined,'EXIF must not invent check-in anchor');
});

test('Facebook arrays nested inside array items and raw array-of-arrays are read exactly once',async()=>{
  const post={id:'fb-array-02',timestamp:1720000100,data:[{post:'深層貼文'}]};
  for(const [name,structure] of [
    ['object-array',{array:[{array:[post]}]}],
    ['root-array',[[post]]]
  ]){
    const a=await parsed('fb-'+name+'.zip',{
      'your_facebook_activity/posts/your_posts_2.json':j(structure)
    });
    assert.equal(a.summary.acceptedRows,1,name);
    assert.equal(a.results.length,1,name);
    assert.equal(a.results[0].content,'深層貼文',name);
  }
});

test('Facebook multi-file archive counts all 358 JSON entries instead of stopping early',async()=>{
  const entries={};
  for(let i=0;i<358;i++){
    entries['your_facebook_activity/posts/your_posts_'+(i+1)+'.json']=j([{
      id:'fb-'+i,timestamp:1720000000+i,data:[{post:'匯入文字 '+i}]
    }]);
  }
  const a=await parsed('fb-358-parts.zip',entries);
  assert.equal(a.summary.jsonFilesParsed,358);
  assert.equal(a.summary.acceptedRows,358);
  assert.equal(a.results.length,358);
});

test('standalone Facebook JSON unwraps repeated array structures without flattening post media',()=>{
  const post={timestamp:1720000000,title:'系統標題',data:[{post:'真實內文'}],
    attachments:[{data:[{media:{uri:'photos/x.jpg'}}]}]};
  for(const payload of [
    {array:{array:[post]}},
    {array:[{array:[post]}]},
    [[post]]
  ]){
    const rows=importRowsFromJson(payload);
    assert.equal(rows.length,1);
    assert.deepEqual(rows[0],post);
  }
});

test('Facebook array["array"] path is supported and nested post data[] is not mistaken for root',()=>{
  const payload={array:{array:[{id:'fb-root-1',
    data:[{post:'實際正文',attachments:[{media:{uri:'photo.jpg'}}]}]}]}};
  assert.equal(archiveRecordStreamPath(JSON.stringify(payload),'array'),'$.array.array.*');
  assert.deepEqual(archiveRootContainers(JSON.stringify(payload)).map(v=>v.key),['array']);
  for(const path of ['array.array','array["array"]',"array['array']"]){
    const rows=importRowsFromJson(payload,path);
    assert.equal(rows.length,1,path);
    assert.equal(rows[0].data[0].post,'實際正文',path);
    assert.equal(rows[0].data[0].attachments.length,1,path);
  }
});

test('Threads followers and likes are not authored posts, even if usernames look like text',async()=>{
  const zip={
    'activity/threads/followers.json':j({followers:[
      {title:'sharon_n825',timestamp:1720000000},
      {title:'raneemgodah0',timestamp:1720000100}
    ]}),
    'activity/threads/liked_threads.json':j([
      {title:'dude_darkside',timestamp:1720000200}
    ]),
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[
      {id:'genuine-thread',text:'這是真正的 Threads 文章',timestamp:1720000300}
    ]})
  };
  const a=await parsed('full-threads-activity.zip',zip);
  assert.deepEqual(a.results.map(row=>row.content),['這是真正的 Threads 文章']);
  const file=asFile('full-threads-activity.zip',zipSync(zip));
  const encountered=[];
  await inspectPrivateArchive(file,{onRecord:record=>encountered.push(record)});
  assert.equal(encountered.filter(r=>r.kind==='post').length,1);
  assert.equal(encountered.filter(r=>r.kind==='relation').length,2);
  assert.equal(encountered.filter(r=>r.kind==='reaction').length,1);
  assert.equal(encountered.filter(r=>!isPublicArchiveRecord(r)).length,3);
});
test('Threads follower lists are never promoted to Galaxy even from an unfiltered record callback',()=>{
  assert.equal(archiveGalaxyRow({
    platform:'threads',kind:'relation',key:'threads:relation:test',
    text:'sharon_n825',createdAt:'2026-01-26T01:16:19Z'
  }),null);
  assert.equal(archiveGalaxyRow({
    platform:'threads',kind:'reaction',key:'threads:reaction:test',
    text:'liked_username',createdAt:'2026-01-26T01:16:19Z'
  }),null);
});

test('Threads archived title is always the first ten Unicode content characters',()=>{
  const article=archiveGalaxyRow({
    platform:'threads',kind:'post',key:'threads:post:title',
    title:'原始檔標題不應當作 Threads 標題',
    text:'前五個字😀接下來也要被截斷abcdefghi',
    createdAt:'2026-10-30T00:00:00Z'
  });
  assert.equal(article.site,'Threads');
  assert.equal(article.title,Array.from(article.content).slice(0,10).join(''));
  assert.notEqual(article.title,'原始檔標題不應當作 Threads 標題');
});

test('Threads ZIP file with no EXIF and no media URL does not store URI-only media',async()=>{
  const input=asFile('threads-no-exif.zip',zipSync({
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[{
      id:'th-no-exif',media:[{uri:'threads/media/real.jpg',title:'公開貼文的圖片',creation_timestamp:1720000000}]
    }]}),
    'threads/media/real.jpg':strToU8('image without EXIF metadata')
  }));
  const collector=createArchiveEvidenceCollector(),uids=new Set();
  const summary=await inspectPrivateArchive(input,{
    onRecord:record=>{
      if(!isPublicArchiveRecord(record))return;
      const article=archiveGalaxyRow(record);
      if(article){uids.add(article.uid);collector.onRecord(record,article.uid);}
    },
    onMediaEntry:item=>collector.onMediaEntry(item),
    onMediaMetadata:item=>collector.onExif(item)
  });
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:input.name,archiveSize:input.size})
    .filter(entry=>entry.galaxy_uids.some(uid=>uids.has(uid)));
  const plan=prepareArchiveMedia(evidence,uids);
  assert.equal(summary.exifWithGps,0);
  assert.equal(summary.exifWithTime,0);
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,0);
});

test('Textless Threads media-only post without a URL is not imported as media or a text article',async()=>{
  const input=asFile('threads-media-only.zip',zipSync({
    'activity/threads/threads_posts.json':j({text_post_app_text_posts:[{
      id:'post-image-only',media:[{uri:'threads/media/picture.jpg',creation_timestamp:1720000000}]
    }]}),
    'threads/media/picture.jpg':strToU8('image without EXIF')
  }));
  const collector=createArchiveEvidenceCollector(),articles=[];
  await inspectPrivateArchive(input,{
    onRecord:record=>{
      if(!isPublicArchiveRecord(record))return;
      const article=archiveGalaxyRow(record);
      if(article)articles.push(article);
      collector.onRecord(record,article?.uid||null);
    },
    onMediaEntry:item=>collector.onMediaEntry(item),
    onMediaMetadata:item=>collector.onExif(item)
  });
  const rows=collector.rows({scopeId:'lo3rwang',archiveName:input.name,archiveSize:input.size});
  const plan=prepareArchiveMedia(rows,new Set(articles.map(item=>item.uid)));
  assert.equal(articles.length,0);
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
});

test('Instagram nested label_values keeps the caption on the post and hangs the media on it',async()=>{
  const file=asFile('instagram-nested.zip',zipSync({
    'your_instagram_activity/media/posts.json':j([{
      timestamp:1720000000,fbid:'179000112233',media:[],
      label_values:[
        {label:'說明文字',value:'這是自己的照片說明'},
        {label:'影音內容',media:[{uri:'media/posts/photo.jpg',url:'https://cdn.example.test/ig-photo.jpg',title:'這是自己的照片說明'}]}
      ]
    }]),
    'media/posts/photo.jpg':new Uint8Array([1,2,3])
  }));
  const articles=[],collector=createArchiveEvidenceCollector();
  await inspectPrivateArchive(file,{onRecord:record=>{
    for(const mapped of archiveGalaxyRows(record)){
      articles.push(mapped.row);
      collector.onRecord({...record,attachments:mapped.attachments},mapped.row.uid);
    }
  },onMediaEntry:entry=>collector.onMediaEntry(entry)});
  assert.equal(articles.length,1);
  const [post]=articles;
  assert.equal(post.site_id,'179000112233');
  assert.equal(post.content,'這是自己的照片說明');
  assert.equal(post.target_id,undefined);
  assert.equal(post.source_id,undefined);
  const plan=prepareArchiveMedia(collector.rows({scopeId:'test',archiveName:'test',archiveSize:file.size}),
    new Set(articles.map(row=>row.uid)));
  assert.equal(plan.mediaLinks.length,1);
  assert.equal(plan.mediaLinks[0].uid,post.uid);
});
test('Instagram media post with no real caption, only a filename-like title, does not become a junk article',async()=>{
  // Meta's Instagram export can set a captionless post's `title` to the
  // attached media's own filename/ID (a long digit/underscore token) rather
  // than leaving it empty or null. Treating that as the post's caption used
  // to create an article whose entire content — and, since the title is
  // derived from the content, its title too — was that meaningless filename.
  const a=await parsed('instagram-filename-title.zip',{
    'your_instagram_activity/media/posts.json':j([
      {timestamp:1720000000,fbid:'179000998877',
        title:'400668176_122098823604258632_5990818633319476005_n'},
      {timestamp:1720000100,fbid:'179000998888',title:'這是真的說明文字'}
    ])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].site_id,'179000998888');
  assert.equal(a.results[0].content,'這是真的說明文字');
});
test('Undated Instagram caption retains null creation time and stable Galaxy identities',async()=>{
  const file=asFile('undated.zip',zipSync({
    'your_instagram_activity/media/posts.json':j([{
      fbid:'179000887766',media:[],
      label_values:[
        {label:'說明文字',value:'沒有發表時間的照片'},
        {label:'影音內容',media:[{uri:'media/posts/undated.jpg',title:'沒有發表時間的照片'}]}
      ]
    }])
  }));
  const batches=[];
  for(let i=0;i<2;i++){
    const records=[];
    await inspectPrivateArchive(file,{onRecord:record=>{
      records.push(...archiveGalaxyRows(record).map(entry=>entry.row));
    }});
    batches.push(records);
  }
  assert.deepEqual(batches[0].map(row=>row.uid),batches[1].map(row=>row.uid));
  assert.equal(batches[0].length,1);
  assert.equal(batches[0][0].site_id,'179000887766');
  assert.ok(batches[0].every(row=>row.createtime===null));
});

test('Facebook ZIP album parent, photo captions and original media are mapped together',async()=>{
  const zip=asFile('facebook-album.zip',zipSync({
    'your_facebook_activity/posts/album/3.json':j({
      name:'旅行相簿',description:'記錄旅途',
      last_modified_timestamp:1760000000,
      photos:[
        {uri:'media/albums/one.jpg',url:'https://cdn.example.test/one.jpg',title:'山景',creation_timestamp:1368248935},
        {uri:'media/albums/two.jpg',url:'https://cdn.example.test/two.jpg',title:'日落'}
      ]
    }),
    'media/albums/one.jpg':new Uint8Array([1,2]),
    'media/albums/two.jpg':new Uint8Array([3,4])
  }));
  const mapped=[],collector=createArchiveEvidenceCollector();
  await inspectPrivateArchive(zip,{onRecord:record=>{
    for(const entry of archiveGalaxyRows(record)){
      mapped.push(entry.row);
      collector.onRecord({...record,attachments:entry.attachments},entry.row.uid);
    }
  },onMediaEntry:entry=>collector.onMediaEntry(entry)});
  assert.equal(mapped.length,3);
  const [parent,first,second]=mapped;
  assert.equal(parent.content,'記錄旅途');
  assert.equal(parent.site_id,'album:'+first.createtime,'albums are marked so they compare with albums only');
  assert.equal(parent.createtime,first.createtime,'album time is its earliest photo');
  assert.deepEqual(parent.target_id,[first.uid,second.uid]);
  assert.equal(first.source_id,parent.uid);
  assert.equal(second.source_id,parent.uid);
  assert.equal(first.content,'山景');
  assert.equal(second.content,'日落');
  assert.ok(first.createtime?.startsWith('2013-05-'));
  assert.equal(second.createtime,parent.createtime,'a photo without its own time inherits the album time');
  const mediaPlan=prepareArchiveMedia(collector.rows({
    scopeId:'test',archiveName:'facebook-album.zip',archiveSize:zip.size
  }),new Set(mapped.map(row=>row.uid)));
  assert.equal(mediaPlan.media.length,2);
  assert.ok(mediaPlan.mediaLinks.some(link=>link.uid===first.uid));
  assert.ok(mediaPlan.mediaLinks.some(link=>link.uid===second.uid));
});

test('Facebook album photo keeps both its title and description as its own pic_text',async()=>{
  const zip=asFile('album-desc.zip',zipSync({
    'your_facebook_activity/posts/album/5.json':j({
      name:'相簿',last_modified_timestamp:1760000000,
      photos:[
        {uri:'media/albums/a.jpg',title:'標題',description:'補充說明',creation_timestamp:1368248935},
        {uri:'media/albums/b.jpg',description:'只有說明',creation_timestamp:1368248999},
        {uri:'media/albums/c.jpg',title:'同樣',description:'同樣',creation_timestamp:1368249000},
        {uri:'media/albums/d.jpg',creation_timestamp:1368249100}
      ]
    }),
    'media/albums/a.jpg':new Uint8Array([1]),'media/albums/b.jpg':new Uint8Array([2]),
    'media/albums/c.jpg':new Uint8Array([3]),'media/albums/d.jpg':new Uint8Array([4])
  }));
  const rows=[];
  await inspectPrivateArchive(zip,{onRecord:record=>{for(const entry of archiveGalaxyRows(record))rows.push(entry);}});
  assert.equal(rows.length,4,'album + three photos with their own text');
  const [album,a,b,c]=rows.map(entry=>entry.row);
  assert.equal(a.content,'標題\n\n補充說明');
  assert.equal(a.title,'標題');
  assert.equal(b.content,'只有說明');
  assert.equal(b.title,'只有說明');
  assert.equal(c.content,'同樣');
  assert.deepEqual(album.target_id,[a.uid,b.uid,c.uid]);
  assert.equal(rows[0].attachments.length,1,'only the photo without text hangs on the album');
  assert.ok(rows.slice(1).every(entry=>entry.attachments.length===1),'one picture per pic_text');
});

test('Facebook post with no top-level text but description nested in label_values media becomes its own pic_text',async()=>{
  const zip=asFile('nested-caption.zip',zipSync({
    'your_facebook_activity/posts/media_used_for_memories.json':j([{
      media:[],fbid:'9343802625708141',
      label_values:[{
        label:'出現在你已分享的動態回顧貼文中的影音素材',
        media:[{
          uri:'your_facebook_activity/posts/media/a/1.jpg',creation_timestamp:1740982113,
          title:'行動上傳',description:'距離上次有過夜的旅遊，也五年了。'
        }]
      }]
    }]),
    'your_facebook_activity/posts/media/a/1.jpg':new Uint8Array([1])
  }));
  const rows=[];
  await inspectPrivateArchive(zip,{onRecord:record=>{for(const entry of archiveGalaxyRows(record))rows.push(entry);}});
  assert.equal(rows.length,1,'no post text, no album: one standalone pic_text');
  const [row]=rows.map(entry=>entry.row);
  assert.equal(row.content,'距離上次有過夜的旅遊，也五年了。',
    'the generic Facebook auto-title is not authored text');
  assert.equal(row.site_id,'9343802625708141:0');
  assert.equal(row.source_id,undefined,'nothing to attach to: there is no post text');
  assert.equal(row.createtime,'2025-03-03T06:08:33.000Z');
  assert.equal(rows[0].attachments.length,1);
});
test('a Facebook generic auto-title alone, without a description, creates no pic_text',async()=>{
  const zip=asFile('nested-no-desc.zip',zipSync({
    'your_facebook_activity/posts/media_used_for_memories.json':j([{
      media:[],fbid:'1',
      label_values:[{label:'x',media:[{
        uri:'your_facebook_activity/posts/media/a/2.jpg',creation_timestamp:1740982113,title:'行動上傳'
      }]}]
    }]),
    'your_facebook_activity/posts/media/a/2.jpg':new Uint8Array([1])
  }));
  const rows=[];
  await inspectPrivateArchive(zip,{onRecord:record=>{for(const entry of archiveGalaxyRows(record))rows.push(entry);}});
  assert.equal(rows.length,0);
});

test('nested caption media is found at any depth, not just label_values[].media[]',async()=>{
  const zip=asFile('deep-nested.zip',zipSync({
    'your_facebook_activity/posts/your_uncategorized_photos.json':j([{
      media:[],fbid:'555',
      attachments:[{data:[{media:[{
        uri:'your_facebook_activity/posts/media/your_posts/474008376020988.jpg',
        creation_timestamp:1372008872,
        description:'深層巢狀的說明文字'
      }]}]}]
    }]),
    'your_facebook_activity/posts/media/your_posts/474008376020988.jpg':new Uint8Array([1])
  }));
  const rows=[];
  await inspectPrivateArchive(zip,{onRecord:record=>{for(const entry of archiveGalaxyRows(record))rows.push(entry);}});
  assert.equal(rows.length,1);
  assert.equal(rows[0].row.content,'深層巢狀的說明文字');
  assert.equal(rows[0].attachments.length,1);
});
test('a media leaf with only an EXIF upload_ip and no title/description creates no pic_text',async()=>{
  const zip=asFile('exif-only.zip',zipSync({
    'your_facebook_activity/posts/your_uncategorized_photos.json':j([{
      media:[],fbid:'556',
      label_values:[{label:'x',media:[{
        uri:'your_facebook_activity/posts/media/your_posts/555.jpg',
        creation_timestamp:1372008872,
        media_metadata:{photo_metadata:{exif_data:[{upload_ip:'111.250.216.14'}]}}
      }]}]
    }]),
    'your_facebook_activity/posts/media/your_posts/555.jpg':new Uint8Array([1])
  }));
  const rows=[];
  await inspectPrivateArchive(zip,{onRecord:record=>{for(const entry of archiveGalaxyRows(record))rows.push(entry);}});
  assert.equal(rows.length,0,'no authored text anywhere, so nothing to write as a Galaxy article');
});
test('nested caption discovery is platform-agnostic: an X/Twitter post with no top text but a photo caption buried in extended_entities also becomes a pic_text, with site label X',async()=>{
  // Twitter/X exports are .js files wrapping JSON (window.YTD.tweet.part0 = [...]);
  // that wrapper is already stripped before this record exists, so record.raw here
  // is the same shape as any other parsed JSON — this is purely the intra-JSON
  // nested-text search, unrelated to how the source file was unwrapped.
  const record={
    platform:'x',kind:'post',key:'x:tweet:1',sourcePath:'data/tweets.js',createdAt:null,siteId:null,
    raw:{
      tweet:{id_str:'1',full_text:'',
        extended_entities:{media:[{
          media_url_https:'https://pbs.twimg.com/media/example.jpg',
          type:'photo',description:'推文裡藏的照片說明文字'
        }]}}
    }
  };
  const rows=[];
  for(const entry of archiveGalaxyRows(record))rows.push(entry);
  assert.equal(rows.length,1);
  assert.equal(rows[0].row.content,'推文裡藏的照片說明文字');
  assert.equal(rows[0].row.site,'X');
});


test('Facebook shared-link post imports the shared external URL, since Meta never exports the post\'s own permalink',async()=>{
  const a=await parsed('facebook-external.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-external',timestamp:1720000000,
      data:[{post:'分享外部新聞'}],
      attachments:[{data:[{external_context:{url:'https://news.example.test/story'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,'https://news.example.test/story');
});
test('Facebook shared-link post whose URL sits directly on the post (not inside external_context) still imports it',async()=>{
  // Meta has used both shapes across export versions/post types for the
  // SAME kind of post (sharing an external link): sometimes the link is
  // nested in attachments[].data[].external_context.url, sometimes it's a
  // plain `url` attribute directly on the post's own data[] entry. Both are
  // inherently cross-domain, so neither should be rejected for not matching
  // facebook.com.
  const a=await parsed('facebook-direct-url-share.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-direct',timestamp:1720000000,
      data:[{post:'分享外部連結',url:'https://www.youtube.com/watch?v=abc123'}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,'https://www.youtube.com/watch?v=abc123');
});
test('A real-platform post URL still wins over a shared external link in the same post',async()=>{
  const ownUrl='https://www.facebook.com/posts/real-abc123';
  const a=await parsed('facebook-external-and-own.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-both',timestamp:1720000000,
      data:[{post:'分享外部新聞',url:ownUrl}],
      attachments:[{data:[{external_context:{url:'https://news.example.test/story'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,ownUrl);
});
test('Facebook "shared a link" post with a YouTube link (real export shape) imports the YouTube URL',async()=>{
  const a=await parsed('facebook-youtube-share.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      timestamp:1658576219,
      attachments:[{data:[{external_context:{url:'https://www.youtube.com/watch?v=qGpe5AhV0Dk'}}]}],
      data:[{post:'tag 學一下新知識。\nhttps://www.youtube.com/watch?v=qGpe5AhV0Dk'},
        {update_timestamp:1658576219},{},{},{}],
      title:'Wang Oscar 分享了 1 條連結。'
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,'https://www.youtube.com/watch?v=qGpe5AhV0Dk');
});
test('A check-in photo post\'s place page URL stays out of Galaxy.url (it belongs to the place, not the post)',async()=>{
  const a=await parsed('facebook-photo-checkin.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      timestamp:1656652590,
      attachments:[
        {data:[{media:{uri:'your_facebook_activity/posts/media/photo/5283612511727193.jpg',
          creation_timestamp:1656652577,title:'行動上傳',description:'又漲了，唉'}}]},
        {data:[{place:{name:'三重集美-三色布丁',coordinate:{latitude:25.05338,longitude:121.49086},
          address:'241 台北市集美街161號',
          url:'https://www.facebook.com/pages/%E4%B8%89%E9%87%8D%E9%9B%86%E7%BE%8E/176138829094369'}}]}
      ],
      data:[{post:'又漲了，唉'},{}],
      title:'Wang Oscar 新增了 1 張相片。'
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url??null,null);
});

test('Facebook same-platform post URL inside data is imported as original article URL',async()=>{
  const url='https://www.facebook.com/posts/real-abc123';
  const a=await parsed('facebook-post.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      id:'fb-original',timestamp:1720000000,
      data:[{post:'原始文章',url}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,url);
});


test('Facebook Meta string_map_data translated post permalink is preserved as Galaxy.url',async()=>{
  const original='https://www.facebook.com/permalink.php?story_fbid=12345&id=67890';
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      timestamp:1720000000,data:[{post:'含有原始連結的文章'}],
      string_map_data:{'貼文連結':{value:original}}
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,original);
});
test('Facebook Meta label_values post URL is not confused with location or image URL',async()=>{
  const original='https://www.facebook.com/posts/12345';
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      timestamp:1720000000,data:[{post:'文字文章'}],
      label_values:[
        {label:'貼文網址',value:original},
        {label:'地點連結',value:'https://www.facebook.com/pages/place/123'}
      ],
      attachments:[{data:[{media:{uri:'photos/file.jpg',url:'https://cdn.example.test/a.jpg'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,original);
});
test('Facebook archive with only ZIP uri and source post id does not invent URL',async()=>{
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      post_id:'12345',timestamp:1720000000,data:[{post:'真實文章'}],
      attachments:[{data:[{media:{uri:'facebook/photos/file.jpg'}}]}]
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,undefined);
});


test('Facebook mojibake Meta label name is repaired before URL classification',async()=>{
  const original='https://www.facebook.com/posts/67890';
  const garbled=Buffer.from('貼文連結','utf8').toString('latin1');
  const a=await parsed('facebook-2026.zip',{
    'your_facebook_activity/posts/your_posts_1.json':j([{
      timestamp:1720000000,data:[{post:'文字貼文'}],
      string_map_data:{[garbled]:{value:original}}
    }])
  });
  assert.equal(a.results.length,1);
  assert.equal(a.results[0].url,original);
});
