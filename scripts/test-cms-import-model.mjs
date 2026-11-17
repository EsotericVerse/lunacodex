import test from 'node:test';
import assert from 'node:assert/strict';
import {schema} from '../packages/zenstack/schema.mjs';
import {detectCmsImportSource,normalizeCmsImportRow}
  from '../packages/zenstack/cms-import-model.mjs';

test('CMS import uses one nonphysical shared ZModel contract',()=>{
  const fields=Object.keys(schema.typeDefs.CmsImportArticle.fields);
  assert.deepEqual(fields,['cms','sourceId','title','body','createdAt','canonicalUrl','media']);
  assert.equal(schema.models.CmsImportArticle,undefined);
});

test('WordPress REST post content is preserved and date_gmt is UTC',()=>{
  const row={id:42,type:'post',title:{rendered:'首篇文章'},
    content:{rendered:'<p>原始正文</p>'},excerpt:{rendered:'只是摘要'},
    date_gmt:'2026-01-02T13:14:15',link:'https://blog.example/posts/42',
    featured_media:8,
    _embedded:{'wp:featuredmedia':[{source_url:'https://blog.example/image.jpg'}]}};
  assert.equal(detectCmsImportSource(row),'WordPress');
  const result=normalizeCmsImportRow(row,'Others');
  assert.equal(result.source,'WordPress');
  assert.equal(result.row.content,'<p>原始正文</p>');
  assert.equal(result.row.createtime,'2026-01-02T13:14:15.000Z');
  assert.equal(result.row.site_id,'https://blog.example:42');
  assert.equal(result.row.media[0].url,'https://blog.example/image.jpg');
  assert.deepEqual(row.content,{rendered:'<p>原始正文</p>'});
  const other=normalizeCmsImportRow({...row,link:'https://other.example/posts/42'},'WordPress');
  assert.notEqual(other.row.site_id,result.row.site_id);
});

test('Notion Page properties and Block Children use independent fields',()=>{
  const row={object:'page',id:'page-123',created_time:'2025-12-31T16:00:00.000Z',
    url:'https://www.notion.so/page-123',
    properties:{Name:{type:'title',title:[{plain_text:'完整標題'}]}},
    blocks:[{type:'heading_1',heading_1:{rich_text:[{plain_text:'第一章'}]}},
      {type:'paragraph',paragraph:{rich_text:[{plain_text:'正文段落'}]}},
      {type:'image',image:{external:{url:'https://cdn.example/photo.png'}}}]};
  assert.equal(detectCmsImportSource(row),'Notion');
  const result=normalizeCmsImportRow(row,'Others');
  assert.equal(result.source,'Notion');
  assert.equal(result.row.site_id,'page-123');
  assert.equal(result.row.title,'完整標題');
  assert.equal(result.row.createtime,'2025-12-31T16:00:00.000Z');
  assert.equal(result.row.content,'# 第一章\n\n正文段落');
  assert.deepEqual(result.row.media,[{media_type:'image',url:'https://cdn.example/photo.png'}]);
});

test('incomplete Notion pages fail rather than fabricate article bodies',()=>{
  assert.throws(()=>normalizeCmsImportRow({object:'page',id:'id',
    properties:{Name:{type:'title',title:[{plain_text:'只有標題'}]}}},'Notion'),/Block Children/);
  assert.throws(()=>normalizeCmsImportRow({object:'page',id:'id',
    blocks:[{type:'paragraph',has_children:true,paragraph:{rich_text:[]}}]},'Notion'),
    /子區塊/);
});

test('unknown JSON continues through the unchanged generic import path',()=>{
  const row={uid:'Ab12Cd34',site:'Vocus',title:'自訂文章',content:'完整正文'};
  assert.equal(detectCmsImportSource(row),'');
  const result=normalizeCmsImportRow(row,'Vocus');
  assert.equal(result.row,row);
  assert.equal(result.source,'Vocus');
});
