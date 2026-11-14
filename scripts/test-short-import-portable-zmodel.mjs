// No database credentials or live connections. Run:
//   node scripts/test-short-import-portable-zmodel.mjs
// The same ZModel insert row is compiled by all three installed Kysely dialects.
import assert from 'node:assert/strict';
import {ZodError} from 'zod';
import {Kysely,MssqlDialect,MysqlDialect,PostgresDialect,sql} from 'kysely';
import {portableGalaxyImportMapping} from '../zenstack/portable-import-mapping.mjs';
import {galaxyReadColumns} from '../zenstack/galaxy-read-models.mjs';

const flags=galaxyReadColumns('GalaxyAttr');
const row={
  uid:'Abc12345',
  title:'LOC Portable Test',
  content:'[[LOC-Append-Event:abcd]]\nA small test event',
  site:'mcp',
  site_id:'gl:'+'a'.repeat(64),
  url:'https://chatgpt.com/c/portable-test',
  createtime:'2026-11-14T01:00:00.000Z',
  UpdateTime:'2026-11-14T01:00:00.000Z',
  ...Object.fromEntries(flags.map(flag=>[flag,false]))
};

// Driver-shaped configuration is never used: compile() requires no connection.
const dialects={
  postgres:new PostgresDialect({pool:{}}),
  mysql:new MysqlDialect({pool:{}}),
  mssql:new MssqlDialect({tarn:{},tedious:{}})
};
const expectedTables={
  postgres:'silver.lo3rwang_galaxy',
  mysql:'lo3rwang_galaxy',
  mssql:'dbo.lo3rwang_galaxy'
};
let count=0;
for(const [engine,dialect] of Object.entries(dialects)){
  const model=portableGalaxyImportMapping({scopeId:'lo3rwang',engine});
  assert.equal(model.table,expectedTables[engine]);
  assert.deepEqual(model.lookup,['uid','content','site_id']);
  const mapped=model.mapInserts([row]);
  assert.equal(mapped.length,1);
  assert.equal(mapped[0].uid,row.uid);
  assert.equal(mapped[0].content,row.content);
  assert.equal(mapped[0].site_id,row.site_id);
  assert.equal(mapped[0].site,'mcp');
  assert.equal(mapped[0].statics,false);
  assert(mapped[0].createtime instanceof Date);
  assert(mapped[0].UpdateTime instanceof Date);
  assert.equal(mapped[0].createtime.toISOString(),row.createtime);
  assert.equal(mapped[0].UpdateTime.toISOString(),row.UpdateTime);

  const db=new Kysely({dialect});
  const lookup=db.selectFrom(model.table).select(model.lookup)
    .where(model.site,'in',['web','mcp'])
    .where(model.siteId,'in',['gl:'+'a'.repeat(64)]).limit(2).compile();
  const insert=db.insertInto(model.table).values(mapped).compile();
  const append=db.updateTable(model.table)
    .set({
      [model.content]:sql`concat(coalesce(${sql.ref(model.content)},''),${' tail'})`,
      [model.updatedAt]:new Date('2026-11-14T02:00:00.000Z')
    })
    .where(model.uid,'=',row.uid)
    .where(model.site,'in',['web','mcp'])
    .where(model.siteId,'=',row.site_id).compile();
  for(const statement of [lookup,insert,append]){
    assert(statement.sql.includes('lo3rwang_galaxy'));
    assert(statement.parameters.length>0);
  }
  assert(insert.sql.includes('UpdateTime'));
  assert(append.sql.includes('UpdateTime'));
  // MySQL resolves the namespace through its database connection rather than
  // prefixing a schema; the others retain explicit schema qualification.
  if(engine==='mysql')assert(!insert.sql.includes('silver.'));
  console.log('PASS '+engine+' ZModel mapping + Kysely SELECT/INSERT/UPDATE compilation');
  await db.destroy();
  count++;
}
const ref=portableGalaxyImportMapping({scopeId:'lo3rwang',engine:'postgres'});
// Zod is the first validation boundary for mapInserts(). Reject based on
// structured Zod issues rather than an implementation-dependent error string.
const rejectedField=field=>error=>error instanceof ZodError&&
  error.issues.some(issue=>issue.path[0]===field);
assert.throws(()=>ref.mapInserts([{...row,createtime:'not-a-date'}]),
  rejectedField('createtime'));
assert.throws(()=>ref.mapInserts([{...row,site_id:'gl:invalid'}]),
  rejectedField('site_id'));
assert.throws(()=>ref.mapInserts([{...row,statics:'false'}]),
  rejectedField('statics'));
assert.throws(()=>ref.mapInserts([{...row,unknown_column:true}]),
  error=>error instanceof ZodError&&error.issues.some(issue=>
    issue.code==='unrecognized_keys'&&issue.keys?.includes('unknown_column')));
assert.throws(()=>portableGalaxyImportMapping({scopeId:'lo3rwang;drop',engine:'postgres'}),/Scope/);
assert.throws(()=>portableGalaxyImportMapping({scopeId:'lo3rwang',engine:'sqlite'}),/SQL engine/);
console.log('PASS '+count+' dialects; no live DB, DDL, migration or credentials used');
