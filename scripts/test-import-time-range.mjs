import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importTimeRangeWindow,importWithinTimeRange,filterImportAnalysisByTime} from '../app/loc/import-time-range.mjs';

const now=new Date('2026-10-31T12:00:00.000Z');
const row=(uid,createtime)=>({uid,site:'Facebook',site_id:null,content:'text',createtime});
test('four import windows include all, one year, six months and one month',()=>{
  assert.equal(importTimeRangeWindow('all',now),null);
  assert.deepEqual(importTimeRangeWindow('year',now),{
    start:'2025-10-31T12:00:00.000Z',end:'2026-10-31T12:00:00.000Z'
  });
  assert.deepEqual(importTimeRangeWindow('halfYear',now),{
    start:'2026-04-30T12:00:00.000Z',end:'2026-10-31T12:00:00.000Z'
  });
  assert.deepEqual(importTimeRangeWindow('month',now),{
    start:'2026-09-30T12:00:00.000Z',end:'2026-10-31T12:00:00.000Z'
  });
  assert.throws(()=>importTimeRangeWindow('unknown',now),/不支援/);
});
test('time window excludes older, future and undated records, including media-only',()=>{
  const window=importTimeRangeWindow('month',now);
  const valid=[row('OLD00001','2026-09-29T00:00:00Z'),
    row('IN000001','2026-10-01T00:00:00Z'),
    row('FUT00001','2026-11-01T00:00:00Z'),
    row('NODATE01',null)];
  const normalized=valid.map(record=>({record,mediaRecords:[]}));
  const mediaOnly=[row('MEDIA001','2026-10-15T00:00:00Z'),
    row('MEDIA002','2026-09-15T00:00:00Z'),
    {...row('MEDIA003','2026-10-15T00:00:00Z'),__article_uid:'OLD00001'}];
  const analysis={valid,normalized,mediaOnly,invalid:[{error:'invalid content'}]};
  const filtered=filterImportAnalysisByTime(analysis,window);
  assert.deepEqual(filtered.valid.map(item=>item.uid),['IN000001']);
  assert.deepEqual(filtered.mediaOnly.map(item=>item.uid),['MEDIA001']);
  assert.equal(filtered.normalized.length,1);
  assert.equal(filtered.skippedByRange,5);
  assert.equal(filtered.undatedByRange,1);
  assert.equal(filtered.invalid.length,1);
  assert.equal(importWithinTimeRange(row('EDGE0001',window.start),window),true);
  assert.equal(importWithinTimeRange(row('EDGE0002',window.end),window),true);
  assert.equal(importWithinTimeRange(row('NODATE01',null),window),false);
});
test('all-time imports preserve valid and undated rows without filtering',()=>{
  const valid=[row('A0000001',null)];
  const analysis={valid,normalized:[{record:valid[0]}],mediaOnly:[],invalid:[]};
  const filtered=filterImportAnalysisByTime(analysis,null);
  assert.equal(filtered.valid.length,1);
  assert.equal(filtered.skippedByRange,0);
  assert.equal(importWithinTimeRange(valid[0],null),true);
});
test('import UI exposes range choices and filters both lookup and writes',()=>{
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/\[timeRange,setTimeRange\]=useState\('year'\)/);
  for(const value of ['all','year','halfYear','month'])
    assert.match(panel,new RegExp('<option value="'+value+'">'));
  assert.match(panel,/filterImportAnalysisByTime\(rawAnalysis,timeWindow\)/);
  assert.match(panel,/const incoming=dedupeIncomingImport\(analyzed\.valid\);/);
  assert.match(panel,/const existingCandidates=unique\.filter\(row=>/);
  assert.match(panel,/\.ilike\('site',site\)\.gte\('createtime',start\)\.lte\('createtime',end\)/);
  assert.match(panel,/prepareArchiveMedia\(\s*eligibleArchiveEvidence,/);
  assert.match(panel,/const geoAnchorRecords=eligibleGeoRecords/);
  assert.match(panel,/__importVisitTimes:\(place\.__importVisitTimes\|\|\[\]\)\.filter\(time=>/);
  assert.match(panel,/disabled=\{busy\|\|!analysisCurrent\|\|\(!analyzed.valid.length&&!analyzed.mediaOnly.length&&!eligibleArchiveMediaPlan.media.length\)\}/);
});


test('all-time explicitly includes older calendar years and does not switch back to default year',()=>{
  const from2009=row('OLD2009A','2009-10-05T12:00:00Z');
  const recent=row('NEW2026A','2026-10-25T12:00:00Z');
  const unDated=row('UNDATE00',null);
  const original=[from2009,recent,unDated];
  const analysis={valid:original,normalized:original.map(record=>({record})),mediaOnly:[],invalid:[]};
  const all=filterImportAnalysisByTime(analysis,importTimeRangeWindow('all',now));
  assert.deepEqual(all.valid.map(record=>record.uid),['OLD2009A','NEW2026A','UNDATE00']);
  const year=filterImportAnalysisByTime(analysis,importTimeRangeWindow('year',now));
  assert.deepEqual(year.valid.map(record=>record.uid),['NEW2026A']);
  assert.equal(year.skippedByRange,2);
  // Selecting all disables the time cutoff for both comparisons and inserts.
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/const timeWindow=useMemo\(\(\)=>importTimeRangeWindow\(timeRange\)/);
  assert.match(panel,/<option value="all">全部的時間<\/option>/);
  assert.match(panel,/const analyzed=useMemo\(\(\)=>filterImportAnalysisByTime\(rawAnalysis,timeWindow\)/);
});
