import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dailyRecordSlots,availableDailyRuneKind} from '../app/daily/log/daily-record-slots.mjs';

const log=readFileSync(new URL('../app/daily/log/DailyLogClient.jsx',import.meta.url),'utf8');
const settings=readFileSync(new URL('../app/loc/GlobalSettings.jsx',import.meta.url),'utf8');
const backend=readFileSync(new URL('../app/loc/daily-runes.js',import.meta.url),'utf8');

test('Daily Rune settings embed still exposes the add form to authorized users',()=>{
  assert.ok(settings.includes('<DailyLogClient embedded/>'));
  assert.ok(log.includes('{canWrite?<section className="loc-card">'));
  assert.ok(!log.includes('!embedded&&canWrite'), 'embedding a settings view must not hide the editor');
  assert.ok(log.includes('onSubmit={addRecord}'));
  assert.ok(log.includes('canManageScopeSync(\'lrunes\')'),'retain Scope permission gate');
  assert.ok(backend.includes("dbAuthRelation('silver.lrunes_daily')"),'retain authorized database client');
});

test('date with main recorded defaults to supplement without overwriting main',()=>{
  const rows=[{record_date:'2026-10-25',draw_kind:'main'}];
  assert.deepEqual(dailyRecordSlots(rows,'2026-10-25'),{main:true,supplement:false});
  assert.equal(availableDailyRuneKind(rows,'2026-10-25','main'),'supplement');
  assert.equal(availableDailyRuneKind(rows,'2026-10-25','supplement'),'supplement');
  assert.equal(availableDailyRuneKind(rows,'2026-10-26','main'),'main');
});

test('two occupied kinds cannot be silently replaced, or confused across days',()=>{
  const rows=[
    {record_date:'2026-10-24',draw_kind:'main'},
    {record_date:'2026-10-24',draw_kind:'supplement'},
    {record_date:'2026-10-25',draw_kind:'main'}
  ];
  assert.deepEqual(dailyRecordSlots(rows,'2026-10-24'),{main:true,supplement:true});
  assert.deepEqual(dailyRecordSlots(rows,'2026-10-25'),{main:true,supplement:false});
  assert.deepEqual(dailyRecordSlots(rows,'2026-10-26'),{main:false,supplement:false});
  assert.ok(log.includes('dateIsFull||kindOccupied'),'occupied slots disable new submissions');
  assert.ok(log.includes('setMonthValue(monthValueOf(date))'),'date changes load the correct month');
  assert.ok(backend.includes('if(String(error.code||\'\')===\'23505\')'),'unique constraint remains enforced');
});

test('device-local IndexedDB and cloud inserts keep their separate responsibilities',()=>{
  assert.ok(log.includes('if(native){'));
  assert.ok(log.includes('importLocalDailyTransfer(['));
  assert.ok(log.includes('else await insertDailyRuneRecord(newForm)'));
  assert.ok(log.includes("if(!canWrite)throw new Error"));
});
