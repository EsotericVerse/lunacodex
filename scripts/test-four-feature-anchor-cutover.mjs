import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unifiedAnchorSpec,fromAnchorRow} from '../app/loc/unified-anchor-compat.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('four legacy relation aliases resolve to physical Anchor for both scopes',()=>{
  for(const scope of ['lo3rwang','lrunes'])for(const suffix of ['time','trace','keywords','galaxy_media'])
    assert.equal(unifiedAnchorSpec('silver',scope+'_'+suffix)?.table,scope+'_anchor');
});

test('media legacy date is projected from typed attr.date, not a removed column',()=>{
  const media=fromAnchorRow({kind:'media',legacy:'galaxy_media'},
    {uid:'Ab12Cd34',type:'suno',title:'Sample',attr:{date:'2026-11-04',url:'https://suno.com/song/test'}});
  assert.equal(media.createtime,'2026-11-04');
  assert.equal(media.url,'https://suno.com/song/test');
});

test('article-place context accepts eight-character case-sensitive UID',()=>{
  const source=read('app/loc/galaxy-query.js');
  assert.ok(source.includes('if(!/^[A-Za-z0-9]{8}$/.test(placeId)'));
  assert.ok(source.includes('uidFastPath&&!browse&&/^[A-Za-z0-9]{8}$/.test'));
});

test('Trace and Keyword direct readers select physical Galaxy permission columns',()=>{
  const trace=read('app/modular/features/trace/TracePlaceResults.jsx');
  const keyword=read('app/loc/keyword-analysis.js');
  assert.ok(trace.includes("columns:'uid,date,place_id,trace'"));
  assert.ok(keyword.includes("const articleColumns='uid,date,createtime,content,keyword';"));
});
