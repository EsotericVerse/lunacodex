import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {literalItemWords,scopeDatabaseUid,readScopePatternRows,
  ensureScopePatternLibrary,storeScopePatternMatches,scopePatternScanClocks,
  SCOPE_PATTERN_INDEX_VERSION} from '../app/loc/keyword-anchor-index.mjs';
import {indexZModelAnchorHierarchy} from '../zenstack/anchor-hierarchy.mjs';

// Minimal Kysely contract simulator; no database credentials or SQL string
// interpolation. Verify existing Item words, Pattern shares and UID postings.
function fakeDatabase(initial){
  const store=new Map(Object.entries(initial).map(([name,rows])=>
    [name,rows.map(row=>structuredClone(row))]));
  const copy=value=>structuredClone(value);
  const data=table=>{
    if(!store.has(table))store.set(table,[]);
    return store.get(table);
  };
  const match=(row,conditions)=>conditions.every(([k,op,v])=>{
    if(op==='=')return row[k]===v;
    if(op==='in')return v.includes(row[k]);
    throw Error('Unimplemented query '+op);
  });
  return {
    tables:store,
    selectFrom(table){
      let keys=null,limit=Infinity;const filters=[];
      const query={
        select(names){keys=Array.isArray(names)?names:[names];return query;},
        where(k,op,v){filters.push([k,op,v]);return query;},
        limit(n){limit=n;return query;},
        async execute(){return data(table).filter(row=>match(row,filters)).slice(0,limit)
          .map(row=>keys===null?copy(row):Object.fromEntries(
            keys.map(k=>[k,copy(row[k])])));},
        async executeTakeFirst(){return (await query.execute())[0]||null;}
      };
      return query;
    },
    insertInto(table){
      let incoming=[];let conflict=false;
      const q={
        values(rows){incoming=(Array.isArray(rows)?rows:[rows]).map(copy);return q;},
        onConflict(cb){
          cb({column:()=>({doUpdateSet:fn=>fn({ref:x=>x})})});
          conflict=true;return q;
        },
        async execute(){
          for(const item of incoming){
            const previous=data(table).find(row=>row.uid===item.uid);
            if(previous&&!conflict)throw Error('Duplicate Anchor UID');
            if(previous)Object.assign(previous,item);
            else data(table).push(item);
          }
        }
      };
      return q;
    },
    deleteFrom(table){
      const clauses=[];
      const q={where(k,op,v){clauses.push([k,op,v]);return q;},
        async execute(){
          store.set(table,data(table).filter(row=>!match(row,clauses)));
        }};
      return q;
    }
  };
}
const DB='DB000001',DB2='DB000002';
const base=()=>fakeDatabase({
  'silver.loc_anchor':[
    {uid:DB,type:'database',title:'Native'},
    {uid:'MAP00001',type:'table',title:'silver.demo_galaxy',
      attr:{database_uid:DB,mapping:{uid:'uid'}}}
  ],
  'silver.demo_anchor':[
    {uid:'ITM00001',type:'item',title:'水',attr:{keyword:['火','水','水AND土']}},
    {uid:'ITM00002',type:'item',title:'水土',attr:{keyword:['火','風']}}
  ]
});

test('owner Mapping resolves DB UID, never derives it from the Scope ID',async()=>{
  const db=base();
  assert.equal(await scopeDatabaseUid(db,'demo'),DB);
  await assert.rejects(()=>scopeDatabaseUid(db,'other'),/Mapping/);
});
test('Pattern terms exclude instructions and share the same UID across Items',async()=>{
  const db=base();
  assert.deepEqual(literalItemWords({title:'水',attr:{keyword:['火','水AND土']}}),
    ['水','火']);
  const x=await ensureScopePatternLibrary(db,'demo',DB);
  assert.equal(x.created,4);
  assert.equal(x.linked,2);
  const nodes=db.tables.get('silver.demo_anchor');
  const patterns=nodes.filter(row=>row.type==='pattern');
  const items=nodes.filter(row=>row.type==='item');
  assert.deepEqual(patterns.map(row=>row.title).sort(),['水','水土','火','風'].sort());
  const fire=patterns.find(row=>row.title==='火');
  assert.ok(items.every(item=>JSON.parse(item.attr).keyword.length>0));
  assert.ok(items.every(item=>JSON.parse(item.attr).uid.includes(fire.uid)));
  const graph=indexZModelAnchorHierarchy(nodes.map(row=>({
    uid:row.uid,type:row.type,title:row.title,attr:typeof row.attr==='string'
      ?JSON.parse(row.attr):row.attr
  })),{family:'keyword'});
  assert.equal(graph.parentsOf(fire.uid).length,2);
  const rerun=await ensureScopePatternLibrary(db,'demo',DB);
  assert.equal(rerun.created,0);
  assert.equal(rerun.linked,0);
});
test('Postings are scoped to database UID; number is per distinct article',async()=>{
  const db=base();
  await ensureScopePatternLibrary(db,'demo',DB);
  const first=await storeScopePatternMatches(db,'demo',DB,[
    {pattern:'火',count:2,uid_list:['ART00001','ART00002']}]);
  assert.equal(first.changed,1);
  const row=db.tables.get('silver.demo_anchor').find(row=>row.title==='火');
  assert.equal(row.num,2);
  assert.deepEqual(JSON.parse(row.attr)[DB],['ART00001','ART00002']);
  await storeScopePatternMatches(db,'demo',DB2,[
    {pattern:'火',count:1,uid_list:['ART00001']}]);
  assert.equal(row.num,3);
  assert.equal(Object.keys(JSON.parse(row.attr)).length,2);
  const native=await readScopePatternRows(db,'demo',DB);
  assert.equal(native.find(p=>p.pattern==='火').count,2);
  await assert.rejects(()=>storeScopePatternMatches(db,'demo',DB,[
    {pattern:'火',count:2,uid_list:['ART00001','ART00001']}]),/not consistent/);
});
test('autocomplete is typed and routed; no client can submit arbitrary SQL',()=>{
  const server=readFileSync(new URL('../app/loc/keyword-anchor-search.mjs',import.meta.url),'utf8');
  const endpoint=readFileSync(new URL('../functions/api/keywords.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  assert.match(server,/q=q\\.where\\('place_id','=',uid\\)/);
  assert.match(server,/type==='date'/);
  assert.match(server,/sourceValues\.push/);
  assert.match(server,/attrs\(row\)\[dbUid\]/);
  assert.match(endpoint,/verifiedIdentity\(request,context\.env\)/);
  assert.match(ui,/from 'react-select'/);
  assert.match(ui,/executeAnchorSelection\(choice\)/);
  assert.match(ui,/executeAnchorSelection\(active\.anchorSelection/);
});

test('Keyword HTTP boundary awaits the native Kysely connection before accessing db',()=>{
  const endpoint=readFileSync(new URL('../functions/api/keywords.js',import.meta.url),'utf8');
  assert.match(endpoint,/const entry=await directMcpKysely\(context\.env\)/);
  assert.match(endpoint,/const db=entry\.db/);
  assert.doesNotMatch(endpoint,/const entry=directMcpKysely\(context\.env\)/);
});

test('public Anchor suggestions are gated by the Scope publication flag',()=>{
  const server=readFileSync(new URL('../app/loc/keyword-anchor-search.mjs',import.meta.url),'utf8');
  assert.match(server,/select\(\['keyword_meta','search'\]\)/);
  assert.match(server,/published:settings\?\.search===true/);
  assert.match(server,/if\(!owner&&!visible\.published\)continue/);
  assert.match(server,/if\(settings\?\.search!==true\)err\('This Scope does not publish Search',403\)/);
});

test('old scan timestamps cannot skip first native Scope Pattern backfill',()=>{
  const legacy={pattern_scans:{'水':'2026-11-08T00:00:00.000Z'},
    by_class:{CL000001:{completedAt:'2026-11-08T00:00:00.000Z'}}};
  assert.deepEqual(scopePatternScanClocks(legacy),{});
  const native={...legacy,pattern_index_version:SCOPE_PATTERN_INDEX_VERSION};
  assert.deepEqual(scopePatternScanClocks(native),legacy.pattern_scans);
  const service=readFileSync(new URL('../app/loc/keyword-sql-service.mjs',import.meta.url),'utf8');
  assert.match(service,/patternScans:scopePatternScanClocks\(cfg\.keyword_meta\)/);
  assert.match(service,/baseMeta=alreadyNative\?oldMeta:\{\.\.\.oldMeta,by_class:\{\},pattern_scans:\{\}\}/);
  assert.match(service,/pattern_index_version:SCOPE_PATTERN_INDEX_VERSION/);
  const stats=readFileSync(new URL('../app/modular/modules/statistics/KeywordPatternSummary.jsx',import.meta.url),'utf8');
  assert.match(stats,/if\(data\.indexPending\)/);
});
