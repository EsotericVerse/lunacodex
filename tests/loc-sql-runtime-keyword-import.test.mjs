import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {matchExistingImportBySiteId,matchExistingImportByCreatedAt}
  from '../app/loc/import/duplicate-check.mjs';
import {planKeywordTotalWrites} from '../app/loc/keywords/sql-service.mjs';

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
  assert.match(src,/where a\.uid=incoming\.uid::char\(8\) and a\.type in \('item','group','pattern'\)/);
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

test('occupied-time import lookup is exact-second, website-only and scope-bounded',async()=>{
  const backend=await readFile(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const panel=await readFile(new URL('../app/loc/import/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const guard=await readFile(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  assert.match(backend,/import_occupied_createtimes/);
  assert.match(backend,/ms%1000!==0/);
  assert.match(backend,/withinImportInstants\(/);
  assert.match(backend,/seconds,1000,/);
  assert.match(backend,/return readImportCandidatePage\(/);
  assert.match(panel,/action:'import_occupied_createtimes'/);
  assert.match(panel,/new Date\(Math\.floor\(instant\/1000\)\*1000\)\.toISOString\(\)/);
  assert.match(guard,/import_occupied_createtimes/);
});

test('Kysely import conveniences preserve fixed authorization and pagination',async()=>{
  const backend=await readFile(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  assert.match(backend,/async function authorizedImportGalaxy\(trx,scope\)/);
  assert.match(backend,/async function readImportCandidatePage\(query,table,columns,/);
  assert.match(backend,/\.orderBy\('uid','asc'\)\.limit\(limit\+1\)/);
  assert.match(backend,/assertZModelSelectRows\(table,columns,rows\)/);
  assert.match(backend,/return readImportCandidatePage\(query,table,columns,\{after,limit\}\)/);
  assert.match(backend,/wholeSeconds&&ms%1000!==0/);
  assert.doesNotMatch(backend,/eval\(/);
});

test('keyword aggregate writes normalize repeated physical Item UIDs',()=>{
  const rows=planKeywordTotalWrites([
    {uid:'ITEM0001',total:7},{uid:'GROUP001',total:10},
    {uid:'ITEM0001',total:7}
  ]);
  assert.deepEqual(rows,[
    {uid:'ITEM0001',total:7},{uid:'GROUP001',total:10}
  ]);
  assert.deepEqual(planKeywordTotalWrites([]),[]);
  assert.deepEqual(planKeywordTotalWrites([
    {uid:'PATT0001',total:42},{uid:'PATT0001',total:42}
  ]),[{uid:'PATT0001',total:42}]);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'ITEM0001',total:7},{uid:'ITEM0001',total:8}
  ]),/Conflicting Keyword counts/);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'INVALID_UID',total:8}
  ]),/Invalid Keyword aggregate counts/);
  assert.throws(()=>planKeywordTotalWrites([
    {uid:'ITEM0001',total:1.2}
  ]),/Invalid Keyword aggregate counts/);
});

test('SQL import candidate reader adapts keyset pages without relaxing server limits',async()=>{
  const panel=await readFile(new URL('../app/loc/import/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const backend=await readFile(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  assert.match(panel,/const pages=createTextAdaptiveRows\(\{initial:60,maximum:100,/);
  assert.match(panel,/const pageSize=pages.size/);
  assert.match(panel,/pages.observe\(rows.length,encoder.encode\(JSON.stringify\(rows\)\).byteLength\)/);
  assert.match(panel,/end-offset<80/);
  assert.match(panel,/bytes\+1\+length>16\*1024/);
  assert.match(backend,/p_limit:z.number\(\).int\(\).min\(1\).max\(100\).default\(60\)/);
  assert.match(backend,/p_site_ids:z.array\(.+\).min\(1\).max\(80\)/);
  assert.match(backend,/p_seconds:z.array\(.+\).min\(1\).max\(80\)/);
});

test('one authorized final Keyword transaction writes Pattern attr.total with Item/Group',async()=>{
  const service=await readFile(new URL('../app/loc/keywords/sql-service.mjs',import.meta.url),'utf8');
  assert.match(service,/a\.type in \('item','group','pattern'\)/);
  assert.match(service,/total:Math\.max\(0,Number\(counts\.patternCounts\?\.\[pattern\.uid\]\)/);
  assert.match(service,/const \{itemCounts,groupCounts,patternCounts,\.\.\.smallCounts\}=counts/);
  assert.match(service,/await writeKeywordTotals\(trx,scope,updates\)/);
  assert.doesNotMatch(service,/set\s+num\s*=/);
});
