import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function routing(overrides={}){
 const accessSource=read('app/loc/providers/access.js').replace(/^export /gm,'');
 const access=new Function(accessSource+';return DATABASE_ACCESS_LIST;')();
 const code=read('app/loc/providers/routing-config.mjs')
  .replace("import {DATABASE_ACCESS_LIST} from './access.js';",'')
  .replace(/^export /gm,'');
 const context={DATABASE_ACCESS_LIST:access,
  Deno:{env:{get:key=>overrides[key]||''}},
  process:{env:{NEXT_PUBLIC_LOC_SQL_ENGINE:'mysql',NEXT_PUBLIC_LOC_SQL_ALIAS:'browser_override'}}};
 return vm.runInNewContext(code+
  ';({DATABASE_ROUTING_CONFIG,resolveDatabaseRouting})',context);
}
test('standalone server alias always selects its own independent SQL connection',()=>{
 const {DATABASE_ROUTING_CONFIG:config,resolveDatabaseRouting:resolve}=routing({
  LOC_CONTROL_DB_ALIAS:'loc_main',LOC_CONTROL_DB_ENGINE:'postgres'
 });
 const selected=resolve();
 assert.equal(selected.primaryId,'custom-current');
 assert.equal(selected.provider,'custom');
 assert.equal(selected.engine,'postgres');
 assert.equal(selected.connectionAlias,'loc_main');
 assert.equal(selected.backupId,null);
 assert.equal(config.targets['custom-current'].connection_alias,'loc_main');
});
test('portable SQL never falls back to browser alias when server selects MSSQL',()=>{
 const {resolveDatabaseRouting:resolve}=routing({
  LOC_CONTROL_DB_ALIAS:'loc_main',LOC_CONTROL_DB_ENGINE:'mssql'
 });
 assert.equal(resolve().engine,'mssql');
 assert.equal(resolve().connectionAlias,'loc_main');
});
test('legacy SQL fallback remains only when no independent control alias configured',()=>{
 const {resolveDatabaseRouting:resolve}=routing();
 assert.equal(resolve().primaryId,'supabase-current');
 assert.equal(resolve().backupId,'neon-current');
 assert.equal(resolve().provider,'supabase');
});
