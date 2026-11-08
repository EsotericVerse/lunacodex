import test from 'node:test';
import assert from 'node:assert/strict';
import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from '../app/loc/providers/routing-config.mjs';
import {getSqlRuntimeCapabilities,portableRelation} from '../app/loc/providers/sql-engine-ports.mjs';

test('database routing follows server-selected aliases and optional backups',()=>{
 const route=resolveDatabaseRouting({...DATABASE_ROUTING_CONFIG,backupId:null});
 assert.equal(route.provider,'custom');
 assert.equal(route.backupId,null);
 assert.equal(route.primaryControl,true);
 assert.equal(route.verified,true);
 assert.equal(typeof route.connectionAlias,'string');
});

test('direct Kysely dialects use the selected SQL engine without a separate service',()=>{
 for(const engine of ['postgres','mysql','mssql'])
   assert.equal(typeof getSqlRuntimeCapabilities(engine).dialect,'string');
 assert.equal(portableRelation('scope_galaxy','postgres','silver'),'silver.scope_galaxy');
 assert.equal(portableRelation('scope_galaxy','mysql'),'scope_galaxy');
});
