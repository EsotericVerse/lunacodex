import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {traceArticleIds,traceArticleLabels} from '../app/modular/features/trace/trace-article-ids.mjs';
import {compactPlaceName,placeNameKey,reviewPlaceNameGroups} from '../app/modular/features/trace/trace-place-names.mjs';
import {traceArticleIdFilters,groupedTraceDays} from '../app/modular/features/trace/trace-panel-filters.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const css=read('app/styles/settings-select.css');
const sql=read('supabase/migrations/20261026190000_single_trace_uid_cutover.sql');
const cleanup=read('supabase/migrations/20261026191000_article_links_single_trace_uid.sql');

test('anchor responsive changes do not overwrite shared management tabs',()=>{
  assert.ok(css.includes('container:scope-anchor-form / inline-size'));
  assert.ok(css.includes('@container scope-anchor-form (max-width: 39rem)'));
  assert.ok(css.includes('.scope-management-layout--anchor .management-workspace-panel .scope-management-fields'));
  assert.ok(css.includes('overflow-wrap:anywhere'));
});
test('one four-character UID per Trace row; exact lossless archive and Frame Queues',()=>{
  assert.ok(sql.includes('ALTER TABLE silver.lo3rwang_galaxy ADD COLUMN IF NOT EXISTS place_id varchar(4)'));
  assert.ok(sql.includes('ALTER TABLE silver.lrunes_galaxy ADD COLUMN IF NOT EXISTS place_id varchar(4)'));
  assert.ok(sql.includes('trace_uid_migration_backup'));
  assert.ok(sql.includes('ALTER TABLE silver.lo3rwang_trace ALTER COLUMN uid TYPE varchar(4)'));
  assert.ok(sql.includes('ALTER TABLE silver.lrunes_trace ALTER COLUMN uid TYPE varchar(4)'));
  assert.ok(sql.includes('ALTER TABLE silver.loc_trace ALTER COLUMN uid TYPE varchar(4)'));
  assert.ok(sql.includes('unnest(m.anchor_list) WITH ORDINALITY'));
  assert.ok(sql.includes('COUNT')||sql.includes('count(*)'));
  assert.doesNotMatch(sql,/UPDATE\s+silver\.(?:lo3rwang|lrunes)_galaxy/i);
  assert.ok(cleanup.includes('ALTER TABLE silver.lo3rwang_trace DROP COLUMN trace_id'));
  assert.ok(cleanup.includes('matched_uid varchar(4)'));
});
test('selected anchor or Frame Queue resolves Galaxy place_id from anchor uid only',()=>{
  const stops=[
    {uid:'0001',source_scope:'lo3rwang',trace_type:'anchor',title:'一樓'},
    {uid:'0002',source_scope:'lo3rwang',trace_type:'anchor',title:'二樓'},
    {uid:'0003',source_scope:'lrunes',trace_type:'anchor',title:'其他 Scope'}
  ];
  assert.deepEqual(traceArticleIds(stops[0],stops),['0001']);
  const frame={uid:'0100',source_scope:'lo3rwang',
    trace_type:'map',anchor_list:['0002','0001','0003']};
  assert.deepEqual(traceArticleIds(frame,stops),['0002','0001']);
  assert.equal(traceArticleLabels(stops[0]).get('0001'),'一樓');
  assert.deepEqual(traceArticleIdFilters(['0001']),[
    {column:'place_id',operator:'eq',value:'0001'},
    {column:'searchable',operator:'eq',value:true}
  ]);
  assert.deepEqual(traceArticleIdFilters(['0001','0002'])[0],
    {column:'place_id',operator:'in',value:['0001','0002']});
  assert.deepEqual(groupedTraceDays([
    {createtime:'2026-01-01T09:00:00+08:00',place_id:'0001',location:'舊名稱'},
    {createtime:'2026-01-01T10:00:00+08:00',place_id:'0001',location:'新名稱'}
  ],{key:'place_id'}),[{day:'2026-01-01',category:'0001',item_count:2}]);
});
test('Trace report queries indexed place_id in all views, not a place-text OR',()=>{
  const s=read('app/modular/features/trace/TracePlaceResults.jsx');
  assert.ok(s.includes('traceArticleIdFilters(placeIds'));
  assert.ok(s.includes("p_view:'trace_daily'"));
  assert.ok(s.includes("galaxyReadColumnsFor('GalaxyList','GalaxyUidAnchor')"));
  assert.ok(s.includes("column:'media_link',operator:'overlaps'"));
  assert.ok(!s.includes("columns:'uid,title,createtime,site,location,place_id,url'"));
  assert.ok(!s.includes('traceArticlePlaces('));
  assert.ok(!s.includes('traceArticleFilters(sourcePlaces'));
});

test('per-Scope persistent name aliases and archive protect merged identities',()=>{
 const sql=read('supabase/migrations/20261026223000_scope_place_names_and_merge.sql');
 assert.ok(sql.includes("ARRAY['lo3rwang','lrunes','loc']"));
 assert.ok(sql.includes('name_lists text[] NOT NULL'));
 assert.ok(sql.includes('merge_scope_trace_place_names'));
 assert.ok(sql.includes('trace_place_merge_archive'));
 assert.ok(sql.includes('WITH ORDINALITY'));
 assert.ok(sql.includes('search_scope_trace_place_names'));
 assert.doesNotMatch(sql,/SET\s+location\s*=/i);
 const ui=read('app/loc/TraceOrganizer.jsx');
 assert.ok(ui.includes('儲存已勾選（同一 Trace UID）'));
 assert.ok(ui.includes('runAutomatic'));
 assert.ok(ui.includes('save_scope_trace_place_names'));
});

test('name-only merge recognizes Facebook brand spacing and order while preserving first title',()=>{
 assert.equal(compactPlaceName('World Gym 永和店'),compactPlaceName('WorldGym永和店'));
 assert.equal(placeNameKey('World Gym 永和店'),placeNameKey('WorldGym 新北永和店'));
 assert.equal(placeNameKey('桂林家樂福店'),placeNameKey('家樂福桂林店'));
 const stamp=(uid,title,created_at,floor_label='')=>({uid,title,created_at,trace_type:'anchor',floor_label});
 const group=reviewPlaceNameGroups([
  stamp('0002','WorldGym 新北永和店','2025-01-02'),
  stamp('0001','World Gym 永和店','2024-01-01'),
  stamp('0003','家樂福桂林店','2025-01-03'),
  stamp('0004','桂林家樂福店','2024-01-02')
 ]);
 assert.equal(group.automatic.length,2);
 assert.equal(group.automatic.find(x=>x.key.startsWith('worldgym'))?.canonical.uid,'0001');
 assert.equal(group.automatic.find(x=>x.key.startsWith('家樂福'))?.canonical.uid,'0004');
 const floors=reviewPlaceNameGroups([
  stamp('0005','同名商店','2024-01-01','B1'),
  stamp('0006','同名商店','2024-02-01','2樓')
 ]);
 assert.equal(floors.automatic.length,0);
 assert.equal(floors.uncertain.length,1);
});
