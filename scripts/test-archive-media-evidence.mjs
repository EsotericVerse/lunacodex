import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveAttachmentReferences,archiveMediaUid,createArchiveEvidenceCollector,prepareArchiveMedia} from '../app/loc/archive-media-evidence.mjs';

test('Facebook, Threads, Instagram nested attachment URLs are preserved',()=>{
  const samples=[
    {platform:'facebook',attachments:[{data:[{media:{uri:'facebook/img/f.jpg',
      url:'https://example.test/f.jpg',type:'image'}}]}]},
    {platform:'threads',photos:[{uri:'threads/photos/t.jpg',
      url:'https://example.test/t.jpg',media_type:'image'}]},
    {platform:'instagram',media:[{uri:'instagram/posts/i.jpg',
      url:'https://example.test/i.jpg',type:'image'}]}
  ];
  const collector=createArchiveEvidenceCollector();
  samples.forEach((row,index)=>{
    const attachments=archiveAttachmentReferences(row);
    assert.equal(attachments.length,1);
    collector.onRecord({...row,attachments,sourcePath:row.platform+'/posts.json'},'AAAA000'+index);
    collector.onMediaEntry({path:attachments[0].uri});
    collector.onExif({path:attachments[0].uri,metadata:{
      latitude:25.03,longitude:121.52,cameraLocalTime:'2020:01:02 03:04:05'
    }});
  });
  const result=collector.rows({scopeId:'lo3rwang',archiveName:'meta.zip',archiveSize:42});
  const plan=prepareArchiveMedia(result,new Set(['AAAA0000','AAAA0001','AAAA0002']));
  assert.equal(result.length,3);
  assert.equal(plan.media.length,3);
  assert.equal(plan.exif.length,3);
  assert.deepEqual(new Set(plan.exif.map(v=>v.platform)),new Set(['facebook','threads','instagram']));
  assert.equal(plan.media.every(v=>v.url?.startsWith('https://example.test/')),true);
  assert.equal(plan.media.every(v=>!Object.hasOwn(v,'latitude')&&!Object.hasOwn(v,'longitude')),true);
  assert.equal(plan.exif.every(v=>v.latitude===25.03&&v.longitude===121.52),true);
});
test('EXIF-only local ZIP photograph is kept without inventing a public URL or post time',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onMediaEntry({path:'photos/only.jpg'});
  collector.onExif({path:'photos/only.jpg',metadata:{latitude:25.03,longitude:121.52}});
  const rows=collector.rows({scopeId:'local',archiveName:'photos.zip',archiveSize:99});
  const plan=prepareArchiveMedia(rows,new Set());
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,1);
  assert.equal(plan.exif[0].media_uid,null);
  assert.equal(plan.exif[0].latitude,25.03);
});
test('Only an unambiguous full relative path can associate an article with ZIP media',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onMediaEntry({path:'a/media/photo.jpg'});
  collector.onMediaEntry({path:'b/media/photo.jpg'});
  collector.onExif({path:'a/media/photo.jpg',metadata:{latitude:25.001,longitude:121.5}});
  collector.onExif({path:'b/media/photo.jpg',metadata:{latitude:25.002,longitude:121.5}});
  collector.onRecord({platform:'threads',attachments:[{uri:'media/photo.jpg'}]},'AAAA0000');
  const rows=collector.rows({scopeId:'local',archiveName:'ambiguous.zip',archiveSize:31});
  assert.equal(rows.filter(v=>v.found_in_zip).length,2);
  assert.equal(rows.filter(v=>v.found_in_zip).every(v=>v.galaxy_uids.length===0),true);
});
test('Article-linked archive image without a public URL retains EXIF evidence but creates no URL-less media',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onMediaEntry({path:'facebook/photos/private.jpg'});
  collector.onRecord({platform:'facebook',attachments:[{uri:'facebook/photos/private.jpg'}]},'AAAA0001');
  collector.onExif({path:'facebook/photos/private.jpg',metadata:{
    latitude:25.033,longitude:121.519,cameraLocalTime:'2020:04:05 06:07:08'
  }});
  const entries=collector.rows({scopeId:'lo3rwang',archiveName:'fb.zip',archiveSize:1024});
  const plan=prepareArchiveMedia(entries,new Set(['AAAA0001']));
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,1);
  assert.equal(plan.exif[0].media_uid,null);
  assert.equal(plan.exif[0].latitude,25.033);
});
test('ZIP images with neither URL nor EXIF are not imported as media',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onMediaEntry({path:'instagram/photos/empty.jpg'});
  const rows=collector.rows({scopeId:'lo3rwang',archiveName:'ig.zip',archiveSize:56});
  const plan=prepareArchiveMedia(rows,new Set());
  assert.equal(rows.length,0);
  assert.equal(plan.media.length,0);
  assert.equal(plan.exif.length,0);
});
test('Archive media UID is stable for idempotent re-import',()=>{
  const a=archiveMediaUid('lo3rwang','fb.zip:100','facebook/img/a.jpg');
  assert.match(a,/^[A-Z0-9]{8}$/);
  assert.equal(a,archiveMediaUid('lo3rwang','fb.zip:100','facebook/img/a.jpg'));
  assert.notEqual(a,archiveMediaUid('lo3rwang','fb.zip:100','facebook/img/b.jpg'));
});

test('One ZIP image shared by two articles makes one media row and two links',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onMediaEntry({path:'threads/media/common.jpg'});
  for(const uid of ['AAAA0001','AAAA0002'])collector.onRecord({
    platform:'threads',attachments:[{uri:'threads/media/common.jpg',url:'https://cdn.example.test/common.jpg'}]
  },uid);
  collector.onExif({path:'threads/media/common.jpg',metadata:{latitude:25.1,longitude:121.5}});
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'threads.zip',archiveSize:100});
  const plan=prepareArchiveMedia(evidence,new Set(['AAAA0001','AAAA0002']));
  assert.equal(plan.media.length,1);
  assert.equal(plan.mediaLinks.length,2);
  assert.equal(new Set(plan.mediaLinks.map(v=>v.uid)).size,2);
  assert.equal(new Set(plan.mediaLinks.map(v=>v.media_uid)).size,1);
  assert.equal(plan.exif.length,1);
});

test('Threads ZIP photo linked to an authored post without public URL is not saved as media',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({platform:'threads',attachments:[{uri:'threads/media/real.jpg'}]},'AAAA0001');
  collector.onMediaEntry({path:'threads/media/real.jpg'});
  const entries=collector.rows({scopeId:'lo3rwang',archiveName:'threads.zip',archiveSize:526});
  const plan=prepareArchiveMedia(entries,new Set(['AAAA0001']));
  assert.equal(entries.length,1);
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,0);
});

test('Media-only Threads post with no JSON URL is not persisted',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({platform:'threads',attachments:[{uri:'threads/media/textless.jpg'}]},null);
  collector.onMediaEntry({path:'threads/media/textless.jpg'});
  const entries=collector.rows({scopeId:'lo3rwang',archiveName:'threads.zip',archiveSize:998});
  const plan=prepareArchiveMedia(entries,new Set());
  assert.equal(entries.length,1);
  assert.equal(plan.media.length,0);
  assert.equal(plan.mediaLinks.length,0);
  assert.equal(plan.exif.length,0);
});


test('ZIP media imports use linked article createtime when the media has no own timestamp',()=>{
  const c=createArchiveEvidenceCollector();
  c.onRecord({platform:'facebook',attachments:[{uri:'photos/dated.jpg',url:'https://cdn.example.test/dated.jpg'}]},'ART00001');
  c.onMediaEntry({path:'photos/dated.jpg'});
  const source=c.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:12});
  const plan=prepareArchiveMedia(source,new Set(['ART00001']),
    new Map([['ART00001','2023-08-11T05:06:07.000Z']]));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].createtime,'2023-08-11T05:06:07.000Z');
});

test('ZIP time fallback never invents a date from EXIF or an unrelated article',()=>{
  const c=createArchiveEvidenceCollector();
  c.onRecord({platform:'facebook',attachments:[{uri:'photos/old.jpg',url:'https://cdn.example.test/old.jpg'}]},'ART00002');
  c.onMediaEntry({path:'photos/old.jpg'});
  c.onExif({path:'photos/old.jpg',metadata:{cameraLocalTime:'2021:01:01 09:15:00'}});
  const source=c.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:13});
  const plan=prepareArchiveMedia(source,new Set(['ART00002']),
    new Map([['WRONG003','2022-01-02T03:04:05.000Z']]));
  assert.equal(plan.media[0].createtime,null);
  assert.equal(plan.exif[0].camera_local_time,'2021:01:01 09:15:00');
});

test('Media linked by multiple articles uses the earliest available article timestamp',()=>{
  const c=createArchiveEvidenceCollector();
  for(const uid of ['ART00003','ART00004'])
    c.onRecord({platform:'facebook',attachments:[{uri:'photos/shared.jpg',url:'https://cdn.example.test/shared.jpg'}]},uid);
  c.onMediaEntry({path:'photos/shared.jpg'});
  const source=c.rows({scopeId:'lo3rwang',archiveName:'backup.zip',archiveSize:17});
  const plan=prepareArchiveMedia(source,new Set(['ART00003','ART00004']),new Map([
    ['ART00003','2024-08-01T02:00:00.000Z'],
    ['ART00004','2024-07-01T02:00:00.000Z']
  ]));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].createtime,'2024-07-01T02:00:00.000Z');
});

test('large nested archive media list preserves its final photo without quadratic traversal',()=>{
  const fillers=Array.from({length:2800},(_,i)=>({title:'non-media '+i}));
  const record={media:[...fillers,{uri:'facebook/album/last.jpg',
    media_url:'https://example.test/album/last.jpg',type:'image'}]};
  assert.deepEqual(archiveAttachmentReferences(record),[{
    uri:'facebook/album/last.jpg',mediaType:'image',
    url:'https://example.test/album/last.jpg'
  }]);
});

test('large archive media list deduplicates identical paths and keeps public URL',()=>{
  const filler=Array.from({length:1800},(_,i)=>({title:'item '+i}));
  const record={media:[{uri:'threads/images/one.jpg'},...filler,
    {uri:'threads/images/one.jpg',media_url:'https://example.test/one.jpg'}]};
  assert.deepEqual(archiveAttachmentReferences(record),[{
    uri:'threads/images/one.jpg',mediaType:'image',url:'https://example.test/one.jpg'
  }]);
});

test('ZIP-imported media uses linked article caption and does not manufacture a filename title',()=>{
  const collector=createArchiveEvidenceCollector();
  collector.onRecord({platform:'instagram',attachments:[{
    uri:'media/reels/strange-name.mp4',url:'https://cdn.example.test/real.mp4'
  }]},'ART00001');
  const evidence=collector.rows({scopeId:'lo3rwang',archiveName:'ig.zip',archiveSize:100});
  const plan=prepareArchiveMedia(evidence,new Set(['ART00001']),new Map(),
    new Map([['ART00001','真實文章標題']]),new Map([['ART00001','真實文章內文']]));
  assert.equal(plan.media.length,1);
  assert.equal(plan.media[0].title,'真實文章標題');
  assert.equal(plan.media[0].meta_tags,'真實文章內文');
  assert.doesNotMatch(plan.media[0].title,/strange-name/);
  assert.equal(plan.media[0].url,'https://cdn.example.test/real.mp4');
});
