import test from 'node:test';
import assert from 'node:assert/strict';
import {importSourceCategories} from '../app/loc/import/source-categories.mjs';

test('import source choices render while permission or the source snapshot is pending',()=>{
  assert.deepEqual(importSourceCategories(false,undefined),{system:[],personal:[]});
  assert.deepEqual(importSourceCategories(true,undefined),{system:[],personal:[]});
});

test('import source choices use the published From nodes and add Others once',()=>{
  assert.deepEqual(importSourceCategories(true,{categories:['Threads','Facebook','Threads']}),{
    system:['Threads','Facebook','Others'],personal:[]
  });
  assert.deepEqual(importSourceCategories(true,{categories:[]}),{system:[],personal:[]});
});
