import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync('supabase/functions/loc-kysely/index.ts','utf8');
const publicProvider=fs.readFileSync('app/loc/providers/kysely-public.mjs','utf8');

test('cross-engine public actions use native Kysely, never old RPC',()=>{
  assert.match(gateway,/body\.kind==="public-action".*executeKyselyPublicAction\(trx,body/);
  assert.match(publicProvider,/introspection\.getTables\(/);
  assert.doesNotMatch(publicProvider,/to_regclass\(/);
});

test('public-action on MySQL and SQL Server is routed before the private query ACL',()=>{
  const portable=gateway.slice(gateway.indexOf('if(target.provider==="custom"'));
  assert.match(portable,/body\.kind==="public-action"/);
  assert.ok(portable.indexOf('body.kind==="public-action"')<
    portable.indexOf('authorizeCrossEngineQuery(trx,body'));
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
  assert.deepEqual(called,['dbo.manage','dbo.loc']);
});

test('portable bootstrap works with an unqualified MySQL database',async()=>{
  const {db,called}=mockSql('silver');
  const result=await publicExecutor()(db,{name:'read_app_bootstrap',
    args:{p_scope_id:'loc',p_page_name:'index'}},{engine:'mysql',namespace:'silver'});
  assert.equal(result.data.scope_id,'loc');
  assert.deepEqual(called,['manage','loc']);
});
