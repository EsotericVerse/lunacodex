import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendSunoMetaTagsToArticle,refreshSunoStyleMetaTags}
  from '../app/loc/media/suno-style-meta-tags.mjs';

test('Suno Meta Tags are an explicit non-lyric section in Galaxy.content',()=>{
  const tags=refreshSunoStyleMetaTags('Mandopop, Male Baritone, Air Compression');
  const lyrics='<p>第一段歌詞</p><p>第二段歌詞</p>';
  const result=appendSunoMetaTagsToArticle(lyrics,tags);
  assert.ok(result.startsWith(lyrics));
  assert.match(result,/編曲版本說明｜非歌詞/);
  assert.match(result,/Meta Tags：Mandopop, Male Baritone, Air Compression/);
  assert.equal(appendSunoMetaTagsToArticle(result,tags),result,
    'a re-render must not duplicate the note');
});

test('plain-text song body stays text and does not write empty notes',()=>{
  assert.equal(appendSunoMetaTagsToArticle('歌詞',''),'歌詞');
  assert.equal(appendSunoMetaTagsToArticle('歌詞','Lo-fi'),
    '歌詞\n\n編曲版本說明｜非歌詞\nMeta Tags：Lo-fi');
});

test('HTML song note escapes manually entered text instead of injecting markup',()=>{
  const body='<p>Original lyrics</p>';
  const result=appendSunoMetaTagsToArticle(body,'Pop <script>alert(1)</script> & Rock');
  assert.ok(result.startsWith(body));
  assert.ok(result.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!result.includes('<script>'));
  assert.ok(result.includes('&amp; Rock'));
});

test('Suno publisher persists the note in lyrics content, not a Galaxy meta_tags field',()=>{
  const source=readFileSync(
    new URL('../app/loc/media/SunoImportPanel.jsx',import.meta.url),'utf8');
  assert.match(source,/content:appendSunoMetaTagsToArticle\(lyrics,description\)/);
  assert.doesNotMatch(source,/\bmeta_tags\s*:/);
});
