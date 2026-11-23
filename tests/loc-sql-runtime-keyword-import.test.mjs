import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {matchExistingImportBySiteId,matchExistingImportByCreatedAt}
  from '../app/loc/import/duplicate-check.mjs';

const STAMP='2026-11-20T02:12:00.123Z';
const incoming=(uid,createtime=STAMP,more={})=>({
  uid,site:'Threads',createtime,...more
});

test('SQL candidate reader receives only requested site IDs and retains ambiguous matches',async()=>{
  const requested=[incoming('IN000001',STAMP,{site_id:'post-1'})];
  const seen=[];
  const result=await matchExistingImportBySiteId(requested,{
    readSiteIds:async(ids,consume,site)=>{
      seen.push({ids,site});
      consume([
        incoming('SV000001',STAMP,{site_id:'post-1'}),
        incoming('SV000002',STAMP,{site_id:'post-1'})
      ]);
    }
  });
  assert.deepEqual(seen,[{ids:['post-1'],site:'Threads'}]);
  assert.equal(result.size,0);
  assert.equal(result.ambiguous.length,1);
  assert.deepEqual(result.ambiguous[0].saved_uids,['SV000001','SV000002']);
});

test('source-time lookup receives bounded original millisecond instants, not date scans',async()=>{
  const rows=[
    incoming('IN000001','2026-11-20T02:12:00.123001Z'),
    incoming('IN000002','2026-11-20T02:12:00.123999Z'),
    incoming('IN000003','2026-11-20T02:12:00.124001Z'),
    incoming('IN000004',STAMP,{__importTimeSource:'update'})
  ];
  const called=[];
  const result=await matchExistingImportByCreatedAt(rows,{
    readSourceRows:async({site,instants,consumePage})=>{
      called.push({site,instants});
      consumePage([]);
    }
  });
  assert.deepEqual(called,[{site:'Threads',instants:[
    '2026-11-20T02:12:00.123Z','2026-11-20T02:12:00.124Z'
  ]}]);
  assert.equal(result.size,0);
});

test('source creation-time collision still matches only the unique saved microsecond candidate',async()=>{
  const result=await matchExistingImportByCreatedAt([incoming('IN000001')],{
    readSourceRows:async({instants,consumePage})=>{
      assert.deepEqual(instants,[STAMP]);
      consumePage([incoming('SV000001','2026-11-20T02:12:00.123045Z')]);
    }
  });
  assert.equal(result.get('IN000001')?.uid,'SV000001');
});

test('Keyword SQL writer updates only cached totals and keeps Item rules outside SQL',async()=>{
  const src=await readFile(new URL('../app/loc/keywords/sql-service.mjs',import.meta.url),'utf8');
  assert.match(src,/jsonb_to_recordset/);
  assert.match(src,/set attr=jsonb_set/);
  assert.match(src,/where a\.uid=incoming\.uid::char\(8\) and a\.type in \('item','group'\)/);
  assert.match(src,/await writeKeywordTotals\(trx,scope,updates\)/);
  assert.match(src,/await writeKeywordTotals\(trx,scope,ids\.map/);
  assert.doesNotMatch(src,/set num=/);
});

test('Native import candidate queries are fixed, scoped and not generic SQL',async()=>{
  const src=await readFile(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const client=await readFile(new URL('../app/loc/providers/configured.mjs',import.meta.url),'utf8');
  assert.match(src,/import_site_id_candidates/);
  assert.match(src,/import_created_at_candidates/);
  assert.match(src,/canLocAccess\(trx,'scope',scope\)/);
  assert.match(src,/where\(sql`lower\(\$\{sql\.ref\('site'\)\}\)`/);
  assert.match(src,/eb\('createtime','>='/);
  assert.match(client,/import_site_id_candidates','import_created_at_candidates'/);
});
