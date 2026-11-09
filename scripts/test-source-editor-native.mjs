import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Source settings and all blacklists are retired',()=>{
 for(const path of ['functions/api/source-catalog.js','app/loc/source-sql-service.mjs',
   'app/loc/FlatClassificationEditor.jsx','app/loc/views/admin-panels/AdminEmailBlocklist.jsx'])
   assert.equal(existsSync(new URL('../'+path,import.meta.url)),false);
 assert.doesNotMatch(read('app/loc/providers/kysely-management.mjs'),/save_scope_sources|is_current_email_blocklisted|update_group_default_article_class/);
 assert.doesNotMatch(read('app/loc/views/AdminHomeView.jsx'),/AdminEmailBlocklist/);
});
