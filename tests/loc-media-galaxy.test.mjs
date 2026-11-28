import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaGalaxyRow,publicMediaUrl} from '../app/loc/media/media-galaxy.mjs';
import {prepareManagedKyselyWrite} from '../app/loc/providers/kysely-management.mjs';

test('media works store source in Galaxy.site and description in content',()=>{
  const row=mediaGalaxyRow({uid:'AbCd1234',site:'Suno',
    url:'https://suno.com/song/example',description:'詞曲創作'});
  assert.equal(row.site,'Suno');
  assert.equal(row.url,'https://suno.com/song/example');
  assert.equal(row.content,'詞曲創作');
  assert.equal(Object.hasOwn(row,'type'),false);
  assert.equal(publicMediaUrl('javascript:alert(1)'),'');
  assert.throws(()=>mediaGalaxyRow({uid:'AbCd1234',type:'image',site:'web',
    url:'https://user:password@example.com/a.png'}),/有效公開網址/);
  assert.throws(()=>mediaGalaxyRow({uid:'AbCd1234',type:'image',site:'mcp',
    url:'https://example.com/a.png'}),/site=mcp/);
});

test('media link accepts a public URL and rejects legacy Lucus UID input',()=>{
  const table='silver.lo3rwang_galaxy';
  const plan=prepareManagedKyselyWrite({payload:{p_table:table,
    p_operation:'append_media_link',p_values:{article_uid:'AbCd1234',url:'https://example.com/a.png'}}});
  assert.equal(plan.values.url,'https://example.com/a.png');
  assert.throws(()=>prepareManagedKyselyWrite({payload:{p_table:table,
    p_operation:'append_media_link',p_values:{article_uid:'AbCd1234',media_uid:'EfGh5678'}}}),/Invalid LOC media URL/);
});
