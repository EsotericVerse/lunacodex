import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareImportPlaceAnchors,importedPlaceId,recordImportPlaceVisits} from '../app/loc/import-place-anchors.mjs';

const named=(name,lat,lng)=>({__importPlaceName:name,__importCoordinates:{latitude:lat,longitude:lng}});
function memoryTrace(initial=[],scopeId='lo3rwang'){
  const rows=initial.map(row=>({...row,type:'point',attr:row.address
    ?{longitude:row.address[0],latitude:row.address[1]}:{}}));
  let inserts=0;
  const relation=table=>{
    assert.equal(table,'silver.'+scopeId+'_anchor');
    return {
      select:()=>({eq:(key,val)=>({order:()=>({range:async(start,end)=>({
        data:rows.filter(row=>row[key]===val).slice(start,end+1),error:null
      })})})}),
      insert:batch=>({select:async()=>{
        inserts+=batch.length;
        const saved=batch.map(row=>({...row,address:row.attr.longitude===undefined
          ?null:[row.attr.longitude,row.attr.latitude]}));
        rows.push(...saved);
        return {data:saved.map(({uid,type,title,attr})=>({uid,type,title,attr})),error:null};
      }})
    };
  };
  return {relation,rows,get inserts(){return inserts;}};
}

test('Trace reuses exact coordinates even with different names; distant same names remain distinct',async()=>{
  const db=memoryTrace([{uid:'AB12abcd',title:'人工整理地點',address:[121.49086,25.05338]}]);
  const far=named('人工整理地點',25.9,121.9);
  const spaced=named('  人工整理地點 ',null,null);
  const otherNameSameCoords=named('其他名稱',25.05338,121.49086);
  const result=await prepareImportPlaceAnchors([far,spaced,otherNameSameCoords],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:false
  });
  assert.equal(result.reused,2);
  assert.equal(result.created,0);
  assert.equal(db.inserts,0);
  assert.equal(importedPlaceId({incoming:far,byName:result.byName,byCoordinate:result.byCoordinate}),null);
  assert.equal(importedPlaceId({incoming:spaced,byName:result.byName}),'AB12abcd');
  assert.equal(importedPlaceId({incoming:otherNameSameCoords,byName:result.byName,byCoordinate:result.byCoordinate}),'AB12abcd');
});

test('different source names with the identical GPS pair share one new Trace anchor',async()=>{
  const db=memoryTrace();
  const a=named('舊地名',25.02,121.55),b=named('新地名',25.02,121.55);
  const result=await prepareImportPlaceAnchors([a,b],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(result.created,1);
  assert.equal(db.inserts,1);
  assert.equal(importedPlaceId({incoming:a,byName:result.byName,byCoordinate:result.byCoordinate}),
    importedPlaceId({incoming:b,byName:result.byName,byCoordinate:result.byCoordinate}));
});

test('the article location text is the name when no source place name exists',async()=>{
  const db=memoryTrace([{uid:'AB12abcd',title:'商店',address:[121.5,25.04]}]);
  const record={location:'商店'};
  const result=await prepareImportPlaceAnchors([record],{scopeId:'lo3rwang',relation:db.relation});
  assert.equal(importedPlaceId({incoming:record,byName:result.byName}),'AB12abcd');
});

test('native Point reads reuse 8-character UIDs and never insert duplicated coordinates',async()=>{
  const db=memoryTrace([{uid:'AbCd1234',title:'原地點',address:[121.49086,25.05338]}]);
  const old=named('另個稱呼',25.05338,121.49086);
  const first=await prepareImportPlaceAnchors([old],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(first.created,0);
  assert.equal(first.reused,1);
  assert.equal(db.inserts,0);
  assert.equal(importedPlaceId({incoming:old,byName:first.byName,byCoordinate:first.byCoordinate}),'AbCd1234');
});

test('lrunes Point import writes eight-character UIDs to lrunes_anchor',async()=>{
  const db=memoryTrace([],'lrunes');
  const place=named('符文打卡',24.99,121.55);
  const saved=await prepareImportPlaceAnchors([place],{
    scopeId:'lrunes',relation:db.relation,createMissing:true
  });
  assert.equal(saved.created,1);
  assert.match(db.rows[0].uid,/^[A-Za-z0-9]{8}$/);
  assert.equal(db.rows[0].type,'point');
  const again=await prepareImportPlaceAnchors([place],{
    scopeId:'lrunes',relation:db.relation,createMissing:true
  });
  assert.equal(again.created,0);
  assert.equal(again.reused,1);
  assert.equal(db.inserts,1);
});

test('native Point insert returns case-sensitive Base62 UIDs across scopes',async()=>{
  const db=memoryTrace();
  const saved=await prepareImportPlaceAnchors([named('有 GPS',25,121)],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(saved.created,1);
  assert.equal(db.rows[0].type,'point');
  assert.match(db.rows[0].uid,/^[A-Za-z0-9]{8}$/);
  assert.deepEqual(db.rows[0].attr,{longitude:121,latitude:25});
});

test('new distinct named coordinates create separate Trace anchors without losing GPS',async()=>{
  const db=memoryTrace([{uid:'AAAAaaaa',title:'台北車站',address:[121.5170,25.0478]}]);
  const station=named('台北車站',25.05,121.52);
  const cafeA=named(' 咖啡 店',25.1,121.6);
  const cafeB=named('咖啡 店',25.2,121.7);
  const nameOnly=named('只有名稱',null,null);
  const result=await prepareImportPlaceAnchors([station,cafeA,cafeB,nameOnly],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(db.inserts,4);
  assert.equal(result.created,4);
  assert.equal(result.unmatchedCoordinates,0);
  const cafes=db.rows.filter(row=>row.title==='咖啡 店');
  assert.equal(cafes.length,2);
  assert.deepEqual(cafes.map(row=>[row.attr.longitude,row.attr.latitude]),[[121.6,25.1],[121.7,25.2]]);
  assert.equal(cafes[0].invisible,false);
  const stationUid=importedPlaceId({incoming:station,byName:result.byName,byCoordinate:result.byCoordinate});
  assert.ok(stationUid&&stationUid!=='AAAAaaaa');
  const cafeUid=importedPlaceId({incoming:cafeA,byName:result.byName,byCoordinate:result.byCoordinate});
  assert.ok(cafeUid);
  const cafeOther=importedPlaceId({incoming:cafeB,byName:result.byName,byCoordinate:result.byCoordinate});
  assert.ok(cafeOther&&cafeOther!==cafeUid);
  assert.ok(importedPlaceId({incoming:nameOnly,byName:result.byName}));
  const again=await prepareImportPlaceAnchors([cafeA],{scopeId:'lo3rwang',relation:db.relation,createMissing:true});
  assert.equal(again.created,0);
  assert.equal(db.inserts,4);
});

test('reversed insert response still maps the correct Trace UID to each coordinate',async()=>{
  const db=memoryTrace();
  const relation=table=>{
    const api=db.relation(table);
    return {...api,insert:rows=>({select:async()=>{
      const result=await api.insert(rows).select('uid,type,title,attr');
      return {...result,data:[...result.data].reverse()};
    }})};
  };
  const a=named('重名地點',25.1,121.1),b=named('重名地點',25.2,121.2);
  const resolved=await prepareImportPlaceAnchors([a,b],{
    scopeId:'lo3rwang',relation,createMissing:true
  });
  const uidA=importedPlaceId({incoming:a,byName:resolved.byName,byCoordinate:resolved.byCoordinate});
  const uidB=importedPlaceId({incoming:b,byName:resolved.byName,byCoordinate:resolved.byCoordinate});
  assert.equal(resolved.created,2);
  assert.ok(uidA&&uidB&&uidA!==uidB);
  assert.deepEqual(db.rows.find(x=>x.uid===uidA).attr,{longitude:121.1,latitude:25.1});
  assert.deepEqual(db.rows.find(x=>x.uid===uidB).attr,{longitude:121.2,latitude:25.2});
});

test('a new named place without coordinates is created with a null address',async()=>{
  const db=memoryTrace();
  const result=await prepareImportPlaceAnchors([named('新地點',null,null)],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(result.created,1);
  assert.equal(db.inserts,1);
  assert.equal(result.unmatchedCoordinates,0);
  assert.deepEqual(db.rows[0].attr,{});
});

test('old control characters in location normalize only the Trace label, not Galaxy text',async()=>{
  const db=memoryTrace();
  const raw={location:'台北\u001F車站'};
  const result=await prepareImportPlaceAnchors([raw],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(result.created,1);
  assert.equal(db.rows[0].title,'台北 車站');
  assert.equal(raw.location,'台北\u001F車站');
  assert.ok(importedPlaceId({incoming:raw,byName:result.byName}));
});

test('an existing article place_id is never overwritten',async()=>{
  const db=memoryTrace([{uid:'AB12abcd',title:'existing',address:[121.5,25.04]}]);
  const record=named('existing',25.04,121.5);
  const result=await prepareImportPlaceAnchors([record],{scopeId:'lo3rwang',relation:db.relation});
  assert.equal(importedPlaceId({incoming:record,existing:{place_id:'AB13abcd'},byName:result.byName}),null);
  assert.equal(importedPlaceId({incoming:record,existing:{place_id:null},byName:result.byName,byCoordinate:result.byCoordinate}),'AB12abcd');
});

test('local import and missing Trace table do not block article import',async()=>{
  const fail=()=>{throw Error('No database call expected');};
  const local=await prepareImportPlaceAnchors([named('地點',25,121)],{scopeId:'local',relation:fail});
  assert.equal(local.created,0);
  assert.equal(local.unmatchedCoordinates,1);
  const relation=()=>({select:()=>({eq:()=>({order:()=>({range:async()=>({
    data:null,error:{code:'42P01',message:'missing'}
  })})})})});
  const missing=await prepareImportPlaceAnchors([named('地點',25,121)],{
    scopeId:'lo3rwang',relation,allowMissing:true,createMissing:false
  });
  assert.equal(missing.skipped,1);
  assert.equal(missing.unmatchedCoordinates,1);
});

test('anchor import reports a read-only scan without inserting rows',async()=>{
  const db=memoryTrace();
  const states=[];
  await prepareImportPlaceAnchors([named('地點',25.05,121.6)],{
    scopeId:'lo3rwang',relation:db.relation,createMissing:false,onProgress:state=>states.push(state)
  });
  assert.deepEqual(states.map(p=>[p.phase,p.completed,p.total]),[
    ['讀取現有空間定錨',0,0],
    ['讀取現有空間定錨',0,0],
    ['建立原始座標定錨',0,0]
  ]);
  assert.equal(db.inserts,0);
});

test('reimports reconcile both existing and new article anchors',async()=>{
  const {readFileSync}=await import('node:fs');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/prepareImportPlaceAnchors\(\[\.\.\.anchorRecords,\.\.\.geoAnchorRecords\]/);
  assert.match(panel,/if\(restoredPlace\)changes\.place_id=restoredPlace/);
  assert.match(panel,/prepareImportTimeAnchors\(\[\.\.\.checkinAnchorRecords,\.\.\.geoAnchorRecords\]/);
});

test('check-in times are merged into the anchor times array: sorted, no duplicates, no empty writes',async()=>{
  const updates=[];
  const relation=table=>({update:values=>({eq:(c1,v1)=>({eq:async(c2,v2)=>{
    updates.push({table,values,uid:v1,type:v2});return {error:null};
  }})})});
  const timesByUid=new Map([['AB12abcd',['2024-07-02T00:00:00.000Z']],['CD34abcd',[]]]);
  const first=await recordImportPlaceVisits([
    {uid:'AB12abcd',time:'2024-07-03T00:00:00Z'},
    {uid:'AB12abcd',time:'2024-07-01T00:00:00Z'},
    {uid:'AB12abcd',time:'2024-07-02T00:00:00Z'},
    {uid:'AB12abcd',time:'2024-07-03T00:00:00.000Z'},
    {uid:'CD34abcd',time:'2024-08-01T00:00:00Z'},
    {uid:'BAD',time:'2024-08-01T00:00:00Z'},
    {uid:'CD34abcd',time:'not a date'}
  ],{relation,table:'silver.lo3rwang_trace',timesByUid});
  assert.deepEqual(first,{updated:2,added:3});
  assert.deepEqual(updates[0].values.times,[
    '2024-07-01T00:00:00.000Z','2024-07-02T00:00:00.000Z','2024-07-03T00:00:00.000Z']);
  assert.deepEqual(updates[1].values.times,['2024-08-01T00:00:00.000Z']);
  assert.equal(updates[0].type,'space_anchor');
  const again=await recordImportPlaceVisits([{uid:'AB12abcd',time:'2024-07-01T00:00:00Z'}],
    {relation,table:'silver.lo3rwang_trace',timesByUid});
  assert.deepEqual(again,{updated:0,added:0});
  assert.equal(updates.length,2);
  await assert.rejects(()=>recordImportPlaceVisits([{uid:'AB12abcd',time:'2025-01-01T00:00:00Z'}],{
    relation:()=>({update:()=>({eq:()=>({eq:async()=>({error:{message:'denied'}})})})}),
    table:'silver.lo3rwang_trace',timesByUid
  }),/補齊打卡時間中斷.*denied/);
});

test('the panel records existing and imported check-in times without double-adding old articles',async()=>{
  const {readFileSync}=await import('node:fs');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/\.\.\.placeVisits,/);
  assert.match(panel,/newArticleVisits\.filter\(visit=>result\.insertedUids\.has\(visit\.articleUid\)\)/);
  assert.match(panel,/recordImportPlaceVisits\(savedVisits,\{/);
  assert.ok(panel.indexOf('recordImportPlaceVisits(savedVisits')>panel.indexOf('await flushNewArticles();\n      const savedVisits'));
});

test('import progress touches the edit Session, so a long read-only comparison phase cannot idle-lock mid-import',async()=>{
  const {readFileSync}=await import('node:fs');
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/import \{touchEditorSession\} from '\.\/edit-session-ttl\.mjs';/);
  assert.match(panel,/if\(!nativeLocal\)try\{touchEditorSession\(window\.sessionStorage\);\}catch\{\}/);
  // The touch must live inside showProgress itself, not only at one call site,
  // since the comparison phase's only hook into run() is its onProgress callback.
  const progressStart=panel.indexOf('const showProgress=');
  const progressTouch=panel.indexOf('touchEditorSession(window.sessionStorage)',progressStart);
  assert.ok(progressTouch>progressStart);
  assert.ok(progressTouch<panel.indexOf('setProgress({stage,completed,total,',progressStart));
});

test('reconciliation keeps current main Galaxy title for meaningful Time-anchor summaries',async()=>{
  const {readFileSync}=await import('node:fs');
  const reconcile=readFileSync(new URL('../app/loc/reconcile-import-anchors.mjs',import.meta.url),'utf8');
  assert.match(reconcile,/\.select\('uid,title,location,place_id,date,createtime'\)/);
});

test('visit repairs use at most six concurrent writes and show final-stage progress',async()=>{
  const visits=Array.from({length:25},(_,i)=>({
    uid:(i+1).toString(16).toUpperCase().padStart(8,'0'),
    time:'2026-11-01T04:30:00Z'
  }));
  const timesByUid=new Map(visits.map(item=>[item.uid,[]]));
  const updates=[],progress=[];
  let active=0,maxActive=0;
  const relation=()=>({
    update:values=>({
      eq:(column,uid)=>({
        eq:async()=>{
          active++;maxActive=Math.max(maxActive,active);
          await new Promise(resolve=>setTimeout(resolve,2));
          updates.push({uid,values});active--;
          return {error:null};
        }
      })
    })
  });
  const first=await recordImportPlaceVisits(visits,{
    relation,table:'silver.lo3rwang_trace',timesByUid,onProgress:value=>progress.push(value)
  });
  assert.deepEqual(first,{updated:25,added:25});
  assert.equal(updates.length,25);
  assert.equal(maxActive,6);
  assert.deepEqual(progress[0],{phase:'補齊定錨打卡時間',completed:0,total:25});
  assert.deepEqual(progress.at(-1),{phase:'補齊定錨打卡時間',completed:25,total:25});
  assert.ok(progress.every((item,i)=>i===0||item.completed>=progress[i-1].completed));
  const again=await recordImportPlaceVisits(visits,{
    relation,table:'silver.lo3rwang_trace',timesByUid
  });
  assert.deepEqual(again,{updated:0,added:0});
  assert.equal(updates.length,25);
});

test('partial visit-write failures report completed anchors and allow a deduped retry',async()=>{
  const visits=['00000001','00000002','00000003','00000004'].map(uid=>({
    uid,time:'2026-11-01T04:30:00Z'
  }));
  const timesByUid=new Map(visits.map(item=>[item.uid,[]]));
  let failedOnce=false;
  const write=fail=>()=>({
    update:values=>({
      eq:(column,uid)=>({
        eq:async()=>{
          if(fail&&uid==='00000003'&&!failedOnce){
            failedOnce=true;
            return {error:{message:'simulated interruption'}};
          }
          return {error:null};
        }
      })
    })
  });
  await assert.rejects(()=>recordImportPlaceVisits(visits,{
    relation:write(true),table:'silver.lo3rwang_trace',timesByUid
  }),/補齊打卡時間中斷.*simulated interruption/);
  const restarted=await recordImportPlaceVisits(visits,{
    relation:write(false),table:'silver.lo3rwang_trace',timesByUid
  });
  assert.ok(restarted.added>0);
  assert.ok(restarted.added<4,'previously persisted visit timestamps are not duplicated');
});

test('many independent name-only locations and GPS aliases keep exact matching semantics',async()=>{
  const db=memoryTrace();
  const records=Array.from({length:500},(_,i)=>({location:'地點'+i}));
  records.push(named('唯一同名點',25.05,121.51));
  records.push({location:'唯一同名點'});
  const resolved=await prepareImportPlaceAnchors(records,{
    scopeId:'lo3rwang',relation:db.relation,createMissing:true
  });
  assert.equal(resolved.created,501);
  assert.equal(db.inserts,501);
  assert.equal(importedPlaceId({incoming:{location:'唯一同名點'},
    byName:resolved.byName,byCoordinate:resolved.byCoordinate}),
    importedPlaceId({incoming:named('唯一同名點',25.05,121.51),
      byName:resolved.byName,byCoordinate:resolved.byCoordinate}));
});

test('empty visit batches return without needing a Trace write table',async()=>{
  const states=[];
  assert.deepEqual(await recordImportPlaceVisits([],{onProgress:state=>states.push(state)}),
    {updated:0,added:0});
  assert.deepEqual(states,[{phase:'補齊定錨打卡時間',completed:0,total:0}]);
});


test('unified Point collects all distinct visit instants across location aliases',async()=>{
  const attrsByUid=new Map([
    ['AB12abcd',{longitude:121.49,latitude:25.05,location:['A','B'],
      times:['2024-06-02T00:00:00.000Z']}],
    ['CD34abcd',{longitude:121.50,latitude:25.06}]
  ]);
  const timesByUid=new Map([...attrsByUid].map(([uid,attr])=>[uid,attr.times||[]]));
  const createtimeByUid=new Map([
    ['AB12abcd',null],['CD34abcd','2025-02-01T00:00:00.000Z']
  ]);
  const stored=new Map([...attrsByUid].map(([uid,attr])=>[uid,structuredClone(attr)]));
  const writes=[];
  const relation=table=>({
    update:values=>({
      eq:(key,uid)=>{
        assert.equal(key,'uid');
        assert.equal(table,'silver.lo3rwang_anchor');
        return {eq:(typeKey,type)=>{
          assert.equal(typeKey,'type');assert.equal(type,'point');
          return {eq:(attrKey,prior)=>{
            assert.equal(attrKey,'attr');
            return {select:async()=>{
              const old=stored.get(uid);
              if(!old||JSON.stringify(old)!==JSON.stringify(prior))
                return {data:[],error:null};
              stored.set(uid,structuredClone(values.attr));
              writes.push({uid,values});
              return {data:[{uid}],error:null};
            }};
          }};
        }};
      }
    })
  });
  const visits=[
    {uid:'AB12abcd',time:'2024-06-03T00:00:00Z'},
    {uid:'AB12abcd',time:'2024-06-01T00:00:00Z'},
    {uid:'AB12abcd',time:'2024-06-01T00:00:00Z'},
    {uid:'CD34abcd',time:'2025-06-01T00:00:00Z'},
    {uid:'BAD',time:'2026-01-01T00:00:00Z'}
  ];
  const options={relation,table:'silver.lo3rwang_anchor',
    attrsByUid,timesByUid,createtimeByUid};
  const first=await recordImportPlaceVisits(visits,options);
  assert.deepEqual(first,{updated:2,added:3});
  assert.deepEqual(stored.get('AB12abcd').location,['A','B']);
  assert.deepEqual(stored.get('AB12abcd').times,[
    '2024-06-01T00:00:00.000Z','2024-06-02T00:00:00.000Z','2024-06-03T00:00:00.000Z']);
  assert.deepEqual(stored.get('CD34abcd').times,['2025-06-01T00:00:00.000Z']);
  assert.equal(createtimeByUid.get('AB12abcd'),'2024-06-01T00:00:00.000Z');
  assert.equal(createtimeByUid.get('CD34abcd'),'2025-02-01T00:00:00.000Z');
  assert.equal(writes.find(row=>row.uid==='CD34abcd').values.createtime,undefined);
  assert.deepEqual(await recordImportPlaceVisits(visits,options),{updated:0,added:0});
  assert.equal(writes.length,2,'repeated repairs issue zero writes');
});

test('Point times are allowed only on the typed Point attr contract',async()=>{
  const {toAnchorRow,fromAnchorRow}=await import('../app/loc/unified-anchor-compat.mjs');
  const spec={kind:'trace',legacy:'trace'};
  const row=toAnchorRow(spec,{uid:'AB12abcd',type:'point',title:'合併地點',
    times:['2026-11-02T16:00:00+08:00','2026-11-02T08:00:00Z',
      '2026-11-03T08:00:00Z','invalid']});
  assert.deepEqual(row.attr.times,['2026-11-02T08:00:00.000Z','2026-11-03T08:00:00.000Z']);
  assert.deepEqual(fromAnchorRow(spec,row).times,row.attr.times);
  const migration=readFileSync(new URL('../supabase/migrations/20261106223000_point_attr_times_allowance.sql',
    import.meta.url),'utf8');
  assert.match(migration,/WHEN type='point'/);
  assert.match(migration,/attr - 'longitude' - 'latitude' - 'location' - 'times'/);
  assert.match(migration,/jsonb_typeof\(attr->'times'\)='array'/);
  const panel=readFileSync(new URL('../app/loc/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const reconcile=readFileSync(new URL('../app/loc/reconcile-import-anchors.mjs',import.meta.url),'utf8');
  assert.match(panel,/Point 造訪時間新增/);
  assert.match(reconcile,/place_id\.not\.is\.null/);
});

test('Point merge unions saved times and Galaxy timestamps before deleting source UIDs',()=>{
  const source=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const merge=source.slice(source.indexOf('async function mergeScopePoints('),
    source.indexOf('async function importSharedKeywordClass('));
  assert.match(merge,/jsonb_array_elements_text/);
  assert.match(merge,/g\.place_id=any/);
  assert.match(merge,/g\.createtime is not null/);
  assert.match(merge,/\{times\}/);
  assert.match(merge,/jsonb_set\(attr,'\{location\}'/);
  assert.ok(merge.indexOf('const sources=await sql')<merge.indexOf("set({place_id:keep})"));
});
