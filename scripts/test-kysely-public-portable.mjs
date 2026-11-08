import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicProvider=fs.readFileSync('app/loc/providers/kysely-public.mjs','utf8');

test('cross-engine public actions use native Kysely, never old RPC',()=>{
  assert.match(publicProvider,/introspection\.getTables\(/);
  assert.doesNotMatch(publicProvider,/to_regclass\(/);
});

function publicExecutor(){
  const build=new Function('sql','portableRelation',
    publicProvider.replace(/^import .*$/gm,'').replace(/^export /gm,'')+
    ';return executeKyselyPublicAction;');
  return build({},(name,engine,namespace)=>engine==='mysql'?name:namespace+'.'+name);
}

function mockSql(schema='dbo'){
  const called=[],metadata=[{schema,name:'manage'},{schema,name:'loc'},{schema,name:'loc_blocks'}];
  const rows={
    manage:[{id:'loc',manage_role:'group',active:true,sort_order:0,
      display_name:'LOC',title_tw:'LOC',desc_tw:'',domain:null,
      directory:null,parent_scope_id:null}],
    loc:[{id:'loc',display_name:'LOC',theme:JSON.stringify([
      {theme_id:'default',theme_name:'Default',theme_order:1}])}],
    loc_blocks:[]
  };
  const db={
    introspection:{getTables:async()=>metadata},
    selectFrom:(full)=>{
      called.push(full);
      const table=full.split('.').at(-1);
      const data=rows[table]||[];
      const query={
        select(){return this},selectAll(){return this},where(){return this},
        orderBy(){return this},execute:async()=>data,
        executeTakeFirst:async()=>data[0]||null
      };
      return query;
    }
  };
  return {db,called};
}

test('portable bootstrap reads exactly the declared SQL Server namespace',async()=>{
  const {db,called}=mockSql('dbo');
  const result=await publicExecutor()(db,{name:'read_app_bootstrap',
    args:{p_scope_id:'loc',p_page_name:'index'}},{engine:'mssql',namespace:'dbo'});
  assert.equal(result.data.scope_id,'loc');
  assert.equal(result.data.registry.length,1);
  assert.equal(result.data.themes.length,1);
  assert.deepEqual(called,['dbo.manage','dbo.loc','dbo.loc','dbo.loc_blocks','dbo.loc']);
});

test('portable bootstrap works with an unqualified MySQL database',async()=>{
  const {db,called}=mockSql('client_database');
  const result=await publicExecutor()(db,{name:'read_app_bootstrap',
    args:{p_scope_id:'loc',p_page_name:'index'}},{engine:'mysql',namespace:'silver'});
  assert.equal(result.data.scope_id,'loc');
  assert.deepEqual(called,['manage','loc','loc','loc_blocks','loc']);
});


test('two-table SQL installation boots without manage, loc or any RPC',async()=>{
  let metadataReads=0;const queries=[];
  const db={
    introspection:{getTables:async()=>{metadataReads++;return [
      {schema:'dbo',name:'writer_galaxy'},{schema:'dbo',name:'writer_anchor'}
    ];}},
    selectFrom:table=>{queries.push(table);throw Error('Unexpected SQL query '+table);}
  };
  const data=await publicExecutor()(db,{name:'read_app_bootstrap',
    args:{p_scope_id:'loc',p_page_name:'index'}},
    {engine:'mssql',namespace:'dbo'});
  assert.equal(data.data.registry.length,1);
  assert.equal(data.data.registry[0].scope_id,'writer');
  assert.equal(data.data.scope_id,'loc');
  assert.deepEqual(queries,[]);
  assert.equal(metadataReads,1);
});


test('point search returns canonical lng/lat coordinates and supports legacy keys',()=>{
  const locationSql=publicProvider.slice(publicProvider.indexOf('const anchor=sql.ref('),
    publicProvider.indexOf('return {data:result.rows,count:null};'));
  assert.match(locationSql,/coalesce\(a\.attr->>'lng',a\.attr->>'longitude'\)/);
  assert.match(locationSql,/coalesce\(a\.attr->>'lat',a\.attr->>'latitude'\)/);
  assert.match(locationSql,/order by a\.title limit/);
  const searchAction=publicProvider.indexOf("if(name==='search_scope_trace_place_names')");
  const portableBranch=publicProvider.slice(
    publicProvider.indexOf('if(portable){',searchAction));
  assert.match(portableBranch,/attr\.lng\?\?attr\.longitude/);
  assert.match(portableBranch,/attr\.lat\?\?attr\.latitude/);
});

test('invalid public actions never trigger database schema introspection',async()=>{
  let metadataReads=0;
  const db={
    introspection:{getTables:async()=>{metadataReads++;throw Error('must not introspect');}},
    selectFrom(){throw Error('must not query');}
  };
  const execute=publicExecutor();
  for(const invalid of [
    {name:'unknown_action',args:{p_scope_id:'writer'}},
    {name:'read_app_bootstrap',args:{p_scope_id:'INVALID.scope',p_page_name:'index'}},
    {name:'read_scope_page_copy',args:{p_scope_id:'writer',extra:true}},
    {name:'read_app_bootstrap',args:[]}
  ]){
    await assert.rejects(execute(db,invalid,{engine:'mysql',namespace:''}),
      error=>error?.httpStatus===400);
  }
  assert.equal(metadataReads,0);
});
