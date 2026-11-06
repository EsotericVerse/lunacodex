// Device-local SQLite backend for the hidden "local" Scope (private article
// import: MSN / Twitter style personal archives). This NEVER writes to
// Supabase or Neon -- every table lives only in this browser's IndexedDB
// (web) or this device's native SQLite file (iOS via Capacitor), mirroring
// the dual web/native pattern already proven by ../../lrunes/local-rune-sqlite.mjs.
// That file is LunaRunes-daily-draw-settings-specific and is NOT reused or
// touched here; this is a separate, general-purpose adapter conforming to
// the SAME db-contract.mjs interface shape as providers/supabase.mjs, so
// Culture.jsx / Statistics / Search.jsx work against it unchanged.
//
// Table set (field-for-field parity with the matching Supabase `silver`
// tables, confirmed column-by-column against the live schema):
//   local               -- scope settings row (was `lo3rwang`)
//   local_galaxy        -- imported articles (was `lo3rwang_galaxy`)
//   local_galaxy_media  -- article media references (was `lo3rwang_galaxy_media`)
//   local_time          -- culture timeline anchors (was `lo3rwang_time`)
//   local_keywords      -- keyword classification rows (was `lo3rwang_keywords`)
//   local_daily         -- daily rune draw records (was `lrunes_daily`)
//   runes / runes_etc / runes_group -- shared read-only rune dictionary,
//     seeded once, same shape as the cloud `silver.runes*` tables; needed so
//     a reused rune-draw interface can resolve rune numbers to names/meanings
//     fully offline.
import {Capacitor} from '@capacitor/core';
import {sourceTaxonomyFromArrays} from '../source-classification.mjs';
import {convertLegacyTimeRows} from '../time-schema-migration.mjs';
import {generateKeywordClassUid} from '../keyword-uidlist.mjs';
import {portableContainsSpec,parsePortableOrExpression} from './portable-search.mjs';

const DATABASE_NAME='loc_local_scope';
const MARKER='loc.local.scope.sqlite.v1';
const SCHEMA=`
CREATE TABLE IF NOT EXISTS local (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT,
  style INTEGER,
  theme TEXT NOT NULL DEFAULT 'theme-7',
  search_able INTEGER NOT NULL DEFAULT 1,
  statistics_able INTEGER NOT NULL DEFAULT 1,
  culture_able INTEGER NOT NULL DEFAULT 1,
  DefaultArticleClass TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  keyword_min_chars INTEGER NOT NULL DEFAULT 32,
  keyword_min_documents INTEGER NOT NULL DEFAULT 100,
  staticstime TEXT,
  current_keyword_class_uid TEXT,
  keyword_class_share_enabled INTEGER NOT NULL DEFAULT 0,
  keyword_meta TEXT NOT NULL DEFAULT '{}',
  display_name TEXT NOT NULL DEFAULT 'local',
  search_intro TEXT NOT NULL DEFAULT '',
  search_aliases TEXT NOT NULL DEFAULT '[]',
  locale TEXT NOT NULL DEFAULT 'zh-Hant'
);
CREATE TABLE IF NOT EXISTS local_galaxy (
  uid TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  content TEXT,
  createtime TEXT,
  location TEXT,
  statics INTEGER NOT NULL DEFAULT 1,
  culture INTEGER NOT NULL DEFAULT 1,
  search INTEGER NOT NULL DEFAULT 1,
  trace INTEGER NOT NULL DEFAULT 1,
  list INTEGER NOT NULL DEFAULT 1,
  keyword INTEGER NOT NULL DEFAULT 1,
  others INTEGER NOT NULL DEFAULT 1,
  extract INTEGER NOT NULL DEFAULT 1,
  "UpdateTime" TEXT NOT NULL,
  url TEXT,
  source_id TEXT,
  target_id TEXT,
  ref_id TEXT,
  site TEXT,
  site_id TEXT,
  media_link TEXT
);
CREATE TABLE IF NOT EXISTS local_galaxy_media (
  uid TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  url TEXT,
  description TEXT,
  createtime TEXT,
  location TEXT
);
CREATE TABLE IF NOT EXISTS local_archive_media_exif (
  archive_id TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  media_id TEXT,
  platform TEXT,
  latitude REAL,
  longitude REAL,
  camera_local_time TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (archive_id,entry_path),
  CHECK((latitude IS NULL AND longitude IS NULL) OR
    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE TABLE IF NOT EXISTS local_time (
  uid TEXT PRIMARY KEY NOT NULL CHECK(length(uid)=4),
  type TEXT NOT NULL CHECK(type IN ('anchor','period','era')),
  title TEXT,
  description TEXT,
  address TEXT,
  anchor_ids TEXT,
  range TEXT NOT NULL DEFAULT '{}',
  status TEXT
);
CREATE TABLE IF NOT EXISTS local_keywords (
  uid TEXT PRIMARY KEY NOT NULL CHECK(length(uid)=4),
  type TEXT NOT NULL CHECK(type IN ('category','class','group','item')),
  name TEXT NOT NULL,
  "desc" TEXT NOT NULL DEFAULT '',
  lists TEXT NOT NULL DEFAULT '[]',
  uid_lists TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS local_daily (
  record_id TEXT PRIMARY KEY NOT NULL,
  record_date TEXT NOT NULL,
  draw_kind TEXT NOT NULL,
  rune_number INTEGER NOT NULL,
  direction TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recorded_phase TEXT
);
CREATE TABLE IF NOT EXISTS runes (
  rune_id INTEGER PRIMARY KEY NOT NULL,
  rune_name TEXT,
  english_name TEXT,
  totem TEXT,
  group_name TEXT,
  moon_phase INTEGER,
  card_attr INTEGER,
  rune_description TEXT,
  archetype TEXT,
  char_action TEXT,
  positive_keywords TEXT,
  negative_keywords TEXT,
  extra_rules TEXT,
  extra_notes TEXT,
  positive_meaning TEXT,
  half_positive_meaning TEXT,
  half_reverse_meaning TEXT,
  reverse_meaning TEXT,
  rune_evolution_history TEXT,
  myth_story TEXT,
  soul_question TEXT,
  practice_challenge TEXT,
  ritual_advice TEXT,
  harmony_advice TEXT,
  class_enable INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS runes_etc (
  rune_id INTEGER NOT NULL,
  dir INTEGER NOT NULL,
  type TEXT NOT NULL,
  "desc" TEXT NOT NULL,
  current_moon TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(rune_id,dir,type)
);
CREATE TABLE IF NOT EXISTS runes_group (
  group_id TEXT PRIMARY KEY NOT NULL,
  english_name TEXT NOT NULL,
  "desc" TEXT NOT NULL,
  quality TEXT NOT NULL,
  style TEXT NOT NULL,
  runeslist TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_blocks (
  uid TEXT PRIMARY KEY NOT NULL,
  page_name TEXT NOT NULL,
  block_eyebrow TEXT,
  block_title TEXT,
  block_subtitle TEXT,
  block_text TEXT,
  block_order INTEGER NOT NULL DEFAULT 1,
  block_entity TEXT,
  block_image TEXT
);
CREATE TABLE IF NOT EXISTS local_file_meta (
  format TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL
);
`;
// Keep pre-cutover device data recoverable. Both SQL.js and native SQLite run
// the same validated row conversion inside a transaction before opening Time.
const TIME_TABLE_CREATE=SCHEMA.match(/CREATE TABLE IF NOT EXISTS local_time \([\s\S]*?\);/)[0];

const ARCHIVE_EXIF_TABLE_CREATE=SCHEMA.match(/CREATE TABLE IF NOT EXISTS local_archive_media_exif \([\s\S]*?\);/)[0];
const ARCHIVE_EXIF_COLUMNS=['archive_id','entry_path','media_id','platform','latitude','longitude','camera_local_time','imported_at'];
function archiveExifMigrationStatements(){
  return [
    {sql:'ALTER TABLE local_archive_media_exif RENAME TO local_archive_media_exif_backup',values:[]},
    {sql:ARCHIVE_EXIF_TABLE_CREATE,values:[]},
    {sql:'INSERT INTO local_archive_media_exif ('+ARCHIVE_EXIF_COLUMNS.join(',')+') SELECT '+ARCHIVE_EXIF_COLUMNS.join(',')+' FROM local_archive_media_exif_backup',values:[]},
    {sql:'DROP TABLE local_archive_media_exif_backup',values:[]}
  ];
}
function upgradeWebLocalArchiveExif(db){
  const columns=rowsOf(db,'PRAGMA table_info(local_archive_media_exif)');
  if(!columns.some(row=>row.name==='media_id'&&Number(row.notnull)===1))return;
  const before=Number(rowsOf(db,'SELECT count(*) n FROM local_archive_media_exif')[0]?.n)||0;
  db.run('BEGIN');
  try{
    for(const step of archiveExifMigrationStatements())db.run(step.sql,step.values);
    const after=Number(rowsOf(db,'SELECT count(*) n FROM local_archive_media_exif')[0]?.n)||0;
    if(before!==after)throw new Error('SQLite EXIF migration count mismatch');
    db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
async function upgradeNativeLocalArchiveExif(conn){
  const columns=(await conn.query('PRAGMA table_info(local_archive_media_exif)')).values||[];
  if(!columns.some(row=>row.name==='media_id'&&Number(row.notnull)===1))return;
  const before=Number((await conn.query('SELECT count(*) n FROM local_archive_media_exif')).values?.[0]?.n)||0;
  await conn.beginTransaction();
  try{
    for(const step of archiveExifMigrationStatements())await conn.execute(step.sql+';');
    const after=Number((await conn.query('SELECT count(*) n FROM local_archive_media_exif')).values?.[0]?.n)||0;
    if(before!==after)throw new Error('Native SQLite EXIF migration count mismatch');
    await conn.commitTransaction();
  }catch(error){await conn.rollbackTransaction();throw error;}
}


const LOCAL_MEDIA_TABLE_CREATE=SCHEMA.match(/CREATE TABLE IF NOT EXISTS local_galaxy_media \([\s\S]*?\);/)[0];
const LOCAL_MEDIA_COLUMNS=['uid','type','title','url','description','createtime','location'];
function legacyMediaUid(value){
  const raw=String(value||'').trim();
  if(/^[A-Za-z0-9]{8}$/.test(raw))return raw;
  const text=raw.toUpperCase();
  if(!/^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/.test(text))
    throw new Error('Unrecognized local media identifier');
  return (BigInt('0x'+text.replaceAll('-',''))%(36n**8n)).toString(36).toUpperCase().padStart(8,'0');
}
function localMediaMigrationStatements(mediaRows,articles,exifRows){
  const oldId=row=>String(row.media_id||row.uid);
  const links=new Map(mediaRows.map(row=>[oldId(row),legacyMediaUid(oldId(row))]));
  if(new Set(links.values()).size!==links.size)throw new Error('Local media UID collision');
  const runeRefContent=row=>{
    const value=row.rune_references;
    if(value==null)return '';
    const content=String(value).trim();
    return content==='{}'||content==='[]'||content==='null'?'':content;
  };
  const occupied=new Set(links.values()),runeUidBySource=new Map();
  for(const row of mediaRows){
    if(!runeRefContent(row)||['rune','runes'].includes(String(row.type||row.media_type||'').toLowerCase()))continue;
    const old=oldId(row);
    for(let salt=0;salt<1000;salt++){
      let hash=2166136261;
      for(const c of 'rune:'+old+':'+salt)hash=Math.imul(hash^c.codePointAt(0),16777619);
      const uid=(hash>>>0).toString(36).toUpperCase().padStart(8,'0');
      if(!occupied.has(uid)){occupied.add(uid);runeUidBySource.set(old,uid);break;}
    }
    if(!runeUidBySource.has(old))throw Error('Local Rune UID collision');
  }
  const byArticle=new Map();
  for(const row of mediaRows){
    if(!row.galaxy_link)continue;
    const articleUid=String(row.galaxy_link);
    if(!byArticle.has(articleUid))byArticle.set(articleUid,[]);
    byArticle.get(articleUid).push(links.get(oldId(row)));
    if(runeUidBySource.has(oldId(row)))byArticle.get(articleUid).push(runeUidBySource.get(oldId(row)));
  }
  const steps=[
    {sql:'ALTER TABLE local_galaxy_media RENAME TO local_galaxy_media_legacy_backup',values:[]},
    {sql:LOCAL_MEDIA_TABLE_CREATE,values:[]},
    ...mediaRows.map(row=>({sql:'INSERT INTO local_galaxy_media ('+LOCAL_MEDIA_COLUMNS.join(',')+') VALUES ('+LOCAL_MEDIA_COLUMNS.map(()=>'?').join(',')+')',
      values:LOCAL_MEDIA_COLUMNS.map(c=>toSqlValue(c==='uid'?links.get(oldId(row)):c==='type'?
        (['runes','rune'].includes(row.type||row.media_type)?'rune':(row.type||row.media_type)):row[c]))})),
    ...mediaRows.filter(row=>runeUidBySource.has(oldId(row))).map(row=>({
      sql:'INSERT INTO local_galaxy_media ('+LOCAL_MEDIA_COLUMNS.join(',')+') VALUES ('+LOCAL_MEDIA_COLUMNS.map(()=>'?').join(',')+')',
      values:LOCAL_MEDIA_COLUMNS.map(c=>toSqlValue(({uid:runeUidBySource.get(oldId(row)),
        type:'rune',title:'抽牌結果',url:null,description:runeRefContent(row),createtime:row.createtime,
        location:row.location})[c]))
    }))
  ];
  for(const row of articles){
    let ids=[];
    if(row.media_link){
      try{ids=JSON.parse(row.media_link);}catch{throw new Error('Invalid legacy local media links');}
      if(!Array.isArray(ids))throw new Error('Invalid legacy local media links');
    }
    const forward=ids.map(id=>{
      if(!links.has(String(id)))throw new Error('Unresolved legacy local media link');
      return links.get(String(id));
    });
    const next=[...new Set([...forward,...ids.map(id=>runeUidBySource.get(String(id))).filter(Boolean),...(byArticle.get(String(row.uid))||[])])];
    if(next.length||row.media_link)steps.push({sql:'UPDATE local_galaxy SET media_link=? WHERE uid=?',
      values:[JSON.stringify(next),row.uid]});
  }
  for(const row of exifRows){
    if(!row.media_id)continue;
    if(!links.has(String(row.media_id)))throw new Error('Unresolved local EXIF media link');
    steps.push({sql:'UPDATE local_archive_media_exif SET media_id=? WHERE archive_id=? AND entry_path=?',
      values:[links.get(String(row.media_id)),row.archive_id,row.entry_path]});
  }
  steps.push({sql:'DROP TABLE local_galaxy_media_legacy_backup',values:[]});
  return steps;
}
function upgradeWebLocalMedia(db){
  const columns=rowsOf(db,'PRAGMA table_info(local_galaxy_media)');
  if(!columns.some(row=>['media_id','galaxy_link','media_type','rune_references'].includes(row.name)))return;
  const rows=rowsOf(db,'SELECT * FROM local_galaxy_media');
  const articles=rowsOf(db,'SELECT uid,media_link FROM local_galaxy');
  const exif=rowsOf(db,'SELECT archive_id,entry_path,media_id FROM local_archive_media_exif WHERE media_id IS NOT NULL');
  const steps=localMediaMigrationStatements(rows,articles,exif);
  db.run('BEGIN');
  try{
    for(const step of steps)db.run(step.sql,step.values);
    if(Number(rowsOf(db,'SELECT count(*) n FROM local_galaxy_media')[0]?.n)<rows.length)
      throw new Error('Local media migration count mismatch');
    db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
async function upgradeNativeLocalMedia(conn){
  const columns=(await conn.query('PRAGMA table_info(local_galaxy_media)')).values||[];
  if(!columns.some(row=>['media_id','galaxy_link','media_type','rune_references'].includes(row.name)))return;
  const rows=(await conn.query('SELECT * FROM local_galaxy_media')).values||[];
  const articles=(await conn.query('SELECT uid,media_link FROM local_galaxy')).values||[];
  const exif=(await conn.query('SELECT archive_id,entry_path,media_id FROM local_archive_media_exif WHERE media_id IS NOT NULL')).values||[];
  const steps=localMediaMigrationStatements(rows,articles,exif);
  await conn.beginTransaction();
  try{
    for(const step of steps){
      if(step.values.length)await conn.run(step.sql,step.values,false);
      else await conn.execute(step.sql+';');
    }
    if(Number((await conn.query('SELECT count(*) n FROM local_galaxy_media')).values?.[0]?.n)<rows.length)
      throw new Error('Native local media migration count mismatch');
    await conn.commitTransaction();
  }catch(error){await conn.rollbackTransaction();throw error;}
}

const TIME_COLUMNS=['uid','type','title','description','address','anchor_ids','status'];
const TIME_INSERT_SQL='INSERT INTO local_time ('+TIME_COLUMNS.join(',')+') VALUES ('+TIME_COLUMNS.map(()=>'?').join(',')+')';
const oldTimePresent=columns=>columns.some(row=>row.name==='record_id')&&!columns.some(row=>row.name==='uid');
function timeMigrationStatements(oldRows){
  const {rows}=convertLegacyTimeRows(oldRows);
  return [
    {sql:'ALTER TABLE local_time RENAME TO local_time_legacy_backup',values:[]},
    {sql:TIME_TABLE_CREATE,values:[]},
    ...rows.map(row=>({sql:TIME_INSERT_SQL,values:TIME_COLUMNS.map(c=>toSqlValue(row[c]))}))
  ];
}
function upgradeWebLocalTime(db){
  const columns=rowsOf(db,'PRAGMA table_info(local_time)');
  if(!oldTimePresent(columns))return;
  const oldRows=rowsOf(db,'SELECT * FROM local_time');
  const steps=timeMigrationStatements(oldRows);
  db.run('BEGIN');
  try{
    for(const step of steps)db.run(step.sql,step.values);
    const count=Number(rowsOf(db,'SELECT count(*) AS n FROM local_time')[0]?.n)||0;
    const expected=convertLegacyTimeRows(oldRows).rows.length;
    if(count!==expected)throw new Error('SQLite Time migration count mismatch');
    db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
async function upgradeNativeLocalTime(conn){
  const columns=(await conn.query('PRAGMA table_info(local_time)')).values||[];
  if(!oldTimePresent(columns))return;
  const oldRows=(await conn.query('SELECT * FROM local_time')).values||[];
  const steps=timeMigrationStatements(oldRows);
  await conn.beginTransaction();
  try{
    for(const step of steps){
      if(step.values.length)await conn.run(step.sql,step.values,false);
      else await conn.execute(step.sql+';');
    }
    const count=Number((await conn.query('SELECT count(*) AS n FROM local_time')).values?.[0]?.n)||0;
    const expected=convertLegacyTimeRows(oldRows).rows.length;
    if(count!==expected)throw new Error('Native Time migration count mismatch');
    await conn.commitTransaction();
  }catch(error){await conn.rollbackTransaction();throw error;}
}

const SCHEMA_MARKER_SQL='INSERT OR IGNORE INTO local_file_meta(format,version) VALUES(?,1)';
// A single settings row must exist (`local` has id='local') before
// read_scope_overview/statistics or keyword-classification finalize can
// read/update it -- mirrors the single `silver.lo3rwang`-style config row
// each real scope already has, seeded once on first use.
const SEED_LOCAL_ROW_SQL=`INSERT OR IGNORE INTO local(id,updated_at) VALUES('local',?)`;

// -- Low-level dual-backend plumbing (same shape as local-rune-sqlite.mjs) --
let webSQL=null;
let webDBPromise=null;
let nativeConnectionPromise=null;

async function sqliteJS(){
  if(!webSQL){
    webSQL=(async()=>{
      const imported=await import('sql.js/dist/sql-asm.js');
      const factory=imported.default||imported;
      return factory();
    })();
  }
  return webSQL;
}
function rowsOf(db,sql,params=[]){
  const stmt=db.prepare(sql,params);
  try{
    const result=[];
    while(stmt.step())result.push(stmt.getAsObject());
    return result;
  }finally{stmt.free();}
}
const KEYWORD_TREE_SCHEMA=`CREATE TABLE local_keywords_portable (uid TEXT PRIMARY KEY NOT NULL CHECK(length(uid)=4),type TEXT NOT NULL CHECK(type IN ('category','class','group','item')),name TEXT NOT NULL,\"desc\" TEXT NOT NULL DEFAULT '',lists TEXT NOT NULL DEFAULT '[]',uid_lists TEXT NOT NULL DEFAULT '{}')`;
// This local-file migration preserves the author's Keywords rules. Historical
// classification hits are deliberately recomputed from Galaxy, not migrated.
function legacyKeywordTree(items=[]){
  const occupied=new Set(items.map(row=>String(row.class_uid||'')).filter(uid=>/^[A-Za-z0-9]{4}$/.test(uid)));
  const uid=()=>{const next=generateKeywordClassUid([...occupied]);occupied.add(next);return next;};
  const parsed=value=>{
    if(Array.isArray(value))return value;
    try{const decoded=JSON.parse(String(value||'[]'));return Array.isArray(decoded)?decoded:[];}
    catch{return [];}
  };
  const categories=new Map(),classes=new Map(),groups=new Map(),nodes=[];
  const kind=name=>String(name||'').includes('符文')?'符文':
    ['Pop','Hip-Hop','Electronic','Rock','Vocal'].includes(String(name))?'音樂':'其他';
  for(const row of [...items].sort((a,b)=>Number(a.order_no||0)-Number(b.order_no||0))){
    const className=String(row.class_name||row.group_name||'').trim();
    if(!className)continue;
    const categoryName=kind(className);
    if(!categories.has(categoryName)){
      const node={uid:uid(),type:'category',name:categoryName,desc:'',lists:[],uid_lists:[]};
      categories.set(categoryName,node);nodes.push(node);
    }
    if(!classes.has(className)){
      const classUid=String(row.class_uid||'');
      const node={uid:/^[A-Za-z0-9]{4}$/.test(classUid)?classUid:uid(),
        type:'class',name:className,desc:'',lists:[],uid_lists:[]};
      occupied.add(node.uid);classes.set(className,node);nodes.push(node);
      categories.get(categoryName).lists.push(node.uid);
    }
    const groupName=String(row.class_group||'').trim()||'未分類';
    const groupKey=className+'\\u0000'+groupName;
    if(!groups.has(groupKey)){
      const node={uid:uid(),type:'group',name:groupName,desc:groupName+'組',lists:[],uid_lists:[]};
      groups.set(groupKey,node);nodes.push(node);classes.get(className).lists.push(node.uid);
    }
    const node={uid:uid(),type:'item',name:String(row.item_name||'').trim()||'未命名',
      desc:String(row.principle||''),lists:parsed(row.keywords),uid_lists:[]};
    nodes.push(node);groups.get(groupKey).lists.push(node.uid);
  }
  return {nodes,classes};
}
function keywordMigrationStatements(items=[]){
  const {nodes,classes}=legacyKeywordTree(items);
  const statements=[{sql:KEYWORD_TREE_SCHEMA,values:[]}];
  for(const node of nodes)statements.push({
    sql:'INSERT INTO local_keywords_portable(uid,type,name,"desc",lists,uid_lists) VALUES(?,?,?,?,?,?)',
    values:[node.uid,node.type,node.name,node.desc,JSON.stringify(node.lists),JSON.stringify(node.type==='group'?{articles:node.uid_lists}:node.type==='item'?{hits:node.uid_lists}:{})]
  });
  statements.push({sql:'DROP TABLE local_keywords',values:[]});
  statements.push({sql:'ALTER TABLE local_keywords_portable RENAME TO local_keywords',values:[]});
  statements.push({sql:'DROP TABLE IF EXISTS local_keyword_classes',values:[]});
  return {statements,classes};
}
function upgradeWebKeywordSchema(db){
  if(!rowsOf(db,'PRAGMA table_info(local)').some(row=>row.name==='current_keyword_class_uid'))
    db.run('ALTER TABLE local ADD COLUMN current_keyword_class_uid TEXT');
  const columns=rowsOf(db,'PRAGMA table_info(local_keywords)');
  if(columns.some(row=>row.name==='type'))return;
  const items=rowsOf(db,'SELECT * FROM local_keywords');
  const old=rowsOf(db,"SELECT * FROM local WHERE id='local'")[0]||{};
  const {statements,classes}=keywordMigrationStatements(items);
  const preferred=items.find(item=>String(item.class_uid||'')===String(old.current_keyword_class_uid||'')||
    String(item.class_id||'')===String(old.current_keyword_class_id||''))?.class_name;
  db.run('BEGIN TRANSACTION');
  try{
    for(const item of statements)db.run(item.sql,item.values);
    db.run("UPDATE local SET current_keyword_class_uid=?,staticstime=NULL,keyword_meta='{}' WHERE id='local'",
      [classes.get(preferred)?.uid||[...classes.values()][0]?.uid||null]);
    db.run('COMMIT');
  }catch(error){db.run('ROLLBACK');throw error;}
}
async function upgradeNativeKeywordSchema(conn){
  const configColumns=(await conn.query('PRAGMA table_info(local)')).values||[];
  if(!configColumns.some(row=>row.name==='current_keyword_class_uid'))
    await conn.execute('ALTER TABLE local ADD COLUMN current_keyword_class_uid TEXT');
  const columns=(await conn.query('PRAGMA table_info(local_keywords)')).values||[];
  if(columns.some(row=>row.name==='type'))return;
  const items=(await conn.query('SELECT * FROM local_keywords')).values||[];
  const old=(await conn.query("SELECT * FROM local WHERE id='local'")).values?.[0]||{};
  const {statements,classes}=keywordMigrationStatements(items);
  const preferred=items.find(item=>String(item.class_uid||'')===String(old.current_keyword_class_uid||'')||
    String(item.class_id||'')===String(old.current_keyword_class_id||''))?.class_name;
  await conn.execute('BEGIN TRANSACTION');
  try{
    for(const item of statements){
      if(item.values.length)await conn.run(item.sql,item.values,false);
      else await conn.execute(item.sql);
    }
    await conn.run("UPDATE local SET current_keyword_class_uid=?,staticstime=NULL,keyword_meta='{}' WHERE id='local'",
      [classes.get(preferred)?.uid||[...classes.values()][0]?.uid||null],false);
    await conn.execute('COMMIT');
  }catch(error){await conn.execute('ROLLBACK');throw error;}
}

function createFreshSQL(SQL){
  const db=new SQL.Database();
  db.run(SCHEMA);
  db.run(SCHEMA_MARKER_SQL,[MARKER]);
  return db;
}
function idbStore(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('loc-local-scope-sqlite-v1',1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('databases');};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('本機 SQLite 儲存無法開啟。'));
  });
}
async function readWebBytes(){
  const store=await idbStore();
  try{return await new Promise((resolve,reject)=>{
    const tx=store.transaction('databases','readonly');
    const req=tx.objectStore('databases').get('local');
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });}finally{store.close();}
}
async function writeWebBytes(bytes){
  const store=await idbStore();
  try{await new Promise((resolve,reject)=>{
    const tx=store.transaction('databases','readwrite');
    tx.objectStore('databases').put(bytes,'local');
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });}finally{store.close();}
}
// Upgrade saved local-file Galaxy columns without altering article content.
const LOCAL_GALAXY_RENAME=[
  ['local_galaxy','location','source_'+'place'],
  ['local_galaxy','site','source_'+'name'],
  ['local_galaxy_media','location','source_'+'place'],
  // One-time local SQLite data-preserving rename; cloud Anchor already uses description.
  ['local_galaxy_media','description','meta_tags']
];
function upgradeWebLocalGalaxyNames(db){
  for(const [table,current,previous] of LOCAL_GALAXY_RENAME){
    const columns=rowsOf(db,'PRAGMA table_info('+table+')');
    if(columns.some(row=>row.name===previous)&&!columns.some(row=>row.name===current))
      db.run('ALTER TABLE '+table+' RENAME COLUMN "'+previous+'" TO "'+current+'"');
  }
}
async function upgradeNativeLocalGalaxyNames(conn){
  for(const [table,current,previous] of LOCAL_GALAXY_RENAME){
    const columns=(await conn.query('PRAGMA table_info('+table+')')).values||[];
    if(columns.some(row=>row.name===previous)&&!columns.some(row=>row.name===current))
      await conn.execute('ALTER TABLE '+table+' RENAME COLUMN "'+previous+'" TO "'+current+'";');
  }
}
function upgradeWebLocalGalaxySiteId(db){
  if(!rowsOf(db,'PRAGMA table_info(local_galaxy)').some(row=>row.name==='site_id'))
    db.run('ALTER TABLE local_galaxy ADD COLUMN site_id TEXT');
}
async function upgradeNativeLocalGalaxySiteId(conn){
  const columns=(await conn.query('PRAGMA table_info(local_galaxy)')).values||[];
  if(!columns.some(row=>row.name==='site_id'))
    await conn.execute('ALTER TABLE local_galaxy ADD COLUMN site_id TEXT');
}

// Preserve device-local Galaxy data while migrating JSONB feature flags to
// independently queryable boolean columns (no new table or temp table).
const LOCAL_GALAXY_COLUMNS=['statics','culture','search','trace','list','keyword','extract','others'];
function localGalaxyAbleMigration(columns){
  const existing=new Set(columns.map(column=>column.name));
  const legacy=existing.has('able');
  const searchable=existing.has('searchable')?'searchable':'1';
  const statistics=existing.has('statistics_able')?'statistics_able':'1';
  const defaults={statics:statistics,culture:statistics,search:searchable,
    trace:searchable+' AND '+statistics,list:searchable,
    keyword:searchable+' AND '+statistics,others:'1',extract:'1'};
  const migrated=[];
  for(const column of LOCAL_GALAXY_COLUMNS){
    if(existing.has(column))continue;
    migrated.push('ALTER TABLE local_galaxy ADD COLUMN '+column+' INTEGER NOT NULL DEFAULT 1');
    const oldName=column==='keyword'?'keywords':column==='others'?'game':column;
    const source=legacy?"CASE WHEN json_valid(able) THEN json_extract(able,'$."+oldName+"') END":'NULL';
    migrated.push('UPDATE local_galaxy SET '+column+'=CASE WHEN COALESCE('+source+','+defaults[column]+')=0 THEN 0 ELSE 1 END');
  }
  return migrated;
}
function upgradeWebLocalGalaxyAble(db){
  for(const sql of localGalaxyAbleMigration(rowsOf(db,'PRAGMA table_info(local_galaxy)')))db.run(sql);
}
async function upgradeNativeLocalGalaxyAble(conn){
  const columns=(await conn.query('PRAGMA table_info(local_galaxy)')).values||[];
  for(const sql of localGalaxyAbleMigration(columns))await conn.execute(sql+';');
}

async function webDatabase(){
  if(!webDBPromise)webDBPromise=(async()=>{
    const SQL=await sqliteJS();
    const bytes=await readWebBytes();
    const db=bytes?new SQL.Database(new Uint8Array(bytes)):createFreshSQL(SQL);
    db.run(SCHEMA);
    upgradeWebLocalGalaxyNames(db);
    upgradeWebLocalGalaxySiteId(db);
    upgradeWebLocalGalaxyAble(db);
    upgradeWebLocalTime(db);
    if(!rowsOf(db,'PRAGMA table_info(local_time)').some(row=>row.name==='range'))db.run("ALTER TABLE local_time ADD COLUMN range TEXT NOT NULL DEFAULT '{}'");
    upgradeWebLocalArchiveExif(db);
    upgradeWebLocalMedia(db);
    upgradeWebKeywordSchema(db);
    const classColumns=rowsOf(db,'PRAGMA table_info(local)');
    if(!classColumns.some(row=>row.name==='DefaultArticleClass')){
      if(classColumns.some(row=>row.name==='txt_class'))
        db.run('ALTER TABLE local RENAME COLUMN txt_class TO "DefaultArticleClass"');
      else db.run("ALTER TABLE local ADD COLUMN DefaultArticleClass TEXT NOT NULL DEFAULT '[]'");
    }
    db.run(SCHEMA_MARKER_SQL,[MARKER]);
    db.run(SEED_LOCAL_ROW_SQL,[new Date().toISOString()]);
    return db;
  })().catch(e=>{webDBPromise=null;throw e;});
  return webDBPromise;
}
async function nativeDatabase(){
  if(!nativeConnectionPromise)nativeConnectionPromise=(async()=>{
    const {SQLiteConnection,CapacitorSQLite}=await import('@capacitor-community/sqlite');
    const plugin=new SQLiteConnection(CapacitorSQLite);
    const exists=await plugin.isConnection(DATABASE_NAME,false);
    const conn=exists.result?await plugin.retrieveConnection(DATABASE_NAME,false)
      :await plugin.createConnection(DATABASE_NAME,false,'no-encryption',1,false);
    await conn.open();
    for(const statement of SCHEMA.split(';').map(s=>s.trim()).filter(Boolean))await conn.execute(statement+';');
    await upgradeNativeLocalGalaxyNames(conn);
    await upgradeNativeLocalGalaxySiteId(conn);
    await upgradeNativeLocalGalaxyAble(conn);
    await upgradeNativeLocalTime(conn);
    if(!(await conn.query('PRAGMA table_info(local_time)')).values?.some(row=>row.name==='range'))
      await conn.execute("ALTER TABLE local_time ADD COLUMN range TEXT NOT NULL DEFAULT '{}'");
    await upgradeNativeLocalArchiveExif(conn);
    await upgradeNativeLocalMedia(conn);
    await upgradeNativeKeywordSchema(conn);
    const columns=(await conn.query('PRAGMA table_info(local)')).values||[];
    if(!columns.some(row=>row.name==='DefaultArticleClass')){
      if(columns.some(row=>row.name==='txt_class'))
        await conn.execute('ALTER TABLE local RENAME COLUMN txt_class TO "DefaultArticleClass"');
      else await conn.execute("ALTER TABLE local ADD COLUMN DefaultArticleClass TEXT NOT NULL DEFAULT '[]'");
    }
    await conn.run(SCHEMA_MARKER_SQL,[MARKER],false);
    await conn.run(SEED_LOCAL_ROW_SQL,[new Date().toISOString()],false);
    return conn;
  })().catch(error=>{nativeConnectionPromise=null;throw error;});
  return nativeConnectionPromise;
}
async function selectLocal(sql,values=[]){
  if(Capacitor.isNativePlatform()){
    const conn=await nativeDatabase();
    return (await conn.query(sql,values)).values||[];
  }
  return rowsOf(await webDatabase(),sql,values);
}
// Returns {changes, lastRows} -- lastRows only populated on native via a
// follow-up SELECT when the caller needs inserted/updated rows back (mirrors
// PostgREST's .select() chained after a write).
async function runLocal(sql,values=[]){
  if(Capacitor.isNativePlatform()){
    const conn=await nativeDatabase();
    const result=await conn.run(sql,values,false);
    return Number(result?.changes?.changes||0);
  }
  const db=await webDatabase();
  db.run(sql,values);
  const changes=db.getRowsModified();
  await writeWebBytes(db.export());
  return changes;
}
async function runBatchLocal(statements){
  // statements: [{sql,values}]; executed as one transaction, same semantics
  // as the Postgres management_write RPC being a single statement call.
  if(Capacitor.isNativePlatform()){
    const conn=await nativeDatabase();
    await conn.beginTransaction();
    try{
      let changes=0;
      for(const {sql,values} of statements){
        const result=await conn.run(sql,values,false);
        changes+=Number(result?.changes?.changes||0);
      }
      await conn.commitTransaction();
      return changes;
    }catch(error){await conn.rollbackTransaction();throw error;}
  }
  const db=await webDatabase();
  db.run('BEGIN');
  try{
    let changes=0;
    for(const {sql,values} of statements){
      db.run(sql,values);
      changes+=db.getRowsModified();
    }
    db.run('COMMIT');
    await writeWebBytes(db.export());
    return changes;
  }catch(error){db.run('ROLLBACK');throw error;}
}

// -- SQL identifier / value helpers --
const IDENT=/^[a-zA-Z_][a-zA-Z0-9_]*$/;
function quoteIdent(name){
  if(!IDENT.test(String(name||'')))throw new Error('Invalid column/table identifier: '+name);
  return '"'+name+'"';
}
// Only `silver.<name>` relations are ever asked for; the schema prefix is
// discarded (there is exactly one local schema) and the table must be one of
// ours -- anything else is a programming error, not a permission question
// (local has no multi-user permission model to enforce).
function tableName(table){
  const name=String(table||'').split('.').pop();
  if(!IDENT.test(name))throw new Error('Invalid table name: '+name);
  return name;
}
function toSqlValue(value){
  if(value===undefined||value===null)return null;
  if(typeof value==='boolean')return value?1:0;
  if(Array.isArray(value)||(typeof value==='object'))return JSON.stringify(value);
  return value;
}

// -- Parameterized local SQL filter compiler (including literal contains) --
function compileFilter(column,op,value){
  const col=quoteIdent(column);
  if(['statics','culture','search','trace','list','keyword','others','extract'].includes(column)&&
     (value==='true'||value==='false'))value=value==='true';
  switch(op){
    case 'eq':return value===null?{sql:col+' IS NULL',params:[]}:{sql:col+'=?',params:[toSqlValue(value)]};
    case 'neq':return value===null?{sql:col+' IS NOT NULL',params:[]}:{sql:col+'<>?',params:[toSqlValue(value)]};
    case 'gt':return {sql:col+'>?',params:[toSqlValue(value)]};
    case 'gte':return {sql:col+'>=?',params:[toSqlValue(value)]};
    case 'lt':return {sql:col+'<?',params:[toSqlValue(value)]};
    case 'lte':return {sql:col+'<=?',params:[toSqlValue(value)]};
    case 'like':return {sql:col+' LIKE ?',params:[String(value)]};
    case 'ilike':return {sql:'lower('+col+') LIKE lower(?)',params:[String(value)]};
    case 'contains':{
      const {fold,pattern}=portableContainsSpec(value);
      return {sql:(fold?'lower('+col+')':col)+" LIKE ? ESCAPE '!'",params:[pattern]};
    }
    case 'is':return {sql:col+(value===null?' IS NULL':value===true?'=1':'=0'),params:[]};
    case 'in':return {sql:col+' IN ('+(Array.isArray(value)?value:[value]).map(()=>'?').join(',')+')',
      params:(Array.isArray(value)?value:[value]).map(toSqlValue)};
    case 'not':{
      const compiled=compileFilter(column,value.op,value.value);
      return {sql:'NOT ('+compiled.sql+')',params:compiled.params};
    }
    default:throw new Error('Unsupported filter operator: '+op);
  }
}

function compileLocalOr(node){
  if(node.type==='predicate')return compileFilter(node.column,node.operator,node.value);
  if(node.type!=='and'&&node.type!=='or')throw new Error('Unsupported OR filter');
  const parts=node.items.map(compileLocalOr);
  return {sql:'('+parts.map(part=>part.sql).join(node.type==='and'?' AND ':' OR ')+')',
    params:parts.flatMap(part=>part.params)};
}

// -- Chainable query builder matching the subset of the Supabase JS client
//    actually used by db-contract.mjs / Culture.jsx / Statistics / Search.jsx --
function queryBuilder(table){
  const name=tableName(table);
  const state={select:'*',filters:[],order:null,limitN:null,rangeFrom:null,rangeTo:null,single:false,maybeSingle:false,countRequested:null,write:null,orFilters:[]};
  async function execute(){
    try{
      const where=[...state.filters.map(f=>compileFilter(f.column,f.op,f.value)),
        ...state.orFilters.map(compileLocalOr)];
      const whereSql=where.length?' WHERE '+where.map(w=>w.sql).join(' AND '):'';
      const params=where.flatMap(w=>w.params);
      if(state.write){
        const {kind,rows,values,onConflict}=state.write;
        if(kind==='insert'||kind==='upsert'){
          const list=Array.isArray(rows)?rows:[rows];
          if(!list.length)return {data:[],error:null,count:0};
          const statements=list.map(row=>{
            const cols=Object.keys(row);
            const params=cols.map(key=>toSqlValue(row[key]));
            const conflict=kind==='upsert'&&onConflict
              ?' ON CONFLICT('+quoteIdent(onConflict)+') DO UPDATE SET '+
                cols.filter(key=>key!==onConflict).map(key=>quoteIdent(key)+'=excluded.'+quoteIdent(key)).join(',')
              :'';
            return {sql:'INSERT INTO '+quoteIdent(name)+' ('+cols.map(quoteIdent).join(',')+') VALUES ('+
              cols.map(()=>'?').join(',')+')'+conflict,values:params};
          });
          const count=await runBatchLocal(statements);
          return {data:list,error:null,count};
        }
        if(!state.filters.length)throw new Error('SQLite write requires filters');
        const before=state.select!=='*'
          ?await selectLocal('SELECT '+state.select+' FROM '+quoteIdent(name)+whereSql,params)
          :[];
        if(kind==='update'){
          const cols=Object.keys(values||{});
          if(!cols.length)throw new Error('Empty update');
          const count=await runLocal('UPDATE '+quoteIdent(name)+' SET '+
            cols.map(col=>quoteIdent(col)+'=?').join(',')+whereSql,
            [...cols.map(col=>toSqlValue(values[col])),...params]);
          return {data:state.select==='*'?Array.from({length:count},()=>values):before.map(row=>({...row,...values})),
            error:null,count};
        }
        if(kind==='delete'){
          const count=await runLocal('DELETE FROM '+quoteIdent(name)+whereSql,params);
          return {data:state.select==='*'?Array.from({length:count},()=>({})):before,
            error:null,count};
        }
      }
      let sql='SELECT '+state.select+' FROM '+quoteIdent(name)+whereSql;
      if(state.order)sql+=' ORDER BY '+quoteIdent(state.order.column)+(state.order.ascending===false?' DESC':' ASC');
      const rangeApplied=state.rangeFrom!==null||state.limitN!==null;
      if(state.rangeFrom!==null){
        const count=(state.rangeTo!==null?state.rangeTo-state.rangeFrom+1:-1);
        sql+=' LIMIT '+(count>=0?count:-1)+' OFFSET '+state.rangeFrom;
      }else if(state.limitN!==null)sql+=' LIMIT '+state.limitN;
      const rows=await selectLocal(sql,params);
      const data=rows.map(decodeRow);
      if(state.single)return {data:data[0]||null,error:data.length===1?null:{message:'Expected exactly one row'}};
      if(state.maybeSingle)return {data:data[0]||null,error:null};
      // PostgREST's `count:'exact'` reports the TOTAL rows matching the
      // filters, ignoring range/limit -- callers like selectAllRows rely on
      // this to know when to stop paginating. When no range/limit is applied,
      // data.length already IS that total, so skip the extra query. When one
      // is applied, data.length would only be the current page's size, which
      // previously made selectAllRows under-paginate and silently drop rows
      // past the first page; run a separate COUNT(*) (same WHERE, no range).
      let total=data.length;
      if(state.countRequested&&rangeApplied){
        const countRows=await selectLocal('SELECT COUNT(*) AS n FROM '+quoteIdent(name)+whereSql,params);
        total=Number(countRows?.[0]?.n)||0;
      }
      return {data,error:null,count:total};
    }catch(error){return {data:null,error:{message:String(error?.message||error)}};}
  }
  const chain={
    select(columns,options){state.select=columns?String(columns).split(',').map(c=>quoteIdent(c.trim())).join(','):'*';if(options&&options.count)state.countRequested=options.count;return chain;},
    eq(col,val){state.filters.push({column:col,op:'eq',value:val});return chain;},
    neq(col,val){state.filters.push({column:col,op:'neq',value:val});return chain;},
    gt(col,val){state.filters.push({column:col,op:'gt',value:val});return chain;},
    gte(col,val){state.filters.push({column:col,op:'gte',value:val});return chain;},
    lt(col,val){state.filters.push({column:col,op:'lt',value:val});return chain;},
    lte(col,val){state.filters.push({column:col,op:'lte',value:val});return chain;},
    like(col,val){state.filters.push({column:col,op:'like',value:val});return chain;},
    ilike(col,val){state.filters.push({column:col,op:'ilike',value:val});return chain;},
    contains(col,val){state.filters.push({column:col,op:'contains',value:val});return chain;},
    or(expr){state.orFilters.push(parsePortableOrExpression(expr));return chain;},
    is(col,val){state.filters.push({column:col,op:'is',value:val});return chain;},
    in(col,val){state.filters.push({column:col,op:'in',value:val});return chain;},
    not(col,op,val){state.filters.push({column:col,op:'not',value:{op,value:val}});return chain;},
    order(col,opts={}){state.order={column:col,ascending:opts.ascending!==false};return chain;},
    limit(n){state.limitN=Number(n);return chain;},
    range(from,to){state.rangeFrom=Number(from);state.rangeTo=Number(to);return chain;},
    single(){state.single=true;return chain;},
    maybeSingle(){state.maybeSingle=true;return chain;},
    insert(rows){state.write={kind:'insert',rows};return chain;},
    upsert(rows,{onConflict}={}){state.write={kind:'upsert',rows,onConflict};return chain;},
    update(values){state.write={kind:'update',values};return chain;},
    delete(){state.write={kind:'delete'};return chain;},
    then(resolve,reject){return execute().then(resolve,reject);},
    catch(reject){return execute().catch(reject);},
    finally(done){return execute().finally(done);}
  };
  return chain;
}
// JSON/boolean columns round-trip through TEXT/INTEGER in SQLite; decode the
// handful of columns that are arrays/objects/booleans in the real Postgres
// schema so callers see the same shapes they'd get from Supabase.
const JSON_COLUMNS=new Set(['DefaultArticleClass','keyword_meta','search_aliases','block_entity','block_image',
  'target_id','media_link','anchor_ids','range','lists','uid_lists','runeslist']);
const BOOL_COLUMNS=new Set(['statics','culture','search','trace','list','keyword','others','extract','search_able','statistics_able','culture_able','keyword_class_share_enabled',
  'searchable','class_enable']);
function decodeRow(row){
  const out={...row};
  for(const key of Object.keys(out)){
    if(JSON_COLUMNS.has(key)&&typeof out[key]==='string'){
      try{out[key]=JSON.parse(out[key]);}catch{/* leave as-is */}
    }
    if(BOOL_COLUMNS.has(key))out[key]=Boolean(Number(out[key]));
  }
  return out;
}

// -- RPC dispatch: only the handful of `silver.*` functions the three
//    features (Culture/Statistics/Search) and db-contract.mjs actually call
//    are implemented locally; see db-contract.mjs's full rpc() call list. --
async function managementWriteLocal(payload){
  const {p_table:table,p_operation:op,p_rows:rows,p_values:values,p_filters:filters=[]}=payload||{};
  try{
    const name=tableName(table);
    if(op==='insert'){
      const list=Array.isArray(rows)?rows:[];
      if(!list.length)return {data:{count:0},error:null};
      const statements=list.map(input=>{
        // PostgreSQL fills UpdateTime on import; SQLite needs the same value.
        const row=name==='local_galaxy'&&input.UpdateTime==null
          ?{...input,UpdateTime:new Date().toISOString()}:input;
        const columns=Object.keys(row);
        return {sql:'INSERT INTO '+quoteIdent(name)+' ('+columns.map(quoteIdent).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',
          values:columns.map(c=>toSqlValue(row[c]))};
      });
      return {data:{count:await runBatchLocal(statements)},error:null};
    }
    if(op==='update_batch'){
      const list=Array.isArray(rows)?rows:[];
      const stamped=new Date().toISOString();
      const statements=list.map(row=>{
        const keys=Object.keys(row).filter(key=>key!=='uid');
        if(!/^[A-Za-z0-9]{8}$/.test(String(row.uid||''))||
          !keys.length||keys.some(key=>!['title','content','place_id','url','media_link'].includes(key)))
          throw Error('Invalid import update');
        const conditional=key=>key==='location'||key==='place_id';
        const sets=keys.map(key=>conditional(key)?
          quoteIdent(key)+'=CASE WHEN ('+quoteIdent(key)+" IS NULL OR trim("+quoteIdent(key)+")='') THEN ? ELSE "+quoteIdent(key)+' END':
          quoteIdent(key)+'=?');
        const checks=keys.map(key=>conditional(key)?
          '(('+quoteIdent(key)+" IS NULL OR trim("+quoteIdent(key)+")='') AND ? IS NOT NULL)":
          quoteIdent(key)+' IS NOT ?');
        return {
          sql:'UPDATE '+quoteIdent(name)+' SET '+sets.join(',')+',"UpdateTime"=? WHERE "uid"=? AND ('+checks.join(' OR ')+')',
          values:[...keys.map(key=>toSqlValue(row[key])),stamped,row.uid,
            ...keys.map(key=>toSqlValue(row[key]))]
        };
      });
      return {data:{count:statements.length?await runBatchLocal(statements):0},error:null};
    }
    if(op==='update'){
      if(!filters.length)throw new Error('filters are required');
      const columns=Object.keys(values||{});
      const where=filters.map(f=>compileFilter(f.column,f.operator||'eq',f.value));
      const sql='UPDATE '+quoteIdent(name)+' SET '+columns.map(c=>quoteIdent(c)+'=?').join(',')+' WHERE '+where.map(w=>w.sql).join(' AND ');
      const params=[...columns.map(c=>toSqlValue(values[c])),...where.flatMap(w=>w.params)];
      return {data:{count:await runLocal(sql,params)},error:null};
    }
    if(op==='delete'){
      if(!filters.length)throw new Error('filters are required');
      const where=filters.map(f=>compileFilter(f.column,f.operator||'eq',f.value));
      const sql='DELETE FROM '+quoteIdent(name)+' WHERE '+where.map(w=>w.sql).join(' AND ');
      return {data:{count:await runLocal(sql,where.flatMap(w=>w.params))},error:null};
    }
    throw new Error('unsupported operation');
  }catch(error){return {data:null,error:{message:String(error?.message||error)}};}
}
// Local equivalent of silver.read_scope_statistics: same output shape
// ({day,kind,category,item_count} rows) computed over local_galaxy instead
// of the dynamic cross-table Postgres aggregation.
async function readScopeStatisticsLocal({p_start,p_end,p_include_undated}) {
  const where=[],params=[];
  if(p_start){where.push("date(createtime, '+8 hours')>=?");params.push(p_start);}
  if(p_end){where.push("date(createtime, '+8 hours')<=?");params.push(p_end);}
  if(!p_include_undated)where.push('createtime IS NOT NULL');
  const articleWhere=["statics=1",...where].join(' AND ');
  const text=await selectLocal(`SELECT date(createtime, '+8 hours') AS day,
    'source' AS kind, coalesce(site,'') AS category, count(*) AS item_count
    FROM local_galaxy WHERE ${articleWhere} GROUP BY day,category ORDER BY day`,params);
  const rows=text.map(row=>({
    day:row.day||'',kind:'source',category:row.category||'',item_count:Number(row.item_count)||0
  }));
  const daily=new Map();
  for(const row of rows)daily.set(row.day,(daily.get(row.day)||0)+row.item_count);
  for(const [day,item_count] of daily)rows.push({day,kind:'total',category:'文字作品',item_count});
  return {data:rows,error:null};
}
// Collapse a Culture lane without downloading a full per-day histogram.
// Match silver.read_scope_category_totals: article eligibility + nonempty content,
// time window for articles and media, and the same {kind,category,item_count} rows.
async function readScopeCategoryTotalsLocal({p_start,p_end}={}){
  const clauses=[],params=[];
  if(p_start){clauses.push("date(createtime, '+8 hours')>=?");params.push(p_start);}
  if(p_end){clauses.push("date(createtime, '+8 hours')<=?");params.push(p_end);}
  const range=clauses.length?' AND '+clauses.join(' AND '):'';
  const articles=await selectLocal(`SELECT 'source' AS kind, trim(coalesce(site,'')) AS category,
    count(*) AS item_count FROM local_galaxy
    WHERE culture=1 AND content<>''${range} GROUP BY category`,params);
  return {data:articles.map(row=>({...row,item_count:Number(row.item_count)||0})),error:null};
}
async function readScopeEarliestLocal(){
  const rows=await selectLocal("SELECT min(date(createtime, '+8 hours')) AS earliest FROM local_galaxy WHERE createtime IS NOT NULL");
  return {data:rows[0]?.earliest||null,error:null};
}
async function readScopeOverviewLocal({p_start,p_end}){
  const [stats,earliest,settings]=await Promise.all([
    readScopeStatisticsLocal({p_start,p_end,p_include_undated:false}),
    readScopeEarliestLocal(),
    selectLocal("SELECT DefaultArticleClass FROM local WHERE id='local' LIMIT 1")
  ]);
  let values=[];
  try{values=JSON.parse(settings[0]?.DefaultArticleClass||'[]');}catch{/* Default to an empty list. */}
  const taxonomy=sourceTaxonomyFromArrays(values);
  return {data:{earliest:earliest.data,rows:stats.data,
    categories:taxonomy.categories,aliases:taxonomy.aliases},error:null};
}

// Local equivalent of api.read_keyword_class: no scope_id, no share-permission
// gate (there is only one local reader), just the class's rows in order.
// Public metadata is returned without the article UID lists or private Item rules.
async function readKeywordTreeCatalogLocal({p_class_uid=null}={}){
  const config=await selectLocal("SELECT current_keyword_class_uid FROM local WHERE id='local'");
  const uid=String(p_class_uid||config[0]?.current_keyword_class_uid||'');
  if(!uid)return {data:{class_uid:'',rows:[]},error:null};
  const rows=(await selectLocal('SELECT uid,type,name,"desc",lists,uid_lists FROM local_keywords')).map(decodeRow);
  const {descendantsOfKeyword}=await import('../keyword-tree.mjs');
  const nodes=descendantsOfKeyword(rows,uid);
  return {data:{class_uid:uid,rows:nodes.map(node=>({
    uid:node.uid,type:node.type,name:node.name,desc:node.desc,
    lists:node.type==='item'?[]:node.lists,uid_lists:[]
  }))},error:null};
}
async function readSharedKeywordClassesLocal(){
  // Local SQLite owns its own Scope: category identity is the Class UID.
  const nodes=await selectLocal("SELECT uid,name FROM local_keywords WHERE type='class' ORDER BY name");
  return {data:nodes.map(node=>({
    scopeId:'local',classUid:String(node.uid),name:String(node.name),category:String(node.uid)
  })),error:null};
}
async function readKeywordClassLocal({p_class_uid}={}){
  const result=await readKeywordTreeCatalogLocal({p_class_uid});
  return {data:result.data?.class_uid===p_class_uid?result.data:null,error:null};
}
async function readKeywordTreeSummaryLocal({p_class_uid=null,p_start=null,p_end=null,p_source=null}={}){
  const config=await selectLocal(
    "SELECT current_keyword_class_uid,keyword_meta,staticstime FROM local WHERE id='local'");
  const row=config[0]||{},uid=String(p_class_uid||row.current_keyword_class_uid||'');
  let meta={};
  try{meta=typeof row.keyword_meta==='string'?JSON.parse(row.keyword_meta||'{}'):row.keyword_meta||{};}
  catch{meta={};}
  const {keywordClassState}=await import('../keyword-class-state.mjs');
  if(!uid||!keywordClassState({...row,keyword_meta:meta},uid))
    return {data:[],error:null};
  const sql=`
    WITH
    settings AS (SELECT ? AS class_uid,? AS start_day,? AS end_day,? AS source),
    active_class AS (
      SELECT c.lists FROM local_keywords c,settings s
      WHERE c.uid=s.class_uid AND c.type='class'
    ),
    groups AS (
      SELECT g.uid,g.name,g.lists,g.uid_lists
      FROM active_class c JOIN json_each(c.lists) member
      JOIN local_keywords g ON g.uid=member.value AND g.type='group'
    ),
    items AS (
      SELECT i.uid AS item_uid,g.uid AS group_uid,i.uid_lists
      FROM groups g JOIN json_each(g.lists) member
      JOIN local_keywords i ON i.uid=member.value AND i.type='item'
    ),
    group_hits AS (
      SELECT g.uid AS group_uid,article.uid AS article_uid,
        date(article.createtime,'+8 hours') AS day
      FROM groups g JOIN json_each(CASE WHEN json_type(g.uid_lists)='array' THEN g.uid_lists ELSE json_extract(g.uid_lists,'$.articles') END) hit
      JOIN local_galaxy article ON article.uid=hit.value
      JOIN settings s
      WHERE article.keyword=1
        AND (s.start_day IS NULL OR date(article.createtime,'+8 hours')>=s.start_day)
        AND (s.end_day IS NULL OR date(article.createtime,'+8 hours')<=s.end_day)
        AND (s.source IS NULL OR article.site=s.source)
    ),
    item_hits AS (
      SELECT i.item_uid,i.group_uid,article.uid AS article_uid,
        date(article.createtime,'+8 hours') AS day,
        CAST(json_extract(hit.value,'$.times') AS INTEGER) AS times
      FROM items i JOIN json_each(CASE WHEN json_type(i.uid_lists)='array' THEN i.uid_lists ELSE json_extract(i.uid_lists,'$.hits') END) hit
      JOIN local_galaxy article ON article.uid=json_extract(hit.value,'$.uid')
      JOIN settings s
      WHERE article.keyword=1
        AND (s.start_day IS NULL OR date(article.createtime,'+8 hours')>=s.start_day)
        AND (s.end_day IS NULL OR date(article.createtime,'+8 hours')<=s.end_day)
        AND (s.source IS NULL OR article.site=s.source)
    )
    SELECT 'eligible' AS kind,NULL AS item_key,NULL AS group_uid,
      '' AS day,COUNT(DISTINCT article_uid) AS hit_count,
      COUNT(DISTINCT article_uid) AS document_count FROM group_hits
    UNION ALL SELECT 'class_day',NULL,group_uid,day,COUNT(DISTINCT article_uid),
      COUNT(DISTINCT article_uid) FROM group_hits GROUP BY group_uid,day
    UNION ALL SELECT 'item',item_uid,group_uid,'',SUM(times),
      COUNT(DISTINCT article_uid) FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid
    UNION ALL SELECT 'item_day',item_uid,group_uid,day,SUM(times),
      COUNT(DISTINCT article_uid) FROM item_hits WHERE times>0 GROUP BY item_uid,group_uid,day
    UNION ALL SELECT 'keyword_all_day',NULL,NULL,day,COUNT(DISTINCT article_uid),
      COUNT(DISTINCT article_uid) FROM item_hits WHERE times>0 GROUP BY day
    UNION ALL SELECT 'group_items_day',NULL,group_uid,day,COUNT(DISTINCT article_uid),
      COUNT(DISTINCT article_uid) FROM item_hits WHERE times>0 GROUP BY group_uid,day
  `;
  const result=await selectLocal(sql,[uid,p_start,p_end,p_source]);
  return {data:result,error:null};
}
export async function restoreKeywordLibraryFromDefault(defaultRows=[]){
  const {indexKeywordTree}=await import('../keyword-tree.mjs');
  indexKeywordTree(defaultRows);
  const statements=[{sql:'DELETE FROM local_keywords',values:[]}];
  for(const row of defaultRows)statements.push({
    sql:'INSERT INTO local_keywords(uid,type,name,"desc",lists,uid_lists) VALUES(?,?,?,?,?,?)',
    values:[row.uid,row.type,row.name,row.desc,
      JSON.stringify(row.lists),JSON.stringify(row.type==='group'?{articles:row.uid_lists}:row.type==='item'?{hits:row.uid_lists}:{})]
  });
  const first=defaultRows.find(row=>row.type==='class')?.uid||null;
  statements.push({sql:"UPDATE local SET current_keyword_class_uid=?,keyword_meta='{}',staticstime=NULL WHERE id='local'",
    values:[first]});
  return runBatchLocal(statements);
}

async function saveArchiveMediaExifLocal({p_scope_id,p_rows}={}){
  try{
    if(p_scope_id!=='local')throw new Error('Invalid local EXIF scope');
    if(!Array.isArray(p_rows)||p_rows.length>200)throw new Error('EXIF batch exceeds 200 entries');
    const statements=[];
    for(const item of p_rows){
      const id=String(item?.media_uid||''),archive=String(item?.archive_id||'');
      const path=String(item?.entry_path||'');
      const lat=item.latitude??null,lng=item.longitude??null;
      const valid=(lat===null&&lng===null)||
        (Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180);
      if((id&&!/^[A-Za-z0-9]{8}$/.test(id))||!archive||!path||archive.length>400||
          path.length>2048||!valid)throw new Error('Invalid local archive EXIF metadata');
      if(lat===null&&!item.camera_local_time)continue;
      if(id){
        const exists=await selectLocal('SELECT uid FROM local_galaxy_media WHERE uid=? LIMIT 1',[id]);
        if(!exists.length)throw new Error('EXIF media is not registered');
      }
      statements.push({sql:`INSERT INTO local_archive_media_exif
        (archive_id,entry_path,media_id,platform,latitude,longitude,camera_local_time,imported_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(archive_id,entry_path) DO UPDATE SET
          media_id=excluded.media_id,platform=coalesce(excluded.platform,platform),
          latitude=coalesce(excluded.latitude,latitude),
          longitude=coalesce(excluded.longitude,longitude),
          camera_local_time=coalesce(excluded.camera_local_time,camera_local_time),
          imported_at=excluded.imported_at`,
        values:[archive,path,id||null,item.platform||null,lat,lng,item.camera_local_time||null,new Date().toISOString()]});
    }
    const count=statements.length?await runBatchLocal(statements):0;
    return {data:count,error:null};
  }catch(error){return {data:null,error:{message:String(error?.message||error)}};}
}

// Device-private SQLite actions use direct functions, not stored procedures.
async function localAnalytics(args={}){
  const options=args.p_options||{},params={
    p_scope_id:args.p_scope_id,p_start:args.p_start,p_end:args.p_end
  };
  switch(args.p_view){
    case 'daily':return readScopeStatisticsLocal({...params,p_include_undated:Boolean(options.includeUndated)});
    case 'totals':return readScopeCategoryTotalsLocal(params);
    case 'overview':return readScopeOverviewLocal(params);
    case 'earliest':return readScopeEarliestLocal(params);
    case 'keyword_summary':return readKeywordTreeSummaryLocal({...params,p_class_uid:options.classUid,p_source:options.source});
    case 'keyword_catalog':return readKeywordTreeCatalogLocal({p_class_uid:options.classUid});
    case 'shared_classes':return readSharedKeywordClassesLocal(params);
    default:return {data:null,error:{message:'Unsupported local analytics view'}};
  }
}

function schemaClient(){
  return {
    from(table){return queryBuilder(table);},
    analytics(args){return localAnalytics(args);},
    managedWrite(payload){return managementWriteLocal(payload);}
  };
}

// auth stub: a local device has exactly one always-signed-in "account"; no
// OAuth round trip is possible or necessary against a SQLite file.
const LOCAL_SESSION={user:{id:'local-device',email:null},access_token:'local'};
const localAuth={
  async getSession(){return {data:{session:LOCAL_SESSION},error:null};},
  async signInWithOAuth(){return {data:{session:LOCAL_SESSION},error:null};},
  async signOut(){return {error:null};}
};

export function createLocalSqliteAdapter(){
  const client={schema:()=>schemaClient()};
  return {publicClient:client,authClient:client,auth:localAuth};
}
