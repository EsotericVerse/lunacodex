import test from 'node:test';
import assert from 'node:assert/strict';
import {visualGalaxyCandidates,publicVisualUrl} from '../app/loc/import/visual-galaxy.mjs';
import {prepareArchiveMedia} from '../app/loc/archive/media-evidence.mjs';

test('only captioned public image creates Galaxy row linked to real article',()=>{
  const records=[
    {type:'image',__article_uid:'ABC12345',url:'https://example.org/photo.jpg',
      description:'圖片自己的文字',title:'圖片標題'},
    {type:'image',__article_uid:'ABC12345',url:'https://example.org/photo.jpg',
      description:'同一圖片不重複',title:'圖片標題'},
    {type:'image',__article_uid:'ABC12345',url:'zip/photo.jpg',description:'ZIP相片'},
    {type:'image',__article_uid:'ABC12345',url:'https://example.org/uncaptioned.jpg',
      title:'原文章'},
    {type:'video',__article_uid:'ABC12345',url:'https://example.org/video.mp4',
      title:'影片標題',description:'影片文字'},
    {type:'video',__article_uid:'ABC12345',url:'archive/only-local.mp4',
      description:'不可公開'}
  ];
  const out=visualGalaxyCandidates(records,{
    resolveOwner:uid=>uid==='ABC12345'?'XYZ12345':'',
    articlesByUid:new Map([['ABC12345',{site:'Facebook',title:'原文章'}]])
  });
  assert.deepEqual(out,[{
    source_id:'XYZ12345',url:'https://example.org/photo.jpg',
    content:'圖片自己的文字',title:'圖片標題',site:'Facebook',createtime:null
  },{
    source_id:'XYZ12345',url:'https://example.org/video.mp4',
    content:'影片文字',title:'影片標題',site:'Facebook',createtime:null
  }]);
  assert.equal('media_link' in out[0],false);
  assert.equal(publicVisualUrl('archive/photo.jpg'),'');
  assert.equal(publicVisualUrl('javascript:alert(1)'),'');
});
test('already captioned Galaxy picture with URL does not create another child',()=>{
  assert.deepEqual(visualGalaxyCandidates([{
    type:'image',__article_uid:'ABC12345',url:'https://example.org/photo.jpg',
    description:'文字'
  }],{resolveOwner:()=> 'XYZ12345',articlesByUid:new Map([
    ['ABC12345',{url:'https://example.org/photo.jpg',title:'文字',site:'Facebook'}]
  ])}),[]);
});
test('ZIP-only image/video paths are skipped, captioned public videos pass',()=>{
  const records=[
    {scope_id:'lo3rwang',archive_id:'z',entry_path:'photos/a.jpg',media_type:'image',
      galaxy_uids:['ABC12345'],found_in_zip:true,referenced_by_post:true,
      url:null,caption:'照片文字'},
    {scope_id:'lo3rwang',archive_id:'z',entry_path:'photos/b.jpg',media_type:'image',
      galaxy_uids:['ABC12345'],found_in_zip:false,referenced_by_post:true,
      url:'https://example.org/photo.jpg',caption:'照片文字'},
    {scope_id:'lo3rwang',archive_id:'z',entry_path:'videos/v.mp4',media_type:'video',
      galaxy_uids:['ABC12345'],found_in_zip:true,referenced_by_post:true,
      url:null,caption:'沒有公開網址'},
    {scope_id:'lo3rwang',archive_id:'z',entry_path:'videos/valid.mp4',media_type:'video',
      galaxy_uids:['ABC12345'],found_in_zip:false,referenced_by_post:true,
      url:'https://example.org/clip.mp4',caption:'影片文字'}
  ];
  const out=prepareArchiveMedia(records,new Set(['ABC12345']));
  assert.deepEqual(out.media.map(row=>row.type),['image','video']);
  assert.equal(out.media[0].description,'照片文字');
  assert.equal(out.media[1].description,'影片文字');
  assert.equal(out.mediaLinks.length,0);
});
