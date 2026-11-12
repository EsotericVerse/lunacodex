import test from 'node:test';
import assert from 'node:assert/strict';
import {Kysely,DummyDriver,PostgresAdapter,PostgresIntrospector,PostgresQueryCompiler,sql} from 'kysely';
import {zmodelGalaxyPointJoin} from '../zenstack/model-column-guard.mjs';

function dialect(){
  return {createDriver:()=>new DummyDriver(),createAdapter:()=>new PostgresAdapter(),
    createIntrospector:db=>new PostgresIntrospector(db),
    createQueryCompiler:()=>new PostgresQueryCompiler()};
}

test('ZModel-derived Point JOIN compiles once on grouped Galaxy data',async()=>{
  const db=new Kysely({dialect:dialect()});
  const grouped=sql`(select g.place_id as place_id, count(*) as n
    from ${sql.ref('silver.lo3rwang_galaxy')} g
    group by g.place_id)`.as('g');
  const result=zmodelGalaxyPointJoin(db.selectFrom(grouped),{scopeId:'lo3rwang'})
    .select(['g.place_id as place_id','g.n as n','a.title as title'])
    .compile();
  assert.match(result.sql,/left join "silver"."lo3rwang_anchor" as "a"/i);
  assert.match(result.sql,/"a"."uid" = "g"."place_id"/i);
  assert.match(result.sql,/"a"."type" = \$1/i);
  assert.match(result.sql,/"a"."invisible" = \$2/i);
  assert.deepEqual(result.parameters,['point',false]);
  assert.equal((result.sql.match(/join/gi)||[]).length,1);
  await db.destroy();
});

test('Galaxy and Point JOIN stays within one Scope and uses fixed model keys',async()=>{
  const db=new Kysely({dialect:dialect()});
  const query=db.selectFrom(sql`(select place_id from ${sql.ref('silver.lrunes_galaxy')})`.as('g'));
  assert.match(zmodelGalaxyPointJoin(query,{scopeId:'lrunes'}).select('a.uid').compile().sql,
    /"silver"."lrunes_anchor"/);
  for(const scopeId of ['', 'lo3rwang;DROP TABLE x','UPPER','other-scope']){
    assert.throws(()=>zmodelGalaxyPointJoin(query,{scopeId}),/Invalid LOC Galaxy\/Point JOIN Scope/);
  }
  await db.destroy();
});
