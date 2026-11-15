import test from 'node:test';
import assert from 'node:assert/strict';
import {content_filter,keywordScanText} from '../app/loc/content-filter.mjs';
import {classSkipArticleWords} from '../app/loc/keyword-class-exceptions.mjs';
import {createKeywordDocumentClassifier} from '../app/loc/model/keyword-engine.mjs';
import {createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';

test('Legacy opening date metadata and separators are not searchable',()=>{
  const original='日期：2017-10-31\n標題：彩虹橋\n========\n月光與河流。\n';
  const clean=content_filter(original);
  assert.equal(clean,'彩虹橋\n月光與河流。');
  assert.equal(original.includes('日期：'),true,'Stored original must be untouched');
  assert.equal(content_filter('今天說到日期：2017-10-31，月光仍在。'),
    '今天說到日期：2017-10-31，月光仍在。');
});

test('Visible HTML text survives; CSS/JS/attributes/truncated tags do not',()=>{
  assert.equal(content_filter('<div class="月光"><span>銀色河流</span></div>'),'銀色河流');
  assert.equal(content_filter('&lt;div&gt;月光&lt;/div&gt;'),'月光');
  assert.equal(content_filter('<script>日期 日期</script><div>星光</div>'),'星光');
  assert.equal(content_filter('<!-- 日期 --><style>.月光{}</style><p>夜</p>'),'夜');
  assert.equal(content_filter('<div class="layout"'),'');
  assert.equal(content_filter('[銀色河流](https://example.org/post)'),'銀色河流');
});

test('Structured CMS JSON exposes content text only, without metadata',()=>{
  const json=JSON.stringify({
    className:'月光',meta:{date:'2020-10-10'},
    blocks:[{type:'paragraph',content:[{type:'text',text:'月亮照著河流'}]}]
  });
  assert.equal(content_filter(json),'月亮照著河流');
});

test('Title and filtered body both enter the same classifier',()=>{
  const catalog=[{
    item_no:1,item_name:'銀河',class_group:'宇宙',
    keywords:['月光','日期'],order_no:1,class_enable:true
  }];
  const classify=createKeywordDocumentClassifier(catalog,{
    collectKeywordTerms:true,selectedTerms:new Set(['月光','日期'])
  });
  const rows=[
    {uid:'ARTICLE1',title:'月光之夜',content:'<div class="date">只是夜景</div>'},
    {uid:'ARTICLE2',title:'其他',content:'日期：2017-10-31\n=====\n銀河之外'},
    {uid:'ARTICLE3',title:'其他',content:'<p class="月光">星海</p>'},
    {uid:'ARTICLE4',title:'其他',content:'<div>月光</div>'}
  ];
  const results=classify(rows).classifications.map(row=>row.matched_terms);
  assert.deepEqual(results[0],['月光']);
  assert.deepEqual(results[1],[]);
  assert.deepEqual(results[2],[]);
  assert.deepEqual(results[3],['月光']);
  assert.ok(keywordScanText(rows[0]).startsWith('月光之夜\n'));
});

test('Class-level whole-document exclusions are validated; discovery applies them',()=>{
  assert.deepEqual(classSkipArticleWords({exceptions:{skip_article:['廣告','廣告','測試']}}),
    ['廣告','測試']);
  assert.throws(()=>classSkipArticleWords({exceptions:{skip_article:[42]}}));
  const discovery=createNewKeywordDiscovery([],{exceptionWords:['廣告']});
  const progress=discovery.consume([
    {uid:'ARTICLE1',title:'廣告活動',content:'銀色河流'},
    {uid:'ARTICLE2',title:'自然',content:'銀色河流與月光'}
  ]);
  assert.equal(progress.read,2);
  assert.equal(progress.withContent,1);
});
