import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  const end=src.indexOf("  // Authorized writes now share",begin);
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
  assert.match(native,/'append_media_link'\]\.includes\(entry\.p_operation\)/);
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
test('Point merge does not scan Galaxy timestamps or recreate attr.times',()=>{
  const src=file('../app/loc/providers/kysely-management.mjs');
  const begin=src.indexOf('async function mergeScopePoints(');
  const end=src.indexOf('async function importSharedKeywordClass(',begin);
  assert.ok(begin>=0&&end>begin);
  const block=src.slice(begin,end);
  assert.doesNotMatch(block,/mergedTimes|jsonb_agg\(t\.ts|attr->'times'/);
  assert.match(block,/coalesce\(attr,'\{\}'::jsonb\)-'times'/);
});
