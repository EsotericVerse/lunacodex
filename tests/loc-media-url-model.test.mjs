import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GALAXY_READ_MODEL_FIELDS} from '../packages/zenstack/galaxy-read-models.mjs';
import {galaxyInterNetEdges} from '../packages/zenstack/galaxy-inter-net.mjs';
import {appendSunoMetaTagsToArticle} from '../app/loc/media/suno-style-meta-tags.mjs';
import {refreshSunoStyleMetaTags} from '../app/loc/media/suno-style-meta-tags.mjs';

{
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Media URL links never become typed Anchor UID ZModel relationships',()=>{
  assert.equal(Object.hasOwn(GALAXY_READ_MODEL_FIELDS.GalaxyUidAnchor,'media_link'),false);
  assert.equal(Object.hasOwn(GALAXY_READ_MODEL_FIELDS.GalaxyUidRead,'media_link'),false);
  const zmodel=source('packages/zenstack/schema.zmodel');
  const begin=zmodel.indexOf('type GalaxyUidAnchor {');
  const end=zmodel.indexOf('type GalaxyList {',begin);
  assert.ok(begin>=0&&end>begin);
  assert.doesNotMatch(zmodel.slice(begin,end),/media_link/);
});

test('Galaxy media link URLs are directly exposed as URLs',()=>{
  const link='https://suno.com/song/12345678';
  const row={uid:'ABCD1234',title:'Article',media_link:[link,'ABCDEFGH']};
  const graph=galaxyInterNetEdges(row);
  assert.equal(graph.branches.media.length,1);
  assert.deepEqual(graph.branches.media.map(edge=>({value:edge.value,kind:edge.kind})),
    [{value:link,kind:'url'}]);
});

test('Article detail explicitly selects the plain physical URL array',()=>{
  const gallery=source('app/loc/galaxy/galaxy-query.js');
  assert.match(gallery,/galaxyUidReadWithPolicyColumns=\(\)=>unique\(\[/);
  assert.match(gallery,/media_link'\s*\]\)/);
  const trace=source('app/modular/features/trace/TracePlaceResults.jsx');
  assert.match(trace,/row\.attr\?\.url/);
  assert.match(trace,/mediaUrls,result:'articles'/);
  const feature=source('app/loc/model/galaxy-feature-transactions.mjs');
  assert.match(feature,/where\('media_link','&&',model\.mediaUrls\)/);
  assert.doesNotMatch(trace,/operator:'overlaps',value:mediaIds/);
});
}

{
const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Media Publisher does not read or overwrite a stale media_link snapshot',()=>{
  const src=file('../app/loc/media/ManagementMediaPublisher.jsx');
  assert.doesNotMatch(src,/selectRows\(/);
  assert.doesNotMatch(src,/const prior=Array\.isArray\(article\.media_link\)/);
  assert.match(src,/p_operation:'append_media_link'/);
  assert.match(src,/article_uid:galaxyLink,media_uid:mediaUid/);
  assert.match(src,/await transactionWrites\(plan\.operations\)/);
});
test('MediaAnchor append retains existing URL links under a row lock',()=>{
  const src=file('../app/loc/providers/kysely-management.mjs');
  const begin=src.indexOf("if(operation==='append_media_link'){");
  const end=src.indexOf("  if(isAnchor&&operation==='update'){",begin);
  assert.ok(begin>0&&end>begin);
  const block=src.slice(begin,end);
  assert.match(src,/await authorizeRelation\(trx,table,operation,values,filters,rows\)/);
  assert.match(block,/forUpdate\(\)\.executeTakeFirst\(\)/);
  assert.match(block,/const url=String\(linked\.attr\?\.url\|\|''\)\.trim\(\)/);
  assert.match(block,/const next=\[\.\.\.prior,url\]/);
  assert.match(block,/url===String\(article\.url\|\|''\)\.trim\(\)/);
  assert.doesNotMatch(block,/media_link:\[values\.media_uid\]/);
  assert.match(block,/ANCHOR_TYPE_GROUPS\.media/);
  assert.match(block,/numUpdatedRows/);
});
test('Only the website can request a media link append in the managed SQL envelope',()=>{
  const native=file('../app/loc/mcp/native-operations.mjs');
  assert.match(native,/selected\.engine!=='postgres'\|\|host!==WEB_HOST/);
  assert.match(native,/'append_media_link'\]\.includes\(item\.p_operation\)/);
});

test('Suno keeps its public permalink only in Galaxy.url',()=>{
  const src=file('../app/loc/media/SunoImportPanel.jsx');
  assert.match(src,/url:draft\.url\.trim\(\)\|\|null/);
  assert.doesNotMatch(src,/media_link:\[draft\.url\.trim\(\)\]/);
  assert.doesNotMatch(src,/media_link:\[mediaUid\]/);
});

test('all Galaxy media_link writes require actual URLs, not Anchor UIDs',()=>{
  const native=file('../app/loc/providers/kysely-management.mjs');
  assert.match(native,/function validateGalaxyMediaLinks\(/);
  assert.match(native,/validateGalaxyMediaLinks\(table,operation/);
  assert.match(native,/Galaxy\.media_link only accepts public HTTP\(S\) URLs/);
  const importer=file('../app/loc/import/ManagementImportPanel.jsx');
  assert.match(importer,/planImportMediaUrlLinks\(/);
  assert.doesNotMatch(importer,/planImportMediaUidLinks\(/);
  const reader=file('../app/loc/galaxy/galaxy-query.js');
  assert.match(reader,/function mediaUrlsOf\(/);
  assert.doesNotMatch(reader,/mediaRowsFor\(/);
});
}

{
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
}
