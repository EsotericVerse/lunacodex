import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalBlockNoteHtml} from '../app/loc/editor/blocknote-content.mjs';

test('LOC stored HTML retains semantics without editor-specific attributes',()=>{
  const source='<h2 data-level="2">標題</h2><ol data-start="4"><li><p class="bn-inline-content">第四項</p></li></ol>'+
    '<p><a href="/search/" target="_blank" rel="noopener" classname="bn-inline-content-section" data-inline-content-type="link">搜尋</a></p>';
  assert.equal(canonicalBlockNoteHtml(source),
    '<h2>標題</h2><ol data-start="4"><li><p>第四項</p></li></ol>'+
    '<p><a href="/search/" target="_blank" rel="noopener">搜尋</a></p>');
});

test('LOC keeps images, attributes with meaning, and blank paragraphs',()=>{
  const source='<img src="/pics/a.webp" alt="圖片" width="480" data-url="/pics/a.webp" data-name="圖片" data-preview-width="480">'+
    '<p>\uFFFC</p><img data-url="/pics/unresolved.webp">';
  assert.equal(canonicalBlockNoteHtml(source),
    '<img src="/pics/a.webp" alt="圖片" width="480">'+
    '<p><br></p><img data-url="/pics/unresolved.webp">');
});
