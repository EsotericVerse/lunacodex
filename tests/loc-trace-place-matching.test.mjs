import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPlaceNameCandidates,reviewPlaceNameGroups,placeNameTerms}
  from '../app/modular/features/trace/trace-place-names.mjs';
import {matchTimelineWindows,distanceInMeters}
  from '../app/loc/trace/timeline-place-matcher.mjs';

const point=(uid,title,lng,lat,extra={})=>({uid,title,address:[lng,lat],
  trace_type:'space_anchor',source_scope:'demo',...extra});
test('Place dictionary matches Chinese name containment and confirmed aliases without identity changes',()=>{
  const anchors=[
    point('1','臺北車站',121.5,25),
    point('2','台北車站地下街',121.5,25,{floor_level:-1}),
    point('3','北車',121.6,25,{attr:{location:['台北車站']}}),
    point('4','台北車站另一處',121.5,25,{source_scope:'other'}),
    point('5','路口',121.6,25,{attr:{location:'台北車站'}})
  ];
  const snapshot=JSON.stringify(anchors);
  const candidates=reviewPlaceNameCandidates(anchors);
  assert.deepEqual(candidates.map(c=>[c.a.uid,c.b.uid].sort().join(':')).sort(),['1:2','1:3','2:3']);
  const pair=candidates.find(c=>[c.a.uid,c.b.uid].sort().join(':')==='1:2');
  assert.equal(pair.samePosition,true);
  assert.equal(pair.sameFloor,false);
  assert.deepEqual(placeNameTerms(anchors[4]),['路口']);
  assert.equal(reviewPlaceNameGroups(anchors).automatic.length,0);
  assert.equal(JSON.stringify(anchors),snapshot);
});
test('Timeline spatial candidate grid is equivalent to the full distance scan',()=>{
  const anchors=[
    point('a','A',179.999,0),point('b','B',-179.999,0),
    point('c','C',-170,89.999),point('d','D',170,89.999),
    point('e','E',121.5,25),point('f','F',121.5,25),
    point('g','G',121.5,25.0045),point('h','H',121.5,25.0046),
    ...Array.from({length:500},(_,i)=>point('p'+i,'P'+i,
      ((i*137.507764)%360)-180,((i*53.781)%180)-90))
  ];
  const windows=[
    {lat:0,lng:180},{lat:89.999,lng:180},{lat:25,lng:121.5,uncertain:true},
    {lat:0,lng:0},...anchors.slice(8,100).map(a=>({lat:a.address[1],lng:a.address[0]}))
  ];
  for(const radius of [0,50,500,50000,20000000,Infinity]){
    const expected=windows.map(w=>anchors.map(a=>({uid:a.uid,title:a.title,
      distance:distanceInMeters(w,{lat:a.address[1],lng:a.address[0]})}))
      .filter(a=>a.distance<=radius).sort((a,b)=>a.distance-b.distance)
      .map(a=>({uid:a.uid,title:a.title,meters:Math.round(a.distance)})));
    const actual=matchTimelineWindows(windows,anchors,radius);
    assert.deepEqual(actual.windows.map(w=>w.candidates),expected.filter(c=>c.length));
    assert.equal(actual.withoutAnchor,expected.filter(c=>!c.length).length);
    assert.equal(actual.ambiguousWindows,expected.filter((c,i)=>c.length>1||(c.length&&windows[i].uncertain)).length);
  }
});
