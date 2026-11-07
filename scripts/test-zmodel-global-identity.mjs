import test from 'node:test';
import assert from 'node:assert/strict';
import {locGlobalUid,parseLocGlobalUid,locGlobalRowRef} from '../zenstack/global-identity.mjs';

const uid='Ab12Cd34';
test('the same local UID across databases or Scopes is not the same article',()=>{
  const dbA=locGlobalUid({databaseId:'db01',scopeId:'lo3rwang',uid});
  const dbB=locGlobalUid({databaseId:'db02',scopeId:'lo3rwang',uid});
  const scopeB=locGlobalUid({databaseId:'db01',scopeId:'lrunes',uid});
  assert.notEqual(dbA,dbB);
  assert.notEqual(dbA,scopeB);
  assert.deepEqual(parseLocGlobalUid(dbA),{databaseId:'db01',scopeId:'lo3rwang',uid});
  assert.equal(locGlobalRowRef({uid},{databaseId:'db01',scopeId:'lo3rwang'}),dbA);
});
test('local Base62 UID retains case and is never silently renumbered',()=>{
  const a=locGlobalUid({databaseId:'db01',scopeId:'lo3rwang',uid:'Ab12Cd34'});
  const b=locGlobalUid({databaseId:'db01',scopeId:'lo3rwang',uid:'aB12Cd34'});
  assert.notEqual(a,b);
  assert.equal(parseLocGlobalUid(a).uid,'Ab12Cd34');
});
test('untrusted database aliases and malformed keys never enter an index',()=>{
  const base={databaseId:'db01',scopeId:'lo3rwang',uid};
  for(const databaseId of ['','postgresql://secret','db:01','../db','DB01'])
    assert.throws(()=>locGlobalUid({...base,databaseId}),/Invalid LOC database ID/);
  for(const scopeId of ['','LOC','bad:scope','../'])
    assert.throws(()=>locGlobalUid({...base,scopeId}),/Invalid LOC Scope ID/);
  for(const local of ['','abc','abc/defg','ABCDEF9:', 'Ab12Cd345'])
    assert.throws(()=>locGlobalUid({...base,uid:local}),/Invalid LOC UID/);
  for(const malformed of ['db01:lo3rwang','db01:lo3rwang:Ab12Cd34:extra','db01:lo3rwang:invalid'])
    assert.throws(()=>parseLocGlobalUid(malformed),/Invalid LOC/);
});
