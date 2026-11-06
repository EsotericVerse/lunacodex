import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceKeywordOptions} from '../app/loc/source-keyword-options.mjs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';

test('Source option group uses the published Scope Anchor labels and immutable site codes',()=>{
  const options=sourceKeywordOptions(publishedSourceTaxonomy('lo3rwang'));
  assert.ok(options.some(item=>item.key==='system:facebook'&&item.code==='facebook'));
  assert.ok(options.some(item=>item.key==='custom:vocus'
    &&item.code==='vocus'&&item.label==='方格子vocus'));
  assert.ok(options.some(item=>item.key==='custom:others'&&item.label==='其他'));
  assert.equal(options.some(item=>item.key==='custom:lrunes'),false);
  assert.equal(new Set(options.map(item=>item.code)).size,options.length);
});

test('Sibling Scopes have isolated Source option groups',()=>{
  const own=sourceKeywordOptions(publishedSourceTaxonomy('lrunes'));
  assert.ok(own.some(item=>item.key==='custom:vocus'));
  assert.equal(own.some(item=>item.code==='kkcity'),false);
  assert.deepEqual(sourceKeywordOptions(null),[]);
  assert.deepEqual(sourceKeywordOptions({categories:[{category_code:'fb',display_name:'FB',enabled:false}]}),[]);
});

test('Culture and Statistics render a second Source group without mapping From to Keyword Class',()=>{
  const culture=readFileSync(new URL('../app/modular/features/Culture.jsx',import.meta.url),'utf8');
  const statistics=readFileSync(new URL('../app/modular/features/Statistics.jsx',import.meta.url),'utf8');
  for(const code of [culture,statistics]){
    assert.match(code,/sourceKeywordOptions/);
    assert.match(code,/<optgroup label=['"]關鍵詞['"]>/);
    assert.match(code,/<optgroup label=['"]來源['"]>/);
  }
  assert.match(culture,/setStyleFilter\('none'\)/);
  assert.match(culture,/setSelectedRiverGroup\(choice\.key\)/);
  assert.doesNotMatch(culture,/keywordOptionsScope/);
  assert.match(statistics,/rankingType=choice\?'source':value/);
  assert.match(statistics,/navigation\.source/);
  assert.match(statistics,/selectedSource=\{activeSourceSelection\}/);
});
