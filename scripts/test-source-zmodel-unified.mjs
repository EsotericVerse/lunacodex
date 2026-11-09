import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTaxonomyFromArrays} from '../app/loc/source-classification.mjs';
import {publishedSourceTaxonomy} from '../app/modular/published-source-taxonomy.js';
test('LOC ArticleTag and Others are one universal catalogue',()=>{
 const t=sourceTaxonomyFromArrays(['Facebook','Threads','Instagram']);
 assert.deepEqual(t.categories.map(row=>row.display_name),['Facebook','Threads','Instagram','Others']);
 assert.deepEqual(t.tree,[]);
 assert.deepEqual(publishedSourceTaxonomy('lo3rwang'),publishedSourceTaxonomy('lrunes'));
});
