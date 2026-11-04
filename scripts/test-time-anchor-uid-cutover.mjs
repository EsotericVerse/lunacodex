import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateTimeUid,decodeTimeSegments,encodeTimeSegment,isTimeUid} from '../app/loc/time-anchor-ranges.mjs';

test('Time graph keeps eight-character, case-sensitive Base62 UIDs',()=>{
  assert.equal(isTimeUid('aB09ZxK1'),true);
  assert.equal(isTimeUid('AB09ZXK1'),true);
  assert.equal(isTimeUid('0001'),false);
  assert.equal(isTimeUid('aB09ZxK!'),false);
  assert.deepEqual(encodeTimeSegment('aB09ZxK1','aB09ZxK2'),['aB09ZxK1','aB09ZxK2']);
  assert.deepEqual(decodeTimeSegments(['aB09ZxK1','aB09ZxK2']).map(x=>[x.start,x.end]),[['aB09ZxK1','aB09ZxK2']]);
});

test('Time allocation reuses the secure shared Anchor UID generator',()=>{
  const seen=new Set(['aB09ZxK1']);
  for(let i=0;i<32;i++){
    const uid=allocateTimeUid([...seen].map(x=>({uid:x})));
    assert.match(uid,/^[A-Za-z0-9]{8}$/);
    assert.equal(seen.has(uid),false);
    seen.add(uid);
  }
});
