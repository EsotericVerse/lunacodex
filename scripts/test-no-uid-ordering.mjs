import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const roots=['app/loc','app/modular','app/lrunes','supabase/functions','workers'];
const list=folder=>{
  const result=[];
  for(const entry of readdirSync(resolve(root,folder),{withFileTypes:true})){
    const name=join(folder,entry.name);
    if(entry.isDirectory())result.push(...list(name));
    else if(/\.(?:jsx?|mjs|tsx?|sql)$/.test(entry.name))result.push(name);
  }
  return result;
};
const executable=s=>s.split('\n')
  .filter(line=>!/^\s*(?:\/\/|\*|--)/.test(line)).join('\n');
const failSorts=[
  /\.(?:order|orderBy)\(\s*['"`](?:[a-z_]+\.)?uid['"`]/gi,
  /\bORDER\s+BY\b[^;\n]{0,150}\b(?:[a-z_]+\.)?uid\b/gi,
  /\b(?:orders|sort)\s*[:=][^;\n]{0,150}\bcolumn:\s*['"`]uid['"`]/gi
];
test('No UID-based order appears in active application/Edge/Worker query paths',()=>{
  const violations=[];
  for(const path of roots.flatMap(list)){
    const source=executable(readFileSync(resolve(root,path),'utf8'));
    for(const pattern of failSorts){
      pattern.lastIndex=0;
      for(const match of source.matchAll(pattern))
        violations.push(path+': '+match[0].slice(0,100));
    }
  }
  assert.deepEqual(violations,[]);
});
test('Latest corrective migration overrides all remaining live UID-sorting SQL RPCs',()=>{
  const file='supabase/migrations/20261105204000_remove_uid_ordering_active_rpcs.sql';
  const source=executable(readFileSync(resolve(root,file),'utf8'));
  const names=[
    'preview_or_fill_galaxy_place','read_shared_keyword_classes',
    'read_trace_keyword_group_totals','rename_scope_site_batch',
    'scope_group','search_scope_trace_place_names'
  ];
  for(const name of names)
    assert.match(source,new RegExp('CREATE OR REPLACE FUNCTION silver\\.'+name+'\\('));
  for(const pattern of failSorts){
    pattern.lastIndex=0;
    assert.equal([...source.matchAll(pattern)].length,0,'UID sorting in '+file);
  }
  // Historical, already-applied migrations remain immutable. Only the newest
  // body of each live PostgreSQL function determines actual runtime ordering.
});
test('Import timestamp pagination never splits identical timestamps or sorts by UID',()=>{
  const s=readFileSync(resolve(root,'app/loc/ManagementImportPanel.jsx'),'utf8');
  assert.match(s,/\.gt\('createtime',after\)/);
  assert.match(s,/\.eq\('createtime',boundary\)/);
  assert.match(s,/count:'exact'/);
  assert.doesNotMatch(s,/\.order\('uid'/);
});
