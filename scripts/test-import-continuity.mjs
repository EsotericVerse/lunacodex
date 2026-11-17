// Regression fixtures for flat, model-driven CMS imports and archive continuity.
// These tests exercise existing batch/source functions without database writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importRowsFromJson,mappedImportValue,normalizeImportMedia}
  from '../app/loc/import/batch.mjs';

test('WordPress postmeta joins by exact source ID, keeping repeated meta_key rows',()=>{
  const json={
    wp_posts:[
      {ID:12,post_title:'A',post_content:'article A'},
      {ID:13,post_title:'B',post_content:'article B'}
    ],
    wp_postmeta:[
      {meta_id:1,post_id:12,meta_key:'subtitle',meta_value:'a1'},
      {meta_id:2,post_id:'12',meta_key:'subtitle',meta_value:'a2'},
      {meta_id:3,post_id:13,meta_key:'subtitle',meta_value:'b1'}
    ]
  };
  const rows=importRowsFromJson(json,'','WordPress');
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0].meta.map(item=>item.meta_value),['a1','a2']);
  assert.deepEqual(rows[1].meta.map(item=>item.meta_value),['b1']);
  assert.equal(mappedImportValue(rows[0],'content',{},'WordPress'),'article A');
  assert.equal(mappedImportValue(rows[1],'site_id',{},'WordPress'),13);
  assert.equal(json.wp_posts[0].meta,undefined,'source object must remain unchanged');
});

test('Notion direct page blocks compose ordered rich text without recursive crawling',()=>{
  const json={
    pages:[{object:'page',id:'page-12',properties:{Name:{title:[{plain_text:'Page'}]}}}],
    blocks:[
      {id:'b1',object:'block',parent:{page_id:'page-12'},type:'paragraph',
        paragraph:{rich_text:[{plain_text:'Hello '},{plain_text:'world'}]}},
      {id:'b2',object:'block',parent:{page_id:'page-12'},type:'heading_2',
        heading_2:{rich_text:[{plain_text:'Second line'}]}},
      {id:'orphan',object:'block',parent:{page_id:'another-page'},type:'paragraph',
        paragraph:{rich_text:[{plain_text:'Not included'}]}}
    ]
  };
  const [page]=importRowsFromJson(json,'','Notion');
  assert.equal(mappedImportValue(page,'title',{},'Notion'),'Page');
  assert.equal(mappedImportValue(page,'content',{},'Notion'),'Hello world\n\nSecond line');
  assert.equal(json.pages[0].content,undefined);
});

test('Notion images join by exact page ID and keep signed URLs',()=>{
  const page={object:'page',id:'page-img',properties:{Name:{title:[{plain_text:'Gallery'}]}}};
  const imageBlock={object:'block',parent:{page_id:'page-img'},type:'image',
    image:{type:'file',file:{url:'https://signed.example.org/photo?sig=xyz'}}};
  const [joined]=importRowsFromJson({pages:[page],blocks:[imageBlock]},'','Notion');
  assert.equal(joined.media.length,1);
  assert.equal(joined.media[0].media_type,'image');
  assert.equal(joined.media[0].file.url,'https://signed.example.org/photo?sig=xyz');
  const media=normalizeImportMedia(joined.media,{title:'Gallery'});
  assert.equal(media.records[0].media_type,'image');
  assert.equal(media.records[0].url,'https://signed.example.org/photo?sig=xyz');
});

test('standalone Notion block collections remain supported',()=>{
  const paragraph={id:'block-1',object:'block',type:'paragraph',
    paragraph:{rich_text:[{plain_text:'Only block'}]}};
  assert.deepEqual(importRowsFromJson({blocks:[paragraph]},'','Notion'),[paragraph]);
});

test('declarative source media type supports signed Notion image URLs',()=>{
  const file={type:'file',file:{url:'https://signed.example.org/asset?token=abc'}};
  const media=normalizeImportMedia(file,{defaultMediaType:'image'});
  assert.equal(media.records.length,1);
  assert.equal(media.records[0].media_type,'image');
  assert.equal(media.records[0].url,'https://signed.example.org/asset?token=abc');
});

test('historic data does not silently disappear behind a recent-only default',()=>{
  const ui=readFileSync(new URL('../app/loc/import/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(ui,/const \[timeRange,setTimeRange\]=useState\('all'\)/);
  assert.match(ui,/if\(current&&value&&!archiveDetection\)/,
    'choosing a source for the next ZIP must load that file');
  assert.match(ui,/const \[analysisSnapshot,setAnalysisSnapshot\]=useState\(null\)/);
});
