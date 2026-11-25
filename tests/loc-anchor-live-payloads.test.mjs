import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAnchorFeatureQuery} from '../app/loc/model/anchor-feature-queries.mjs';



test('source taxonomy is LOC-global only, never a Scope anchor source',()=>{
  const body={kind:'query',operation:'anchor-feature',
    family:'source',scope:'loc',result:'rows'};
  assert.equal(parseAnchorFeatureQuery(body).family,'source');
  assert.throws(()=>parseAnchorFeatureQuery({...body,scope:'lo3rwang'}),
    /Invalid Anchor feature selection/);
  assert.throws(()=>parseAnchorFeatureQuery({...body,scope:'lrunes'}),
    /Invalid Anchor feature selection/);
  assert.throws(()=>parseAnchorFeatureQuery({...body,scope:'loc',family:'time'}),
    /Invalid Anchor feature selection/);
});

