import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Scope provisioning was intentionally retired when LOC froze the database.
// This source contract must NOT request CREATE/ALTER/DROP, RLS, GRANT, or
// re-create the retired keyword-copy/Scope-table installation workflow.
const code=readFileSync(new URL('../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');

test('Scope creation and deletion are rejected without running DDL',()=>{
  assert.match(code,/if\(action!=='manage_scope_registry'\)/);
  assert.match(code,/Schema is frozen|schema is frozen/i);
  assert.match(code,/provisioning and deletion are unavailable',409/);
  assert.doesNotMatch(code,/\b(?:create\s+(?:table|index|policy)|alter\s+table|drop\s+table|grant\s+|revoke\s+)\b/i);
  assert.doesNotMatch(code,/async function (?:provisionScope|deleteScope|copyDefaultKeywordClass)\(/);
});

test('existing Scope Registry data edits retain global LOC authorization',()=>{
  assert.match(code,/if\(action!=='manage_scope_registry'\)[\s\S]*?await allowedGlobal\(trx\)/);
  assert.match(code,/return \{data:await managedRegistry\(trx,args\),count:null\}/);
  assert.match(code,/await canManageLoc\(trx,'global'\)/);
  assert.match(code,/trx\.updateTable\('api\.manage'\)/);
  assert.match(code,/trx\.updateTable\('silver\.loc'\)/);
});

test('existing Scope Group creation writes Registry rows but never creates SQL relations',()=>{
  assert.match(code,/operation==='create_group'/);
  assert.match(code,/trx\.insertInto\('api\.manage'\)/);
  assert.match(code,/trx\.insertInto\('silver\.loc'\)/);
  assert.doesNotMatch(code,/\b(?:pg_class|pg_policy|pg_index|pgrst|for select to anon)\b/i);
});
