import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractImportCreatedAt,createImportBatchSizer,estimateImportMinutes} from '../app/loc/import-batch.mjs';
import {
  dedupeIncomingImport,matchExistingImportBySiteId,matchExistingImportByCreatedAt,
  readImportCandidatesByTimeWindows,isUnchangedImportBeforeWrite,insertImportBatches
} from '../app/loc/import-duplicate-check.mjs';

const post=(uid,site,site_id,content='original')=>({
  uid,site,site_id,
  createtime:'2024-08-01T00:00:00.000Z',
  title:'Post',content
});
test('empty sites do not enter matching pools, but every input row is deduplicated before inserting',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const site=panel.indexOf('const distinctSites=[...new Set(analyzed.valid.map(');
  const dedup=panel.indexOf('const incoming=dedupeIncomingImport(analyzed.valid);');
  const candidate=panel.indexOf('const existingCandidates=unique.filter(row=>');
  const compare=panel.indexOf('await matchExistingImportBySiteId(existingCandidates,');
  assert.ok(site>=0&&site<dedup&&dedup<candidate&&candidate<compare);
  assert.match(panel,/siteAvailability.get\(String\(row.site\|\|''\).trim\(\)\)/);
  assert.match(panel,/remapArchiveArticleUids\(\s*linked\.map\(entry=>entry\.row\),createUid8,issuedArticleUids\)/);
  assert.doesNotMatch(panel,/facebookBackupImportUid\(row\)/);
});
test('timestamps are preserved as article metadata and available for fallback',()=>{
  assert.equal(extractImportCreatedAt({createAt:'2024-08-01T00:00:00Z'}),'2024-08-01T00:00:00.000Z');
  assert.equal(extractImportCreatedAt({media:[{creation_timestamp:1722470400}]}),'2024-08-01T00:00:00.000Z');
  assert.equal(extractImportCreatedAt({text:'missing date'}),null);
});
test('site_id matches despite changed Galaxy UID, timestamp and content',async()=>{
  const incoming=post('NEW00001','Threads','post-100','revised');
  incoming.createtime='2026-01-01T00:00:00Z';
  const saved=post('OLD00001','Threads','post-100','original');
  const matches=await matchExistingImportBySiteId([incoming],{readSiteIds:async ids=>{
    assert.deepEqual(ids,['post-100']);
    return [saved];
  }});
  assert.equal(matches.get(incoming.uid)?.uid,'OLD00001');
});
test('same timestamp and text with different site_id cannot match',async()=>{
  const incoming=post('NEW00001','Threads','post-200');
  const matches=await matchExistingImportBySiteId([incoming],{
    readSiteIds:async()=>[post('OLD00001','Threads','post-100')]
  });
  assert.equal(matches.size,0);
});
test('Facebook and Threads cannot match even when their source IDs are identical',async()=>{
  const incoming=post('NEW00001','Threads','12345');
  const matches=await matchExistingImportBySiteId([incoming],{
    readSiteIds:async()=>[post('FB000001','Facebook','12345')]
  });
  assert.equal(matches.size,0);
});
test('missing site_id does not invoke native ID query',async()=>{
  const rows=[post('NOID0001','Facebook',null),post('NOID0002','Facebook',null,'different')];
  assert.equal(dedupeIncomingImport(rows).unique.length,2);
  const matches=await matchExistingImportBySiteId(rows,{
    readSiteIds:async()=>{throw Error('No source ID: query must not run');}
  });
  assert.equal(matches.size,0);
});
test('duplicate persisted platform IDs match only a unique exact timestamp',async()=>{
  const earlier={...post('OLD00001','Instagram','ig-1'),createtime:'2024-09-24T17:36:16Z'};
  const later={...post('OLD00002','Instagram','ig-1'),createtime:'2024-10-01T15:34:12Z'};
  const incoming={...post('NEW00001','Instagram','ig-1'),createtime:later.createtime};
  const matches=await matchExistingImportBySiteId([incoming],{
    readSiteIds:async()=>[earlier,later]
  });
  assert.equal(matches.get(incoming.uid)?.uid,'OLD00002');
  assert.equal(matches.ambiguous.length,0);
});

test('conflicted saved site IDs with no unique timestamp are held for review',async()=>{
  const saved=[
    {...post('OLD00001','Instagram','ig-1','identical'),createtime:'2024-09-24T17:36:16Z'},
    {...post('OLD00002','Instagram','ig-1','identical'),createtime:'2024-10-01T15:34:12Z'}
  ];
  const incoming={...post('NEW00001','Instagram','ig-1','identical'),
    createtime:'2024-10-02T00:00:00Z'};
  const unrelated=post('NEW00002','Instagram','ig-2');
  const matches=await matchExistingImportBySiteId([incoming,unrelated],{
    readSiteIds:async()=>[...saved]
  });
  assert.equal(matches.has(incoming.uid),false);
  assert.deepEqual(matches.ambiguous.map(r=>r.uid),[incoming.uid]);
  assert.deepEqual(matches.ambiguous[0].saved_uids,['OLD00001','OLD00002']);
});

test('duplicated source IDs with identical timestamps stay ambiguous',async()=>{
  const incoming=post('NEW00001','Instagram','ig-1');
  const saved=[post('OLD00001','Instagram','ig-1'),post('OLD00002','Instagram','ig-1')];
  const matches=await matchExistingImportBySiteId([incoming],{readSiteIds:async()=>saved});
  assert.equal(matches.size,0);
  assert.equal(matches.ambiguous.length,1);
});

test('ambiguous ID rows cannot enter time fallback or insert, but other rows continue',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const mark=panel.indexOf('const ambiguousById=matchesById.ambiguous||[];');
  const exclude=panel.indexOf('!ambiguousByIdUids.has(String(row.uid))');
  const time=panel.indexOf('await matchExistingImportByCreatedAt(remaining,');
  const filter=panel.indexOf('unique=unique.filter(record=>!ambiguousUids.has(String(record.uid)));');
  const insert=panel.indexOf('const newArticleTotal=unique.length-existingBySiteId.size');
  assert.ok(mark>0&&exclude>mark&&time>exclude&&filter>time&&insert>filter);
  assert.match(panel,/duplicateCount\+ambiguousGroups.length/);
});
test('paged lookup ignores all unrelated source platforms without accumulating pages',async()=>{
  const incoming=post('NEW00001','Facebook','fb-100');
  const matches=await matchExistingImportBySiteId([incoming],{
    readSiteIds:async(ids,consumePage)=>{
      assert.deepEqual(ids,['fb-100']);
      for(let i=0;i<50;i++)consumePage([post('OTH'+i,'Threads','fb-100')]);
      consumePage([post('OLD00001','Facebook','fb-100')]);
    }
  });
  assert.equal(matches.get(incoming.uid)?.uid,'OLD00001');
});
test('source ID lookup reports progress without timestamps',async()=>{
  const rows=[post('AA000001','Facebook','fb-1'),post('AA000002','Threads','th-2')];
  const progress=[];
  await matchExistingImportBySiteId(rows,{
    readSiteIds:async()=>[],onProgress:p=>progress.push([p.completed,p.total])
  });
  assert.deepEqual(progress,[[0,2],[2,2]]);
});

test('import compares site IDs before time and fills only missing metadata',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/\.ilike\('site',site\)\.in\('site_id',idsPage\)/);
  assert.match(panel,/\.select\('uid,createtime,site_id'\)\s*\.ilike\('site',site\)\.gte\('createtime',start\)\.lte\('createtime',end\)/);
  assert.match(panel,/\.order\('createtime',\{ascending:true\}\)\.order\('uid',\{ascending:true\}\)/);
  assert.match(panel,/\.range\(offset,offset\+pageSize-1\)/);
  const timeSelect=panel.slice(panel.indexOf('const readSiteSpan=async('),panel.indexOf('const readRowsByUid=async'));
  assert.doesNotMatch(timeSelect,/\.gt\('uid'/);
  assert.match(panel,/urlSafeInBatches\(uids,'uid'\)/);
  assert.match(panel,/matchExistingImportBySiteId\(existingCandidates,/);
  assert.match(panel,/matchExistingImportByCreatedAt\(remaining,/);
  assert.match(panel,/readImportCandidatesByTimeWindows\(times,\{/);
  assert.match(panel,/if\(!page\.length\)break/);
  assert.match(panel,/await updateImportRows\(galaxy,updateQueue\)/);
  assert.match(panel,/if\(!String\(existing.location\|\|''\).trim\(\).*changes.location=record.location/);
  assert.match(panel,/changes.site_id=record.site_id/);
  assert.match(panel,/changes.url=record.url/);
  assert.doesNotMatch(panel,/changes.site=record.site/);
});
test('import progress displays source ID and fallback time matching',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/showProgress\('準備匯入文章'\)/);
  assert.doesNotMatch(panel,/精確比對網站與 site_id/);
  assert.match(panel,/onProgress:p=>showProgress\('依網站與發文時間比對'/);
  assert.match(panel,/showProgress\('準備空間定錨'\)/);
  assert.match(panel,/showProgress\('更新既有文章'/);
  assert.match(panel,/showProgress\('新增文章'/);
  assert.match(panel,/showProgress\('整理媒體資料'\)/);
  assert.match(panel,/progress\.percent===null\?<progress max="100"/);
});
test('batch controller scales with throughput',()=>{
  const s=createImportBatchSizer();
  assert.equal(s.size,256);
  assert.equal(s.observe(256,5000),512);
  assert.equal(s.observe(512,5000),1024);
  assert.equal(s.observe(1024,20000),512);
});
test('pre-write import estimate uses only parsed counts',()=>{
  assert.equal(estimateImportMinutes({articles:0,media:0}),null);
  assert.deepEqual(estimateImportMinutes({articles:1}),{min:1,max:3});
  const withMedia=estimateImportMinutes({articles:35795,media:1000});
  assert.ok(withMedia.min>=8&&withMedia.max>32);
});

test('unchanged native ID match can exit before article or anchor writes',async()=>{
  const record=post('IN000001','Facebook','fb-1');
  const saved={...record,uid:'OLD00001',place_id:null};
  const matches=await matchExistingImportBySiteId([record],{readSiteIds:async()=>[saved]});
  assert.equal(isUnchangedImportBeforeWrite([record],matches),true);
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const guard=panel.indexOf('if(isUnchangedImportBeforeWrite(unique,existingBySiteId,');
  assert.ok(guard>panel.indexOf('const existingBySiteId=new Map('));
  assert.ok(guard<panel.indexOf('const placeAnchors=await prepareImportPlaceAnchors('));
  assert.ok(guard<panel.indexOf('await updateImportRows(galaxy,updateQueue)'));
});
test('no-op guard only looks at site, time, title and content, and never hides media',()=>{
  const record=post('IN000001','Facebook','fb-1');
  const saved={...record,uid:'OLD00001',place_id:null};
  const matches=new Map([[record.uid,saved]]);
  assert.equal(isUnchangedImportBeforeWrite([record],matches),true);
  assert.equal(isUnchangedImportBeforeWrite([{...record,content:'changed'}],matches),false);
  assert.equal(isUnchangedImportBeforeWrite([{...record,site_id:'fb-2'}],matches),true);
  assert.equal(isUnchangedImportBeforeWrite([{...record,site:'Threads'}],matches),false);
  assert.equal(isUnchangedImportBeforeWrite([{...record,site_id:null}],matches),true);
  assert.equal(isUnchangedImportBeforeWrite([{...record,site_id:null,createtime:'2024-08-02T00:00:00Z'}],matches),false);
  assert.equal(isUnchangedImportBeforeWrite([{...record,
    __importCoordinates:{latitude:25.05338,longitude:121.49086}}],matches),true);
  assert.equal(isUnchangedImportBeforeWrite([record],matches,{hasMedia:true}),false);
  assert.equal(isUnchangedImportBeforeWrite([record,{...record,uid:'NEW00002'}],matches),false);
});
test('site and timestamp match despite different content and absent site_id',async()=>{
  const incoming=post('NEW00001','Facebook',null,'修改後內容');
  const saved=post('OLD00001','Facebook',null,'原始內容');
  const calls=[];
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:async (times,consumePage,site)=>{
      calls.push([site,times]);
      consumePage([post('OTHER001','Threads',null,'修改後內容'),saved]);
    }
  });
  assert.deepEqual(calls,[['Facebook',['2024-08-01T00:00:00.000Z']]]);
  assert.equal(matches.get('NEW00001')?.uid,'OLD00001');
  assert.equal(isUnchangedImportBeforeWrite([incoming],matches),false);
});
test('same source and timestamp match regardless of body and optional site_id',async()=>{
  const incoming=post('NEW00001','Facebook','fb-123','different content');
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:async()=>[post('OLD00001','Facebook',null,'original')]
  });
  assert.equal(matches.get('NEW00001')?.uid,'OLD00001');
  assert.equal(isUnchangedImportBeforeWrite([incoming],matches),false);
});

test('different native site IDs never collapse at the same timestamp',async()=>{
  const incoming=post('NEW00001','Facebook','fb-123','original');
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:async()=>[post('OLD00001','Facebook','fb-999','original')]
  });
  assert.equal(matches.size,0);
  assert.deepEqual(matches.ambiguous,[]);
});

test('identical content selects the right saved post even when other saved posts share time',async()=>{
  const incoming=post('NEW00001','Facebook',null,'same text');
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:async()=>[post('OLD00001','Facebook',null,'same text'),
      post('OLD00002','Facebook',null,'different text')]
  });
  assert.equal(matches.get('NEW00001')?.uid,'OLD00001');
  assert.equal(matches.ambiguous.length,0);
});
test('ID-less records without a valid timestamp cannot be matched',async()=>{
  const incoming={...post('NEW00001','Facebook',null),createtime:null};
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:async()=>{throw Error('missing timestamp must not query');}
  });
  assert.equal(matches.size,0);
});
test('import retry uses non-notifying insert but keeps database permission gate',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../app/loc/db-contract.mjs',import.meta.url),'utf8');
  const client=readFileSync(new URL('../app/loc/db-client.mjs',import.meta.url),'utf8');
  assert.match(panel,/writeBatch:batch=>insertImportRows\(galaxy,/);
  assert.doesNotMatch(panel,/writeBatch:batch=>insertRows\(galaxy,/);
  assert.match(contract,/const insertImportRows=insertRowsUnchecked;/);
  assert.match(contract,/const insertRows=withWriteNotice\(insertRowsUnchecked\);/);
  assert.match(contract,/const result=await managementWriteUnchecked\(\{\s*p_table:table,\s*p_operation:'insert',/);
  assert.match(contract,/function insertRowsUnchecked\(table,rows\)\{/);
  assert.match(contract,/preflightWrite\(payload\?\.p_table\)/);
  assert.match(client,/insertRows,insertImportRows,updateRows/);
});

test('only pre-existing source sites enter the match pool; other sites insert directly',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const siteProbe=panel.indexOf('const distinctSites=[...new Set(analyzed.valid.map(');
  const pool=panel.indexOf('const existingCandidates=unique.filter(row=>');
  const match=panel.indexOf('await matchExistingImportBySiteId(existingCandidates,');
  assert.ok(siteProbe>0&&siteProbe<pool&&pool<match);
  assert.match(panel,/existingCandidates.length\?await matchExistingImportBySiteId\(existingCandidates,/);
  assert.match(panel,/\.select\('uid'\)\.ilike\('site',site\)\.limit\(1\)/);
  assert.match(panel,/changes.site_id=record.site_id/);
  assert.match(panel,/changes.source_id=record.source_id/);
  assert.match(panel,/changes.target_id=record.target_id/);
});
test('native site_id lookups are grouped by platform before database reads',async()=>{
  const rows=[post('NEW00001','Facebook','same-id'),post('NEW00002','Threads','same-id')];
  const sites=[];
  await matchExistingImportBySiteId(rows,{readSiteIds:async(ids,consumePage,site)=>{
    sites.push([site,ids]);return [];
  }});
  assert.deepEqual(sites,[['Facebook',['same-id']],['Threads',['same-id']]]);
});

test('distinct posts from one second survive and only matching content is reused',async()=>{
  const incoming=[post('A0000001','Facebook',null,'original'),
    post('B0000002','Facebook',null,'different article')];
  assert.equal(dedupeIncomingImport(incoming).unique.length,2);
  const matches=await matchExistingImportByCreatedAt(incoming,{
    readTimestamps:async()=>[post('OLD00001','Facebook',null,'original')]
  });
  assert.equal(matches.get('A0000001')?.uid,'OLD00001');
  assert.equal(matches.has('B0000002'),false);
  assert.equal(matches.ambiguous.length,0);
});
test('primary-key conflicts do not become site_id matches',async()=>{
  const inserted=[];
  const result=await insertImportBatches([{uid:'AAA00001'},{uid:'AAA00002'},{uid:'AAA00003'}],{
    writeBatch:async rows=>{
      if(rows.some(row=>row.uid==='AAA00002'))
        throw Error('duplicate key value violates unique constraint "galaxy_pkey"');
      inserted.push(...rows);return {count:rows.length};
    }
  });
  assert.deepEqual(inserted.map(row=>row.uid),['AAA00001','AAA00003']);
  assert.equal(result.conflicts,1);
});

const at=n=>new Date(Date.UTC(2024,0,1,0,0,n)).toISOString();
test('comparison pool is cut into sorted, disjoint time windows and every saved row is read once',async()=>{
  const windows=[],full=[];
  await readImportCandidatesByTimeWindows([at(5),at(1),at(3),at(2),at(4)],{
    windowSize:2,
    readWindow:async(start,end)=>{
      windows.push([start,end]);
      return [1,2,3,4,5].map(n=>({uid:'U'+n,createtime:at(n)}))
        .filter(row=>row.createtime>=start&&row.createtime<=end);
    },
    readRowsByUid:async uids=>{full.push(uids);return uids.map(uid=>({uid}));},
    consumePage:()=>{}
  });
  assert.deepEqual(windows,[[at(1),at(2)],[at(3),at(4)],[at(5),at(5)]]);
  assert.deepEqual(full.flat(),['U1','U2','U3','U4','U5']);
});
test('saved rows between requested timestamps are never re-read in full',async()=>{
  const full=[];
  await readImportCandidatesByTimeWindows([at(1),at(10)],{
    readWindow:async()=>[1,2,3,10].map(n=>({uid:'U'+n,createtime:at(n)})),
    readRowsByUid:async uids=>{full.push(...uids);return [];},
    consumePage:()=>{}
  });
  assert.deepEqual(full,['U1','U10']);
});
test('no requested timestamp means no database read at all',async()=>{
  await readImportCandidatesByTimeWindows([],{
    readWindow:async()=>{throw Error('must not query');},
    readRowsByUid:async()=>{throw Error('must not query');},
    consumePage:()=>{}
  });
});
test('a 25,000-post archive needs one span query per window and fetches each matched UID once',async()=>{
  const total=25000;
  const incoming=Array.from({length:total},(_,i)=>post('N'+i,'Facebook',null,'x'+i));
  incoming.forEach((row,i)=>{row.createtime=at(i);});
  const saved=incoming.map((row,i)=>({...row,uid:'S'+i}));
  let spans=0;const fetched=[];
  const matches=await matchExistingImportByCreatedAt(incoming,{
    readTimestamps:(times,consumePage)=>readImportCandidatesByTimeWindows(times,{
      windowSize:10000,consumePage,
      readWindow:async(start,end)=>{
        spans++;
        return saved.filter(row=>row.createtime>=start&&row.createtime<=end)
          .map(({uid,createtime})=>({uid,createtime}));
      },
      readRowsByUid:async uids=>{
        fetched.push(...uids);
        const wanted=new Set(uids);
        return saved.filter(row=>wanted.has(row.uid));
      }
    })
  });
  assert.equal(spans,3);
  assert.equal(fetched.length,total);
  assert.equal(new Set(fetched).size,total);
  assert.equal(matches.size,total);
  assert.equal(matches.get('N24999')?.uid,'S24999');
});
test('two saved rows at one requested second are skipped, not inserted as new and not overwriting either',async()=>{
  const incoming=post('NEW00001','Facebook',null);
  const savedRows=[post('OLD00001','Facebook',null),post('OLD00002','Facebook',null)];
  const matches=await matchExistingImportByCreatedAt([incoming],{
    readTimestamps:(times,consumePage)=>readImportCandidatesByTimeWindows(times,{
      consumePage,
      readWindow:async()=>savedRows.map(({uid,createtime})=>({uid,createtime})),
      readRowsByUid:async()=>savedRows
    })
  });
  assert.equal(matches.size,0);
  assert.equal(matches.ambiguous.length,1);
});

test('only genuinely indistinguishable records are held for review without blocking others',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const match=panel.indexOf('await matchExistingImportByCreatedAt(remaining,');
  const exclude=panel.indexOf('const ambiguousGroups=existingByTime.ambiguous||[];');
  const unique=panel.indexOf('unique=unique.filter(record=>!ambiguousUids.has(String(record.uid)));');
  const summary=panel.indexOf("ambiguousGroups.length?'；同一網站同一發文時間有多篇文章");
  assert.ok(match>0&&match<exclude&&exclude<unique&&unique<summary);
  assert.doesNotMatch(panel,/throw Error\('同一網站、同一發文時間有多篇文章/);
});

test('all ID and time comparisons finish before writing any article',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const id=panel.indexOf('await matchExistingImportBySiteId(existingCandidates,');
  const time=panel.indexOf('await matchExistingImportByCreatedAt(remaining,');
  assert.ok(id>0&&time>id);
  assert.ok(time<panel.indexOf('const updateSizer=createImportBatchSizer()'));
  assert.ok(time<panel.indexOf('const insertSizer=createImportBatchSizer()'));
  assert.equal(panel.split('await matchExistingImportBySiteId(').length-1,1);
  assert.equal(panel.split('await matchExistingImportByCreatedAt(').length-1,1);
  assert.equal(panel.split('readSiteSpan(').length-1,1);
  assert.equal(panel.split('readRowsByUid(').length-1,0);
});
test('comparison reports progress after every time window, not only at the end',async()=>{
  const rows=Array.from({length:5},(_,i)=>({uid:'IN00000'+i,site:'Facebook',site_id:null,
    createtime:new Date(Date.UTC(2024,0,1+i)).toISOString(),title:'T',content:'c'}));
  const seen=[];
  await matchExistingImportByCreatedAt(rows,{
    onProgress:p=>seen.push(p.completed),
    readTimestamps:(times,consumePage,site,report)=>readImportCandidatesByTimeWindows(times,{
      readWindow:async()=>[],readRowsByUid:async()=>[],consumePage,windowSize:2,onWindowDone:report})
  });
  assert.deepEqual(seen,[0,2,4,5,5]);
});

test('an album compares with albums only, even at the same second as its first photo text',async()=>{
  const time='2013-05-11T05:08:55.000Z';
  const album={uid:'NEWALBUM',site:'Facebook',site_id:'album:'+time,createtime:time,title:'相簿',content:'相簿'};
  const photo={uid:'NEWPHOTO',site:'Facebook',site_id:null,createtime:time,title:'山景',content:'山景'};
  const savedAlbum={...album,uid:'OLDALBUM'},savedPhoto={...photo,uid:'OLDPHOTO'};
  const matches=await matchExistingImportByCreatedAt([album,photo],{
    readTimestamps:async(times,consumePage)=>consumePage([savedPhoto,savedAlbum])
  });
  assert.equal(matches.get('NEWALBUM').uid,'OLDALBUM');
  assert.equal(matches.get('NEWPHOTO').uid,'OLDPHOTO');
  const onlyPhoto=await matchExistingImportByCreatedAt([album],{
    readTimestamps:async(times,consumePage)=>consumePage([savedPhoto])
  });
  assert.equal(onlyPhoto.size,0,'a saved article is never taken for the album');
});


test('same-source same-time normalized text is deduplicated only without native IDs',()=>{
  const a=post('N0000001','Threads',null,'你好！世界');
  const b=post('N0000002','Threads',null,'你好 世界。');
  const result=dedupeIncomingImport([a,b]);
  assert.equal(result.duplicates,1);
  assert.equal(result.unique.length,1);
  assert.equal(result.aliases.get('N0000002'),'N0000001');
  const identified=dedupeIncomingImport([
    {...a,site_id:'th-1'}, {...b,site_id:'th-2'}
  ]);
  assert.equal(identified.unique.length,2);
});

test('same-time records with two exact saved copies remain review-only, not overwritten',async()=>{
  const input=post('NEW00001','Facebook',null,'same');
  const saved=[post('OLD00001','Facebook',null,'same'),
    post('OLD00002','Facebook',null,'same')];
  const matches=await matchExistingImportByCreatedAt([input],{
    readTimestamps:async()=>saved
  });
  assert.equal(matches.size,0);
  assert.equal(matches.ambiguous[0].uid,'NEW00001');
});
