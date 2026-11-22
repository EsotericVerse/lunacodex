import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewKeywordDiscovery} from '../app/loc/keywords/discovery.mjs';
import {createIndexedDateKeywordReader} from '../app/loc/keywords/article-reader.mjs';
import {dedupeIncomingImport,matchExistingImportByCreatedAt} from '../app/loc/import/duplicate-check.mjs';
import {finalizeImportCreatedTimes,importTimeMicroseconds} from '../app/loc/import/unique-createtime.mjs';
import {extractImportUpdatedAt} from '../app/loc/import/batch.mjs';
import {importWithinTimeRange} from '../app/loc/import/time-range.mjs';

test('discovery retains single-use terms and question punctuation without weighting',()=>{
  const discovery=createNewKeywordDiscovery([]);
  discovery.consume([{uid:'GALA0001',title:'月光',content:'我很好？'},
    {uid:'GALA0002',title:'標題',content:'我很好！'}]);
  const results=discovery.finish();
  const words=new Set(results.candidates.map(row=>row.word));
  assert.equal(results.read,2);
  assert.ok(words.has('?'));
  assert.ok(words.has('!'));
  assert.ok(words.has('月光'));
  assert.ok(words.has('？'.normalize('NFKC')));
  assert.equal(results.candidates.some(row=>row.documents===1),true);
  assert.ok(results.candidates.every(row=>!Object.hasOwn(row,'score')));
});

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

test('date + UID scan streams same-day rows and undated rows without buffering/sorting',async()=>{
  const dated=[
    {uid:'GALA0001',date:'2026-11-18'},
    {uid:'GALA0002',date:'2026-11-18'},
    {uid:'GALA0003',date:'2026-11-18'},
    {uid:'GALA0004',date:'2026-11-19'}
  ];
  const undated=[{uid:'GALA0005',date:null},{uid:'GALA0006',date:null}];
  let dateCalls=0,undatedCalls=0;
  const reader=createIndexedDateKeywordReader({
    readDateBatch:async({afterDate,afterUid,limit})=>{
      dateCalls++;
      return dated.filter(row=>afterDate===null||row.date>afterDate||
        row.date===afterDate&&row.uid>afterUid).slice(0,limit);
    },
    readUndatedBatch:async({afterUid,limit})=>{
      undatedCalls++;
      return undated.filter(row=>afterUid===null||row.uid>afterUid).slice(0,limit);
    }
  });
  const found=[];
  let cursor=null;
  for(let n=0;n<20;n++){
    const result=await reader({cursor,limit:2});
    found.push(...result.rows.map(row=>row.uid));
    cursor=result.nextCursor;
    if(!result.rows.length)break;
  }
  assert.deepEqual(found,[
    'GALA0001','GALA0002','GALA0003','GALA0004','GALA0005','GALA0006'
  ]);
  assert.ok(dateCalls>=3);
  assert.ok(undatedCalls>=1);
  assert.equal(Object.keys(cursor).includes('pending'),false);
  assert.equal(Object.keys(cursor).includes('currentDay'),false);
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
