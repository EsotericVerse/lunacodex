import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeLocDomain,validateLocRegistryDomain} from '../app/loc/providers/loc-domain.mjs';

const migration=readFileSync(new URL('../supabase/migrations/20261107090000_loc_portable_retire_last_sql_functions.sql',import.meta.url),'utf8');

test('every remaining PostgreSQL function reference is replaced in one atomic cutover',()=>{
  assert.equal((migration.match(/^ALTER POLICY\b/gm)||[]).length,38);
  assert.match(migration,/^BEGIN;/m);
  assert.match(migration,/^COMMIT;/m);
  assert.doesNotMatch(migration,/DROP\s+FUNCTION[^;]*CASCADE/i);
  const retired=['api.manage(text,text)','api.current_user_id()',
    'silver.current_auth_email()','api.request_claims()',
    'silver.domain_has_repeated_labels(text)',
    'silver.sync_scope_config_display_name()',
    'silver.touch_visual_novel_updated_at()'];
  for(const signature of retired)
    assert.ok(migration.includes('DROP FUNCTION '+signature+' RESTRICT;'),signature);
  for(const item of ['CREATE OR REPLACE VIEW api.lo3rwang_keywords_manage',
    'DROP TRIGGER sync_scope_display_name ON silver.lo3rwang',
    'DROP TRIGGER sync_scope_display_name ON silver.lrunes',
    'DROP TRIGGER visual_novel_touch_updated_at ON silver."VisualNovel"',
    'ADD CONSTRAINT loc_domain_no_repeated_labels'])
    assert.ok(migration.includes(item),item);
  assert.doesNotMatch(migration,/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/gmi);
});

test('LOC Registry domains reject repeated labels without database RPC',()=>{
  for(const value of ['a.a','a.b.a','foo.bar.foo','A.b.a'])
    assert.throws(()=>normalizeLocDomain(value),/repeated labels/);
  for(const value of ['a.b','a.b.c','abc.def.abcd'])
    assert.equal(normalizeLocDomain(value),value);
  assert.equal(normalizeLocDomain(null),null);
  assert.equal(normalizeLocDomain('  Foo.Bar  '),'foo.bar');
  assert.deepEqual(validateLocRegistryDomain({domain:'  Foo.Bar  ',active:true}),
    {domain:'foo.bar',active:true});
});

test('the last direct Scope display and managed writes use one Kysely transaction',()=>{
  const admin=readFileSync(new URL('../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');
  const management=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(admin,/execute\s+function\s+silver\.sync_scope_config_display_name\s*\(/i);
  assert.match(management,/updateTable\('silver.loc'\)\.set\(\{display_name:title\}\)/);
  assert.match(runtime,/validateLocRegistryDomain/);
  assert.match(runtime,/updated_at:new Date\(\)/);
  assert.match(admin,/fixedSchema\.models\.Manage/);
});

test('signed MCP readers use one Kysely query shape on all supported SQL engines',async()=>{
  const source=readFileSync(new URL('../app/loc/providers/kysely-mcp-read.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  const sql=Object.assign((strings,...values)=>({strings,values}),{ref:value=>({ref:value})});
  const {readMcpGalaxyWithKysely}=new Function('sql','portableRelation',
    source+';return {readMcpGalaxyWithKysely};')(
      sql,(table,engine,namespace)=>engine==='mysql'?table:namespace+'.'+table);
  for(const engine of ['postgres','mysql','mssql']){
    const steps=[];
    const builder={select(value){steps.push(['select',value]);return this;},
      where(...args){steps.push(['where',...args]);return this;},
      orderBy(...args){steps.push(['orderBy',...args]);return this;},
      limit(value){steps.push(['limit',value]);return this;},
      async execute(){return [{uid:'AbCd1234'}]}};
    const db={selectFrom(table){steps.push(['from',table]);return builder}};
    const namespace=engine==='mssql'?'dbo':'silver';
    const rows=await readMcpGalaxyWithKysely(db,{
      kind:'mcp-read',scopeid:'lo3rwang',uid:'AbCd1234'
    },{engine,namespace});
    assert.equal(rows.length,1);
    assert.ok(steps.some(x=>x[0]==='where'&&x[1]==='site'&&x[3]==='mcp'));
    steps.length=0;
    await readMcpGalaxyWithKysely(db,{
      kind:'mcp-search',scopeid:'lrunes',query:'Hello_%',limit:20
    },{engine,namespace});
    assert.ok(steps.some(x=>x[0]==='where'&&x[1]==='site'&&x[3]==='mcp'));
    assert.ok(steps.some(x=>x[0]==='limit'&&x[1]===20));
    assert.ok(steps.some(x=>x[0]==='where'&&x[1]?.values?.some(value=>value?.ref==='content')));
  }
});
