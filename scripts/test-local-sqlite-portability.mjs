import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/loc/providers/local-sqlite.mjs',import.meta.url),'utf8');

test('local SQLite routes totals-only Culture RPC to a local aggregate',()=>{
  assert.match(source,/case 'read_scope_category_totals':return readScopeCategoryTotalsLocal\(args\)/);
  assert.match(source,/async function readScopeCategoryTotalsLocal/);
  assert.match(source,/json_extract\(able,'\$\.culture'\)=1 AND content<>''/);
  assert.match(source,/FROM local_galaxy_media/);
});

test('SQLite treats UID as case-sensitive and does not rewrite imported identities',()=>{
  assert.match(source,/WHERE eligible\.value=local_galaxy\.uid/);
  assert.doesNotMatch(source,/upper\(trim\(eligible\.value\)\)/i);
  assert.match(source,/if\(\/\^\[A-Za-z0-9\]\{8\}\$\/\.test\(raw\)\)return raw/);
  assert.match(source,/\(id&&!\/\^\[A-Za-z0-9\]\{8\}\$\/\.test\(id\)\)/);
});

test('local Culture totals SQL executes against SQLite with mixed-case Base62 keys',async()=>{
  const {default:initSqlJs}=await import('sql.js/dist/sql-asm.js');
  const SQL=await initSqlJs();
  const db=new SQL.Database();
  db.run("CREATE TABLE local_galaxy(uid TEXT PRIMARY KEY,site TEXT,content TEXT,able TEXT,createtime TEXT)");
  db.run("CREATE TABLE local_galaxy_media(uid TEXT PRIMARY KEY,type TEXT,createtime TEXT)");
  const flags=enabled=>JSON.stringify({statics:enabled,culture:enabled,search:enabled,trace:enabled,
    list:enabled,keywords:enabled,game:true,extract:true});
  const statements=[
    ["INSERT INTO local_galaxy VALUES (?,?,?,?,?)",['aB12cD34','Threads','text',flags(true),'2026-10-28T01:00:00Z']],
    ["INSERT INTO local_galaxy VALUES (?,?,?,?,?)",['AB12CD34','Threads','text',flags(true),'2026-10-28T01:00:00Z']],
    ["INSERT INTO local_galaxy VALUES (?,?,?,?,?)",['12345678','Threads','text',flags(false),'2026-10-28T01:00:00Z']],
    ["INSERT INTO local_galaxy VALUES (?,?,?,?,?)",['87654321','Threads','',flags(true),'2026-10-28T01:00:00Z']],
    ["INSERT INTO local_galaxy_media VALUES (?,?,?)",['aBCdEf12','image','2026-10-27T20:00:00Z']]
  ];
  for(const [query,params] of statements)db.run(query,params);
  const selectLocal=async(query,params=[])=>{
    const stmt=db.prepare(query,params),rows=[];
    while(stmt.step())rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };
  const start=source.indexOf('async function readScopeCategoryTotalsLocal(');
  const stop=source.indexOf('\nasync function readScopeEarliestLocal()',start);
  assert.ok(start>=0&&stop>start,'SQLite totals implementation must be present');
  const readTotals=new Function('selectLocal',source.slice(start,stop)+'\nreturn readScopeCategoryTotalsLocal;')(selectLocal);
  const response=await readTotals({p_start:'2026-10-28',p_end:'2026-10-28'});
  assert.deepEqual(response.error,null);
  assert.deepEqual(response.data.sort((a,b)=>a.kind.localeCompare(b.kind)),[
    {kind:'media',category:'image',item_count:1},
    {kind:'source',category:'Threads',item_count:2}
  ]);
  assert.deepEqual((await selectLocal('SELECT uid FROM local_galaxy WHERE uid=?',['aB12cD34'])).map(row=>row.uid),['aB12cD34']);
  db.close();
});
