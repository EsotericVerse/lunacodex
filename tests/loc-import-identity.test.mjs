import {remapImportUidRelations} from '../app/loc/import/uid-delta.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dedupeIncomingImport,matchExistingImportByCreatedAt,matchExistingImportBySiteId} from '../app/loc/import/duplicate-check.mjs';
import {finalizeImportCreatedTimes,importTimeMicroseconds} from '../app/loc/import/unique-createtime.mjs';
import {extractImportUpdatedAt} from '../app/loc/import/batch.mjs';
import {importWithinTimeRange} from '../app/loc/import/time-range.mjs';

test('source creation time, not new Galaxy UID or different text, identifies same article',()=>{
  const make=(uid,content,createtime='2026-11-20T00:00:00.000Z',more={})=>({
    uid,site:'Threads',createtime,title:'測試',content,...more
  });
  const {unique,duplicates,aliases}=dedupeIncomingImport([
    make('GALA0001','先前內容'),
    make('GALA0002','後來修改的內容'),
    make('GALA0003','另一天', '2026-11-21T00:00:00Z')
  ]);
  assert.equal(duplicates,1);
  assert.deepEqual(unique.map(row=>row.uid),['GALA0001','GALA0003']);
  assert.equal(aliases.get('GALA0002'),'GALA0001');
  // UpdateTime is a fallback, not evidence that unrelated posts are equal.
  const fallback=dedupeIncomingImport([
    make('GALA0004','甲', '2026-11-20T00:00:00Z',{__importTimeSource:'update'}),
    make('GALA0005','乙', '2026-11-20T00:00:00Z',{__importTimeSource:'update'})
  ]);
  assert.equal(fallback.unique.length,2);
});

test('site plus genuine createtime matches existing article without comparing text',async()=>{
  const stamp='2026-11-20T02:12:00.000Z';
  const make=(uid,content,createtime=stamp,more={})=>({
    uid,site:'Threads',site_id:null,createtime,
    title:'今日紀錄',content,url:'https://example.com/post',...more
  });
  const incoming=[
    make('INPUT001','重新修改過的文字'),
    make('INPUT002','新篇','2026-11-20T02:12:01.000Z'),
    make('INPUT003','沒有原始日期',stamp,{__importTimeSource:'update'})
  ];
  const saved=[
    make('SAVED001','舊內容',stamp,{title:'舊標題'}),
    make('SAVED002','另一篇','2026-11-20T02:12:03.000Z')
  ];
  const matches=await matchExistingImportByCreatedAt(incoming,{
    readSourceRows:async({consumePage})=>consumePage(saved)
  });
  assert.equal(matches.get('INPUT001')?.uid,'SAVED001');
  assert.equal(matches.has('INPUT002'),false);
  assert.equal(matches.has('INPUT003'),false);
});

test('same site and time with two legacy saved rows remains ambiguous',async()=>{
  const imported=[{uid:'INPUT001',site:'Threads',createtime:'2026-11-20T02:12:00Z'}];
  const stored=[
    {uid:'SAVED001',site:'Threads',createtime:'2026-11-20T02:12:00Z'},
    {uid:'SAVED002',site:'Threads',createtime:'2026-11-20T02:12:00Z'}
  ];
  const matches=await matchExistingImportByCreatedAt(imported,{
    readSourceRows:async({consumePage})=>consumePage(stored)
  });
  assert.equal(matches.has('INPUT001'),false);
  assert.deepEqual(matches.ambiguous.map(row=>row.uid),['INPUT001']);
});

test('final import timestamps use unique PostgreSQL microseconds, not same UpdateTime',()=>{
  const original='2026-11-20T02:12:00.123Z';
  const records=[
    {uid:'INPUT001',createtime:original,__importTimeSource:'creation'},
    {uid:'INPUT002',createtime:original,__importTimeSource:'update'},
    {uid:'INPUT003',createtime:original,__importTimeSource:'update'},
    {uid:'INPUT004',createtime:null,__importTimeSource:'missing'}
  ];
  const rows=finalizeImportCreatedTimes(records,{
    occupiedTimes:[original,'2026-11-20T02:12:00.123001Z'],
    fallbackTime:original
  });
  const times=rows.map(row=>row.createtime);
  assert.equal(new Set(times).size,4);
  assert.ok(times.every(time=>/\.123\d{3}Z$/.test(time)));
  assert.ok(rows.every(row=>row.date==='2026-11-20'));
  assert.ok(rows.every(row=>!Object.hasOwn(row,'__importTimeSource')));
  assert.equal(importTimeMicroseconds(times[0])!==importTimeMicroseconds(times[1]),true);
});

test('missing createtime uses source update time; wholly undated rows reach finalization',()=>{
  const source={UpdateTime:'2026-11-18T03:02:01Z'};
  assert.equal(extractImportUpdatedAt(source),'2026-11-18T03:02:01.000Z');
  const missing={createtime:null,__importTimeSource:'missing'};
  const window={start:'2026-11-01T00:00:00Z',end:'2026-11-21T00:00:00Z'};
  assert.equal(importWithinTimeRange(missing,window),true);
  const [row]=finalizeImportCreatedTimes([{uid:'INPUT001',...missing}],{
    fallbackTime:'2026-11-20T02:12:00Z'
  });
  assert.equal(row.createtime,'2026-11-20T02:12:00.000000Z');
});

test('precise source microseconds remain separate even within one millisecond',()=>{
  const make=(uid,createtime)=>({
    uid,site:'Threads',createtime,title:'不同篇',content:'文字'
  });
  const result=dedupeIncomingImport([
    make('SOURCE01','2026-11-20T02:12:00.123001Z'),
    make('SOURCE02','2026-11-20T02:12:00.123002Z')
  ]);
  assert.equal(result.unique.length,2);
});

test('a bumped saved microsecond reimport matches only one original millisecond candidate',async()=>{
  const incoming=[{
    uid:'INPUT001',site:'Threads',createtime:'2026-11-20T02:12:00.123Z'
  }];
  const bumped=[{
    uid:'SAVED001',site:'Threads',createtime:'2026-11-20T02:12:00.123002Z'
  }];
  const matches=await matchExistingImportByCreatedAt(incoming,{
    readSourceRows:async({consumePage})=>consumePage(bumped)
  });
  assert.equal(matches.get('INPUT001')?.uid,'SAVED001');
  const ambiguous=await matchExistingImportByCreatedAt(incoming,{
    readSourceRows:async({consumePage})=>consumePage([
      ...bumped,{uid:'SAVED002',site:'Threads',
        createtime:'2026-11-20T02:12:00.123003Z'}
    ])
  });
  assert.equal(ambiguous.has('INPUT001'),false);
  assert.equal(ambiguous.ambiguous.length,1);
});

test('large same-UpdateTime batches allocate unique microseconds without repeated scans',()=>{
  const original='2026-11-20T02:12:00.123Z';
  const rows=Array.from({length:2000},(_,i)=>({
    uid:String(i).padStart(8,'0'),createtime:original,
    __importTimeSource:'update'
  }));
  const allocated=finalizeImportCreatedTimes(rows,{
    fallbackTime:original,occupiedTimes:[original]
  });
  assert.equal(new Set(allocated.map(row=>row.createtime)).size,rows.length);
  assert.ok(allocated.every(row=>row.date==='2026-11-20'));
});

test('existing Galaxy UID already claimed by source ID is not matched twice by timestamp',async()=>{
  const row={uid:'INPU0001',site:'Threads',createtime:'2026-11-20T02:12:00Z'};
  const saved={uid:'SAVE0001',site:'Threads',createtime:row.createtime};
  const matches=await matchExistingImportByCreatedAt([row],{
    excludeSavedUids:new Set(['SAVE0001']),
    readSourceRows:async({consumePage})=>consumePage([saved])
  });
  assert.equal(matches.size,0);
  assert.deepEqual(matches.ambiguous,[]);
});

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

test('Import candidate reads are fixed, scope-authorized and UID-paginated',async()=>{
  const backend=await readFile(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const routes=await readFile(new URL('../app/loc/actions/managed-query-routes.mjs',import.meta.url),'utf8');
  assert.match(routes,/import_site_id_candidates','import_created_at_candidates'/);
  assert.match(backend,/canLocAccess\(trx,'scope',scope\)/);
  assert.match(backend,/\.orderBy\('uid','asc'\)\.limit\(limit\+1\)/);
  assert.match(backend,/assertZModelSelectRows\(table,columns,rows\)/);
  assert.match(backend,/wholeSeconds&&ms%1000!==0/);
});

test('occupied-time import lookup stays paged, Scope-authorized and exact-time matched',async()=>{
  const queries=await readFile(new URL('../app/loc/actions/import/queries.mjs',import.meta.url),'utf8');
  const panel=await readFile(new URL('../app/loc/import/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const matcher=await readFile(new URL('../app/loc/import/duplicate-check.mjs',import.meta.url),'utf8');
  assert.match(queries,/export async function queryImportOccupiedDatePage/);
  assert.match(queries,/stringList\(args\.p_dates,\{max:40,length:10\}\)/);
  assert.match(queries,/withImportScope\(args,async\(db,_args,port\)=>/);
  assert.match(queries,/\.where\('date','in',days\)/);
  assert.match(queries,/\.orderBy\('date','asc'\)\.orderBy\('uid','asc'\)/);
  assert.ok(queries.includes("assertZModelSelectRows('silver.'+scopeTableName(scope,'galaxy')"));
  assert.match(panel,/queryImportOccupiedDatePage\(/);
  assert.match(panel,/new Date\(Math\.floor\(instant\/1000\)\*1000\)\.toISOString\(\)/);
  assert.match(matcher,/const key=importTimeKey\(row\),milli=importMillisKey\(row\)/);
  assert.match(matcher,/const candidates=\[\.\.\.\(stored\.get\(key\)\?\.values\(\)\|\|\[\]\)\]/);
});

test('UID alias remapping preserves article content, target order and saved IDs',()=>{
  const aliases=new Map([['AAAA0001','BBBB0002'],['CCCC0003','BBBB0002']]);
  const row={uid:'ROWX0001',content:'unchanged long article',
    source_id:'AAAA0001',ref_id:null,
    target_id:['AAAA0001','CCCC0003','DDDD0004']};
  const out=remapImportUidRelations([row],{aliases});
  assert.deepEqual(out.rows[0].target_id,['BBBB0002','DDDD0004']);
  assert.equal(out.rows[0].source_id,'BBBB0002');
  assert.equal(out.rows[0].content,row.content);
  assert.deepEqual(out.changesByUid.get('ROWX0001').changes,{
    source_id:'BBBB0002',target_id:['BBBB0002','DDDD0004']
  });
  assert.deepEqual(remapImportUidRelations([row]).rows,[row]);
  assert.throws(()=>remapImportUidRelations([row],{
    aliases:new Map([['AAAA0001','BBBB0002'],['BBBB0002','AAAA0001']])
  }),/循環/);
});
