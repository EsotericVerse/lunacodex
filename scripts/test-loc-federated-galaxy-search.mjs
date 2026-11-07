import test from 'node:test';
import assert from 'node:assert/strict';
import {
  federatedDatasetsFor,indexTargetForScope,federatedScopeFromQuery,isFederatedTextSearch,
  isDatasetQualifiedArticleRead,publicGalaxyGate,mergeFederatedGalaxyRows
} from '../app/loc/providers/federated-galaxy-search.mjs';
import {locGlobalUid} from '../zenstack/global-identity.mjs';

const registry=JSON.stringify({lo3rwang:[
  {databaseId:'db1',provider:'custom',engine:'mysql',connection_alias:'archive'},
  {databaseId:'db2',provider:'custom',engine:'postgres',connection_alias:'recent'}
]});
const sources=federatedDatasetsFor(registry,'lo3rwang');
const request=(offset=0,limit=21,descending=false)=>({
  kind:'query',operation:'select',schema:'silver',table:'lo3rwang_galaxy',
  columns:['uid','title','date','search'],filters:[
    {column:'search',operator:'eq',value:true},
    {column:'content',operator:'contains',value:'時間定錨'}
  ],
  or:[],orders:[{column:'date',ascending:!descending}],
  offset,limit,indexHint:{scopeId:'lo3rwang',query:'時間定錨'}
});
const rows={
  db1:[
    {uid:'Ab123456',title:'Old article',date:'2019-01-01',search:true},
    {uid:'Cd123456',title:'2019 article',date:'2019-12-30',search:true},
    {uid:'Ef123456',title:'Oldest 2020',date:'2020-01-01',search:true}
  ],
  db2:[
    {uid:'Ab123456',title:'New article; same UID',date:'2020-02-01',search:true},
    {uid:'Qr123456',title:'Newest',date:'2026-01-01',search:true}
  ]
};
function reader(data=rows,seen=[]){
  return async(source,query)=>{
    seen.push({databaseId:source.databaseId,query});
    assert.deepEqual(query.filters.slice(0,2),request().filters);
    return data[source.databaseId].slice(query.offset,query.offset+query.limit);
  };
}
test('trusted registry is generic across SQL engines and separates DB identity from vendor',()=>{
  assert.deepEqual(sources.map(x=>x.databaseId),['db1','db2']);
  assert.deepEqual(sources.map(x=>x.target.engine),['mysql','postgres']);
  assert.deepEqual(sources.map(x=>x.target.connection_alias),['archive','recent']);
  assert.equal(federatedDatasetsFor('', 'lo3rwang').length,0);
  assert.deepEqual(federatedDatasetsFor(registry,'lrunes'),[]);
});
test('all post-commit index updates use their stable registered databaseId',()=>{
  const target=indexTargetForScope(registry,'lo3rwang',
    {connection_alias:'archive',engine:'mysql',provider:'custom'});
  assert.equal(target.dataset_id,'db1');
  assert.equal(target.connection_alias,'archive');
  const different=indexTargetForScope(registry,'lo3rwang',
    {connection_alias:'recent',engine:'postgres',provider:'custom'});
  assert.equal(different.dataset_id,'db2');
  assert.equal(indexTargetForScope(registry,'lo3rwang',
    {connection_alias:'unregistered',engine:'mysql',provider:'custom'}),null);
  const existing={connection_alias:'supabase_current',engine:'postgres'};
  assert.equal(indexTargetForScope('', 'lo3rwang',existing),existing);
});

test('invalid or colliding dataset registrations are rejected',()=>{
  assert.throws(()=>federatedDatasetsFor('{oops','lo3rwang'),/Invalid federated/);
  assert.throws(()=>federatedDatasetsFor(JSON.stringify({lo3rwang:[
    {databaseId:'db1',provider:'custom',engine:'mysql',connection_alias:'archive'},
    {databaseId:'db1',provider:'custom',engine:'mysql',connection_alias:'other'}
  ]}),'lo3rwang'),/Duplicate federated/);
  assert.throws(()=>federatedDatasetsFor(JSON.stringify({lo3rwang:[
    {databaseId:'db1',provider:'custom',engine:'mysql',connection_alias:'archive'},
    {databaseId:'db2',provider:'custom',engine:'mysql',connection_alias:'archive'}
  ]}),'lo3rwang'),/Duplicate federated/);
  assert.throws(()=>federatedDatasetsFor(JSON.stringify({lo3rwang:[
    {databaseId:'DB1',provider:'custom',engine:'mysql',connection_alias:'archive'}
  ]}),'lo3rwang'),/Invalid federated/);
});
test('federated text and qualified exact-UID reads are separate actions',()=>{
  assert.equal(federatedScopeFromQuery(request()),'lo3rwang');
  assert.equal(isFederatedTextSearch(request()),true);
  assert.equal(isFederatedTextSearch({...request(),indexHint:null}),false);
  assert.equal(isFederatedTextSearch({...request(),filters:[]}),false);
  assert.equal(isDatasetQualifiedArticleRead({
    kind:'query',operation:'select',schema:'silver',table:'lo3rwang_galaxy',
    filters:[{column:'uid',operator:'eq',value:'Ab123456'}]
  }),true);
  assert.equal(isDatasetQualifiedArticleRead({...request(),filters:[]}),false);
  assert.equal(isDatasetQualifiedArticleRead({
    kind:'query',operation:'delete',schema:'silver',table:'lo3rwang_galaxy',
    filters:[{column:'uid',operator:'eq',value:'Ab123456'}]
  }),false);
});
test('LOC Auth grant and Galaxy search/list predicates work without native RLS',()=>{
  const listQuery={
    kind:'query',schema:'silver',table:'lo3rwang_galaxy',operation:'select',
    expectedDbId:'db1',filters:[{column:'uid',operator:'eq',value:'Ab123456'}]
  };
  assert.equal(publicGalaxyGate(request(),'anon',{}),true);
  assert.equal(publicGalaxyGate(listQuery,'anon',{}),'list');
  const claims={provider:'loc',me:true,grants:['lo3rwang:read']};
  assert.equal(publicGalaxyGate(request(),'authenticated',claims),true);
  assert.equal(publicGalaxyGate(listQuery,'authenticated',claims),'list');
  assert.equal(publicGalaxyGate(request(),'authenticated',{
    provider:'loc',me:true,grants:['lo3rwang:manage']}),false);
  assert.equal(publicGalaxyGate(listQuery,'authenticated',{
    provider:'loc',me:true,grants:['global:manage']}),false);
  assert.equal(publicGalaxyGate({...request(),table:'lo3rwang_anchor'},'anon',{}),false);
});

test('unqualified UID details and full-content SELECTs require list permission without RLS',()=>{
  const uidRead={kind:'query',schema:'silver',table:'lo3rwang_galaxy',
    operation:'select',columns:['uid','title','content'],
    filters:[{column:'uid',operator:'eq',value:'Ab123456'}]};
  assert.equal(publicGalaxyGate(uidRead,'anon',{}),'list');
  assert.equal(publicGalaxyGate({...uidRead,columns:['uid','title']},'anon',{}),'list');
  assert.equal(publicGalaxyGate({...uidRead,columns:['*'],filters:[]},'anon',{}),'list');
  const textSearch=request();
  assert.equal(publicGalaxyGate({...textSearch,columns:['uid','title','date']},'anon',{}),true);
  assert.equal(publicGalaxyGate({...textSearch,columns:['uid','content']},'anon',{}),'list');
  assert.equal(publicGalaxyGate(uidRead,'authenticated',{
    provider:'loc',me:true,grants:['lo3rwang:read']
  }),'list');
});

test('cross-DB search preserves duplicate UID as two independent articles',async()=>{
  const data=await mergeFederatedGalaxyRows(sources,request(0,8),reader());
  assert.deepEqual(data.data.map(x=>x.title),[
    'Old article','2019 article','Oldest 2020',
    'New article; same UID','Newest'
  ]);
  const duplicate=data.data.filter(x=>x.uid==='Ab123456');
  assert.equal(duplicate.length,2);
  assert.notEqual(duplicate[0].__db_id,duplicate[1].__db_id);
  assert.deepEqual(duplicate.map(x=>x.__global_uid),[
    locGlobalUid({databaseId:'db1',scopeId:'lo3rwang',uid:'Ab123456'}),
    locGlobalUid({databaseId:'db2',scopeId:'lo3rwang',uid:'Ab123456'})
  ]);
});
test('global offset, not per-database offset, gives stable consecutive pages',async()=>{
  const first=await mergeFederatedGalaxyRows(sources,request(0,3),reader());
  const second=await mergeFederatedGalaxyRows(sources,request(3,3),reader());
  assert.deepEqual([...first.data,...second.data].map(x=>x.title),[
    'Old article','2019 article','Oldest 2020','New article; same UID','Newest'
  ]);
});
test('descending global ordering uses the original SQL ordering and date',async()=>{
  const desc=Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,[...v].reverse()]));
  const result=await mergeFederatedGalaxyRows(sources,request(0,6,true),reader(desc));
  assert.deepEqual(result.data.map(x=>x.title),[
    'Newest','New article; same UID','Oldest 2020','2019 article','Old article'
  ]);
});
test('progresses beyond per-source batch boundary without dropping or repeating results',async()=>{
  const many=Object.fromEntries(['db1','db2'].map((key,index)=>[
    key,Array.from({length:85},(_,i)=>({
      uid:String.fromCharCode(65+index)+String(i).padStart(7,'0'),
      title:key+':'+i,date:'2024-'+String(1+index*6+Math.floor(i/31)).padStart(2,'0')+
        '-'+String(1+i%31).padStart(2,'0')
    }))
  ]));
  const called=[];
  const result=await mergeFederatedGalaxyRows(sources,request(76,22),reader(many,called));
  assert.equal(result.data.length,22);
  assert.equal(new Set(result.data.map(x=>x.__global_uid)).size,22);
  assert.ok(called.some(x=>x.query.offset===40));
  assert.ok(called.every(x=>x.query.limit===40));
});
test('NULL dates sort last in both directions across mixed SQL engines',async()=>{
  const example={
    db1:[{uid:'Ab123456',title:'Historic',date:'2018-01-01'},
      {uid:'Cd123456',title:'Undated',date:null}],
    db2:[{uid:'Ef123456',title:'Recent',date:'2024-02-01'}]
  };
  const ascending=await mergeFederatedGalaxyRows(sources,request(0,5),reader(example));
  assert.deepEqual(ascending.data.map(x=>x.title),['Historic','Recent','Undated']);
  assert.ok(ascending.data.every(x=>x.__federated===true));
  const descendingData={...example,db1:[...example.db1]};
  const descending=await mergeFederatedGalaxyRows(sources,request(0,5,true),
    reader(descendingData));
  assert.deepEqual(descending.data.map(x=>x.title),['Recent','Historic','Undated']);
});

test('unavailable source fails the federated request rather than returning a false complete page',async()=>{
  await assert.rejects(()=>mergeFederatedGalaxyRows(sources,request(),async(source)=>{
    if(source.databaseId==='db2')throw Error('source unavailable');
    return rows.db1;
  }),/source unavailable/);
});
test('unbounded pagination is explicitly rejected rather than silently truncating',async()=>{
  await assert.rejects(()=>mergeFederatedGalaxyRows(sources,request(2000,21),reader()),/bounded global window/);
});
