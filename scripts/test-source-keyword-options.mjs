import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceKeywordOptions} from '../app/loc/source-keyword-options.mjs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
test('Source options use only fixed LOC ArticleTag and Others',()=>{
 const a=sourceKeywordOptions(publishedSourceTaxonomy('loc'));
 assert.deepEqual(a.map(x=>x.label),['Facebook','Threads','Instagram','Others']);
 assert.deepEqual(a,sourceKeywordOptions(publishedSourceTaxonomy('lo3rwang')));
});
