import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {spatialReferenceCandidates,spatialReferenceLikePattern,spatialReferenceChoicesForName,spatialReferenceLabelVariants,spatialReferenceLabelKey} from '../app/modular/features/trace/trace-spatial-references.mjs';
import {facebookBackupPlace,facebookBackupTimestamp,facebookBackupImportUid,facebookArchiveGalaxyRow} from '../app/loc/facebook-backup-place.mjs';
import {mappedImportValue,parseImportCreatedTime} from '../app/loc/import-batch.mjs';
import {postalAddressFromNominatim} from '../app/modular/features/trace/trace-postal-evidence.mjs';

test('scope identity is not a shared UID',()=>{
  const base={uid:'TEST0001',scope_id:'loc',title:'某車站',longitude:121.5,latitude:25};
  const results=spatialReferenceCandidates([[base,{...base,scope_id:'lrunes'}],[base]]);
  assert.equal(results.length,2);
  assert.deepEqual(results.map(row=>row.source_scope),['loc','lrunes']);
});
test('no empty locations or unbounded result sets',()=>{
  const base={scope_id:'loc',title:'商店',longitude:121.5,latitude:25};
  const rows=Array.from({length:12},(_,i)=>({...base,uid:'A'+String(i).padStart(7,'0')}));
  assert.equal(spatialReferenceCandidates([rows]).length,8);
  assert.equal(spatialReferenceCandidates([[{...base,uid:'BLANK001',latitude:''}]]).length,0);
});
test('literal wildcards are not treated as patterns',()=>{
  assert.equal(spatialReferenceLikePattern('台'),'');
  assert.equal(spatialReferenceLikePattern('路%_'),'%路\\%\\_%');
});
test('facebook data-array place is retained while text alone is not guessed',()=>{
  assert.equal(facebookBackupPlace({data:[{place:{name:'某車站'}}]}),'某車站');
  assert.equal(facebookBackupPlace({data:[{post:'某車站'}]}),'');
  assert.equal(facebookBackupPlace({data:[{place:{name:'A'}},{place:{name:'B'}}]}),'');
});

test('plain Facebook source timestamps are Unix seconds, not 1970 milliseconds',()=>{
  const sample={timestamp:1720000000,place:{name:'某車站'}};
  assert.equal(typeof mappedImportValue(sample,'location'),'object');
  assert.equal(facebookBackupPlace(sample),'某車站');
  assert.equal(parseImportCreatedTime(mappedImportValue(sample,'createtime')),
    '2024-07-03T09:46:40.000Z');
});

test('geocoder does not invent a street number or floor from a place label',()=>{
  assert.equal(postalAddressFromNominatim({
    display_name:'某咖啡廳',
    address:{state:'新北市',suburb:'板橋區',road:'文化路一段'}
  }),'');
  assert.equal(postalAddressFromNominatim({
    address:{state:'新北市',suburb:'板橋區',road:'文化路一段',house_number:'100號'}
  }),'新北市板橋區文化路一段100號');
  assert.equal(postalAddressFromNominatim({address:{road:'文化路一段',house_number:'100號'}}),'');
});

test('text address is optional and needs no floor or city columns',()=>{
 const db=readFileSync(new URL('../app/modular/features/trace/trace-data.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../app/loc/TraceManagement.jsx',import.meta.url),'utf8');
 assert.match(db,/descriptionObject\(description,address\)/);
 assert.match(ui,/文字地址（非必填）/);
 assert.doesNotMatch(ui,/setFloorLevel|setFloorLabel|countyOptions/);
});

test('Meta explicitly labelled visited-place JSON preserves the check-in location and time',()=>{
  const encoded=value=>[...new TextEncoder().encode(value)].map(code=>String.fromCharCode(code)).join('');
  const record={
    fbid:'stable-facebook-visit',
    label_values:[
      {label:encoded('造訪時間'),timestamp_value:1720000000},
      {dict:[{title:encoded('地標'),dict:[{label:encoded('名稱'),value:encoded('板橋車站')}]}]}
    ]
  };
  assert.equal(facebookBackupPlace(record),encoded('板橋車站'));
  assert.equal(facebookBackupTimestamp(record),1720000000);
  assert.equal(facebookBackupImportUid(record),facebookBackupImportUid({...record}));
  assert.notEqual(facebookBackupImportUid(record),facebookBackupImportUid({...record,fbid:'another-place'}));
  assert.notEqual(facebookBackupImportUid(record),facebookBackupImportUid({...record,label_values:[...record.label_values.slice(0,1).map(item=>({...item,timestamp_value:1720086400})),...record.label_values.slice(1)]}));
  assert.equal(facebookBackupPlace({label_values:[{label:encoded('地點'),value:encoded('私人現居地')}] }),'');
});

test('existing Scope anchor is chosen by UID, not county',()=>{
 const ui=readFileSync(new URL('../app/loc/TraceManagement.jsx',import.meta.url),'utf8');
 assert.match(ui,/import ScopeOptionPicker/);
  assert.match(ui,/<ScopeOptionPicker /);
 assert.match(ui,/ownAnchors\.find\(item=>item\.uid===uid\)/);
 assert.match(ui,/onChange=\{choice=>pickExisting/);
 assert.doesNotMatch(ui,/county_id|setFloorLevel/);
});

test('same label, same 2D point, different UID/floors remain separate place choices',()=>{
  const rows=[
    {uid:'ANCH0001',source_scope:'loc',title:'同名店',floor_label:'B1',floor_level:-1,latitude:25,longitude:121.5},
    {uid:'ANCH0002',source_scope:'loc',title:'同名店',floor_label:'2樓',floor_level:2,latitude:25,longitude:121.5},
    {uid:'ANCH0001',source_scope:'lrunes',title:'同名店',floor_label:'5樓',floor_level:5,latitude:25,longitude:121.5}
  ];
  const selected=spatialReferenceChoicesForName('同名店',rows);
  assert.equal(selected.status,'review');
  assert.equal(selected.selected,-1);
  assert.deepEqual(selected.choices.map(v=>[v.source_scope,v.uid,v.floor_level]),[
    ['loc','ANCH0001',-1],['loc','ANCH0002',2],['lrunes','ANCH0001',5]]);
  assert.equal(selected.moreChoices,false);
});
test('many historical identities do not silently choose one of more than eight candidates',()=>{
  const rows=Array.from({length:12},(_,i)=>({
    source_scope:'loc',uid:'A'+String(i).padStart(7,'0'),
    title:'老店',latitude:25,longitude:121.5
  }));
  const lookup=spatialReferenceChoicesForName('老店',rows);
  assert.equal(lookup.choices.length,8);
  assert.equal(lookup.moreChoices,true);
  assert.equal(lookup.selected,-1);
});
test('anchor name autocomplete is local and geocoder-free',()=>{
 const ui=readFileSync(new URL('../app/loc/TraceManagement.jsx',import.meta.url),'utf8');
 assert.match(ui,/搜尋標題，或留空新增/);
 assert.doesNotMatch(ui,/searchTracePlaces|nominatim|photon|countyOptions/);
});

test('台/臺 is search-equivalent but recorded addresses and Scope UIDs stay unchanged',()=>{
  assert.deepEqual(spatialReferenceLabelVariants('台北車站'),['台北車站','臺北車站']);
  assert.equal(spatialReferenceLabelKey('臺北車站'),spatialReferenceLabelKey('台北車站'));
  const ref={uid:'AAAA0001',source_scope:'loc',title:'臺北車站',
    address:'臺北市中正區某路1號',longitude:121.5,latitude:25};
  const choices=spatialReferenceChoicesForName('台北車站',[ref]);
  assert.equal(choices.choices.length,1);
  assert.equal(choices.choices[0].uid,'AAAA0001');
  assert.equal(choices.choices[0].address,'臺北市中正區某路1號');
  const query=readFileSync(new URL('../app/modular/features/trace/trace-spatial-reference-data.js',import.meta.url),'utf8');
  assert.match(query,/spellings=\[\.\.\.new Set\(unique\.flatMap\(spatialReferenceLabelVariants\)\)\]/);
});

test('real Meta visited-places format uses OUTER 地標 title, not a nested title',()=>{
  const bytes=value=>[...new TextEncoder().encode(value)]
    .map(code=>String.fromCharCode(code)).join('');
  const visit={label_values:[
    {label:bytes('造訪時間'),timestamp_value:1720000000},
    {title:bytes('地標'),dict:[{dict:[{label:bytes('名稱'),value:bytes('某車站')}]}]}
  ]};
  assert.equal(facebookBackupPlace(visit),bytes('某車站'));
  assert.equal(facebookBackupPlace({label_values:visit.label_values.slice(1)}),'');
  assert.equal(facebookBackupPlace({label_values:[
    {label:bytes('地點'),dict:[{label:bytes('城市'),value:bytes('某地區')}]}
  ]}),'');
});

test('ZIP parser takes Facebook tagged visit time from explicit metadata, not GPS',()=>{
  const archive=readFileSync(new URL('../app/loc/private-archive-universal.mjs',import.meta.url),'utf8');
  assert.match(archive,/import \{facebookBackupPlace,facebookBackupTimestamp\}/);
  assert.match(archive,/platform==='facebook'&&actualKind==='post'\?facebookBackupTimestamp\(item\):null/);
  assert.doesNotMatch(archive,/timestamp\s*=\s*item\.longitude/);
});

test('Galaxy ZIP check-ins decode Meta mojibake without changing source visit identity',()=>{
  const encode=value=>[...new TextEncoder().encode(value)]
    .map(code=>String.fromCharCode(code)).join('');
  const record={
    platform:'facebook',kind:'post',key:'facebook:visit:encoded',
    sourcePlace:encode('板橋車站'),text:encode('今天來到板橋車站'),
    createdAt:'2024-07-03T09:46:40.000Z'
  };
  const converted=facebookArchiveGalaxyRow(record);
  assert.equal(converted.location,'板橋車站');
  assert.equal(converted.content,'今天來到板橋車站');
  assert.equal(converted.title,'今天來到板橋車站');
  assert.equal(converted.createtime,record.createdAt);
  assert.match(converted.uid,/^[A-Z0-9]{8}$/);
  assert.equal(converted.uid,facebookArchiveGalaxyRow(record).uid);
  const valid=facebookArchiveGalaxyRow({
    ...record,key:'facebook:visit:native',sourcePlace:'臺北車站',text:'正確繁體中文'
  });
  assert.equal(valid.location,'臺北車站');
  assert.equal(valid.content,'正確繁體中文');
});
