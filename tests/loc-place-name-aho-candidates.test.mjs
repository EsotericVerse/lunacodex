import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchPlaceNameCandidates,placeCandidateKey}
  from '../app/loc/trace/place-name-candidates.mjs';
import {createImportPlaceIndex,prepareImportPlaceAnchors}
  from '../app/loc/import/place-anchors.mjs';

test('Aho place candidates find both substring directions and a stored alias in one batch',()=>{
  assert.equal(placeCandidateKey('臺北 車站'),placeCandidateKey('台北車站'));
  const known=[
    {uid:'AAAA0001',title:'台北車站地下街',aliases:['台北地下街']},
    {uid:'AAAA0002',title:'台北車站'},
    {uid:'AAAA0003',title:'台南車站'}
  ];
  const matches=matchPlaceNameCandidates([
    {key:'short',name:'臺北車站'},
    {key:'long',name:'台北車站地下街東出口'},
    {key:'alias',name:'台北地下街入口'},
    {key:'other',name:'高雄港'},
    {key:'too-short',name:'台'}
  ],known);
  assert.ok(matches.get('short').some(hit=>hit.uid==='AAAA0001'));
  assert.ok(matches.get('long').some(hit=>hit.uid==='AAAA0002'));
  assert.ok(matches.get('alias').some(hit=>hit.uid==='AAAA0001'));
  assert.equal(matches.has('other'),false);
  assert.equal(matches.has('too-short'),false);
  assert.deepEqual(matchPlaceNameCandidates([{key:'one',name:'台北車站地下街'}],known,
    {maxCandidates:1}).get('one').map(hit=>hit.uid),['AAAA0001']);
});

test('import reports name-only overlaps but keeps exact UID/coordinate keys authoritative',async()=>{
  const place=createImportPlaceIndex();
  place.accept({uid:'AAAA0001',type:'point',title:'台北車站地下街',
    attr:{location:['台北地下街']}});
  const snapshot={scopeId:'sample',table:'silver.sample_anchor',place};
  const options={scopeId:'sample',relation:()=>{throw Error('no extra SQL expected');},
    createMissing:false,anchorSnapshot:snapshot};
  const advisory=await prepareImportPlaceAnchors([
    {location:'台北車站',createtime:'2026-11-01T00:00:00Z'}
  ],options);
  assert.equal(advisory.reused,0);
  assert.equal(advisory.created,0);
  assert.equal(advisory.byName.has('台北車站'),false);
  assert.deepEqual(advisory.nameCandidates.map(item=>item.saved_uids),[['AAAA0001']]);
  assert.equal(advisory.knownPointUids.has('AAAA0001'),true);
  const exact=await prepareImportPlaceAnchors([{location:'台北車站地下街'}],options);
  assert.equal(exact.reused,1);
  assert.equal(exact.byName.get('台北車站地下街'),'AAAA0001');
  assert.deepEqual(exact.nameCandidates,[]);
});

test('name candidates are review-only, not import identity or automatic Trace rename',()=>{
  const importer=readFileSync(new URL('../app/loc/import/place-anchors.mjs',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../app/loc/import/ManagementImportPanel.jsx',import.meta.url),'utf8');
  const organizer=readFileSync(new URL('../app/loc/trace/Organizer.jsx',import.meta.url),'utf8');
  assert.match(importer,/nameCandidates/);
  assert.match(importer,/const uid=coordinates\?byCoordinate\?\.get\(coordinates\):byName\?\.get\(name\)/);
  assert.match(panel,/僅供人工核對，不作為 place_id 證據/);
  assert.match(organizer,/nameOverlapPairs/);
  assert.match(organizer,/never enter the automatic\/bulk rename selection/);
});
