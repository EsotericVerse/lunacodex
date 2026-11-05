import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toAnchorRow,fromAnchorRow,unifiedAnchorSpec} from '../app/loc/unified-anchor-compat.mjs';
import {normalizeImportMedia} from '../app/loc/import-batch.mjs';
import {importCheckinDayEntries} from '../app/loc/import-time-anchors.mjs';

const spec=unifiedAnchorSpec('silver','lo3rwang_galaxy_media');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Anchor retains UID and source createtime independently of cultural date',()=>{
  const row=toAnchorRow(spec,{
    uid:'Aa11Bb22',type:'image',title:'Media',url:'https://example.org/a.png',
    createtime:'2026-11-04T01:23:45Z'
  });
  assert.equal(row.uid,'Aa11Bb22');
  assert.equal(row.createtime,'2026-11-04T01:23:45Z');
  assert.equal(row.attr.url,'https://example.org/a.png');
  assert.ok(!('date' in row.attr));
  const recovered=fromAnchorRow(spec,{...row,attr:{...row.attr,date:'1980-06-23'}});
  assert.equal(recovered.createtime,'2026-11-04T01:23:45Z');
  assert.notEqual(recovered.createtime,recovered.url);
  assert.notEqual(recovered.createtime,'1980-06-23');
});

test('Multiple images from one article may share the exact same creation time',()=>{
  const at='2026-11-05T01:02:03Z';
  const a=toAnchorRow(spec,{uid:'Aa11Bb22',type:'image',createtime:at});
  const b=toAnchorRow(spec,{uid:'Cc33Dd44',type:'image',createtime:at});
  assert.notEqual(a.uid,b.uid);
  assert.equal(a.createtime,b.createtime);
});

test('Imported media creation reference follows Galaxy article time, not photo EXIF time',()=>{
  const normalized=normalizeImportMedia([{
    url:'https://example.org/a.png',media_type:'image',
    created_at:'2019-03-15T03:00:00Z',title:'Image'
  }],{article_uid:'Aa11Bb22',createtime:'2026-11-05T03:04:05Z'});
  assert.equal(normalized.records.length,1);
  assert.equal(normalized.records[0].createtime,'2026-11-05T03:04:05.000Z');
});

test('Time import uses cultural date for attr.date but original article instant for createtime',()=>{
  const entries=importCheckinDayEntries([{
    location:'Sample place',title:'Article',
    date:'1980-06-23',createtime:'2026-11-05T03:04:05Z'
  }]);
  assert.equal(entries.length,1);
  assert.equal(entries[0].date,'1980-06-23');
  assert.equal(entries[0].createtime,'2026-11-05T03:04:05.000Z');
});

test('Schema is additive and comparison reads true physical Anchor createtime',()=>{
  const src=read('app/loc/unified-anchor-compat.mjs');
  const schema=read('app/loc/providers/kysely-schema.mjs');
  const native=read('app/loc/providers/kysely-anchor.mjs');
  assert.match(src,/const physicalColumns=\[[^\n]*'createtime'/);
  assert.match(src,/out\.createtime=row\.createtime|\['uid','title','invisible','description','createtime'\]/);
  assert.doesNotMatch(src,/out\.createtime=attr\.date/);
  assert.match(schema,/addColumn\('createtime',dateTimeType/);
  assert.match(native,/Anchor createtime must be a full timestamp with timezone/);
});
