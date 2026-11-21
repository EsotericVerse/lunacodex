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
test('MediaAnchor append retains existing links under a row lock',()=>{
  const src=file('../app/loc/providers/kysely-management.mjs');
  const begin=src.indexOf("if(operation==='append_media_link'){");
  const end=src.indexOf("  // Authorized writes now share",begin);
  assert.ok(begin>0&&end>begin);
  const block=src.slice(begin,end);
  assert.match(src,/await authorizeRelation\(trx,table,operation,values,filters,rows\)/);
  assert.match(block,/forUpdate\(\)\.executeTakeFirst\(\)/);
  assert.match(block,/const next=\[\.\.\.new Set\(\[\.\.\.prior\.map\(String\),values\.media_uid\]\)\]/);
  assert.match(block,/ANCHOR_TYPE_GROUPS\.media/);
  assert.match(block,/numUpdatedRows/);
});
test('Only the website can request a media link append in the managed SQL envelope',()=>{
  const native=file('../app/loc/mcp/native-operations.mjs');
  assert.match(native,/selected\.engine!=='postgres'\|\|host!==WEB_HOST/);
  assert.match(native,/'append_media_link'\]\.includes\(entry\.p_operation\)/);
});
