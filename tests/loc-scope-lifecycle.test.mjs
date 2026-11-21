import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindLocAuthorization} from '../app/loc/providers/loc-authorization.mjs';
import {manageScopeRegistryNative,provisionScopeNative,deleteScopeNative}
  from '../app/loc/providers/kysely-scope-lifecycle.mjs';

const OWNER={role:'authenticated',claims:{provider:'loc',me:true,
  sub:'owner-test-1234',email:'owner@example.com',grants:['global:manage']}};
const ORIGINAL=[
  {id:'loc',display_name:'月典',manage_role:'group',
    domain:'loc.example.com',directory:null,parent_scope_id:null,
    sort_order:10,active:true},
  {id:'lo3rwang',display_name:'Owner',manage_role:'scope',
    domain:null,directory:'/lo3rwang',parent_scope_id:'loc',
    sort_order:20,active:true}
];
function fakeRegistry(initial=ORIGINAL){
  const registry=structuredClone(initial),summary=new Map(
    initial.map(item=>[item.id,item.display_name]));
  const calls=[];
  const scopeConfigs=new Map([['lo3rwang',{display_name:'Owner'}]]);
  const trx={
    selectFrom(table){
      assert.equal(table,'api.manage as m');
      return {leftJoin(relation,on,left){
        assert.deepEqual([relation,on,left],['silver.loc as l','l.id','m.id']);
        return {select(cols){
          assert.ok(cols.includes('m.id as id'));
          return {orderBy(column){
            assert.equal(column,'m.id');
            return {forUpdate(alias){
              assert.equal(alias,'m');
              return {async execute(){
                calls.push('registry-lock');
                return registry.map(row=>({...row,
                  display_name:summary.get(row.id)||null}));
              }};
            }};
          }};
        }};
      }};
    },
    insertInto(table){
      return {values(value){
        return {async execute(){
          calls.push('insert:'+table);
          if(table==='api.manage')registry.push(value);
          else if(table==='silver.loc')summary.set(value.id,value.display_name);
          else assert.fail('Unexpected SQL table '+table);
        }};
      }};
    },
    updateTable(table){
      return {set(values){
        return {where(column,operator,id){
          assert.deepEqual([column,operator],['id','=']);
          return {returning(){
            return {async execute(){
              calls.push('update:'+table);
              if(table==='api.manage'){
                const row=registry.find(x=>x.id===id);
                if(row)Object.assign(row,values);
              }
              if(table==='silver.loc'&&summary.has(id))
                summary.set(id,values.display_name);
              if(table.startsWith('silver.')&&table!=='silver.loc'&&
                scopeConfigs.has(table.slice(7)))
                Object.assign(scopeConfigs.get(table.slice(7)),values);
              return summary.has(id)||registry.some(x=>x.id===id)||
                scopeConfigs.has(table.slice(7))?[{id}]:[];
            }};
          }};
        }};
      }};
    }
  };
  bindLocAuthorization(trx,OWNER);
  return {trx,registry,summary,scopeConfigs,calls};
}
test('Scope Registry group creation commits its Registry and display projection together',async()=>{
  const state=fakeRegistry();
  const result=await manageScopeRegistryNative(state.trx,{
    p_operation:'create_group',p_scope_id:'testgroup',
    p_values:{display_name:'測試群組',directory:'/testgroup',
      parent_scope_id:'loc'}
  });
  assert.equal(result.scope_id,'testgroup');
  assert.equal(result.route_mode,'directory');
  assert.equal(state.registry.find(x=>x.id==='testgroup').manage_role,'group');
  assert.equal(state.summary.get('testgroup'),'測試群組');
  assert.deepEqual(state.calls,
    ['registry-lock','insert:api.manage','insert:silver.loc']);
});
test('Scope rename updates both public config and Registry summary atomically',async()=>{
  const state=fakeRegistry();
  const result=await manageScopeRegistryNative(state.trx,{
    p_operation:'update',p_scope_id:'lo3rwang',
    p_values:{display_name:'新顯示名稱'}
  });
  assert.equal(result.display_name,'新顯示名稱');
  assert.equal(state.summary.get('lo3rwang'),'新顯示名稱');
  assert.equal(state.scopeConfigs.get('lo3rwang').display_name,'新顯示名稱');
  assert.deepEqual(state.calls,['registry-lock','update:api.manage',
    'update:silver.loc','update:silver.lo3rwang']);
});
test('Scope Registry refuses duplicate routes, unlisted writes and cycles',async()=>{
  const state=fakeRegistry();
  const create=p_values=>manageScopeRegistryNative(state.trx,{
    p_operation:'create_group',p_scope_id:'testgroup',p_values
  });
  await assert.rejects(create({display_name:'Dupe',directory:'/lo3rwang',
    parent_scope_id:'loc'}),/already registered/);
  await assert.rejects(create({display_name:'Invalid',directory:'/valid',
    parent_scope_id:'loc',email:'forbidden@example.com'}),/immutable/);
  await assert.rejects(create({display_name:'Invalid',domain:'ab.example.com',
    directory:'/path',parent_scope_id:'loc'}),/Exactly one/);
  await assert.rejects(manageScopeRegistryNative(state.trx,{
    p_operation:'update',p_scope_id:'loc',
    p_values:{display_name:'月典',directory:'/loc'}
  }),/Exactly one/);
  assert.equal(state.registry.length,2);
  const system=fakeRegistry([...ORIGINAL,{id:'admin',
    manage_role:'admin',display_name:'Admin',
    domain:null,directory:'/admin',parent_scope_id:null,
    active:true,sort_order:0}]);
  await assert.rejects(manageScopeRegistryNative(system.trx,{
    p_operation:'update',p_scope_id:'admin',
    p_values:{display_name:'Hijack',directory:'/admin'}
  }),/System Scope Registry cannot be edited/);
});
test('dynamic Scopes cannot occupy existing LOC URLs or service hosts',async()=>{
  const state=fakeRegistry();
  const create=(id,route)=>manageScopeRegistryNative(state.trx,{
    p_operation:'create_group',p_scope_id:id,p_values:{
      display_name:'Reserved',parent_scope_id:'loc',...route
    }
  });
  await assert.rejects(create('example',{directory:'/culture'}),/existing LOC route/);
  await assert.rejects(create('example',{domain:'auth.lo3rwang.cc'}),/existing service/);
  await assert.rejects(provisionScopeNative(state.trx,{
    p_scope_id:'local',p_display_name:'Invalid',p_email:'valid@example.com',
    p_directory:'/local'
  }),/Reserved LOC Scope/);
  await assert.rejects(provisionScopeNative(state.trx,{
    p_scope_id:'culture',p_display_name:'Invalid',p_email:'valid@example.com',
    p_directory:'/custom'
  }),/existing route/);
});
test('Scope creation and deletion both demand existing global LOC authorization',async()=>{
  const denied={selectFrom(){assert.fail('unauthorized SQL request');}};
  await assert.rejects(provisionScopeNative(denied,{
    p_scope_id:'testscope',p_display_name:'Test',p_email:'me@example.com',
    p_directory:'/testscope'
  }),/global management permission/);
  await assert.rejects(deleteScopeNative(denied,{p_scope_id:'testscope'}),
    /global management permission/);
  const state=fakeRegistry();
  await assert.rejects(provisionScopeNative(state.trx,{
    p_scope_id:'testscope',p_display_name:'Test',p_email:'me@example.com',
    p_domain:'test.example.com',p_directory:'/testscope'
  }),/Exactly one/);
  await assert.rejects(deleteScopeNative(state.trx,{p_scope_id:'lo3rwang'}),
    /Built-in LOC Scope/);
  assert.deepEqual(state.calls,[]);
});
test('Scope lifecycle uses serializable website Session and no legacy RPC',()=>{
  const native=readFileSync(new URL('../app/loc/mcp/native-operations.mjs',import.meta.url),'utf8');
  const actions=readFileSync(new URL('../app/loc/providers/kysely-management.mjs',import.meta.url),'utf8');
  const lifecycle=readFileSync(new URL('../app/loc/providers/kysely-scope-lifecycle.mjs',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../app/loc/views/admin-panels/AdminRegistry.jsx',import.meta.url),'utf8');
  assert.match(native,/host!==WEB_HOST\)throw refusal\('LOC Scope lifecycle is website-only'/);
  assert.match(native,/transaction\.setIsolationLevel\('serializable'\)/);
  for(const action of ['provision_scope','manage_scope_registry','delete_scope']){
    assert.ok(actions.includes("'"+action+"'"),action+' must be supported');
  }
  assert.doesNotMatch(lifecycle,/silver\.manage\(|api\.(?:provision_scope|delete_scope|manage_scope_registry)\(/);
  assert.doesNotMatch(lifecycle,/enable row level security|create policy|grant select/i);
  assert.match(lifecycle,/synchronizeKeywordLibraryInTransaction\(trx,scope\)/);
  assert.match(lifecycle,/keyword_patterns:indexed\?\.created/);
  assert.match(admin,/locale:normalizeUiLocale\(scopeDraft\.locale\)/);
  assert.doesNotMatch(admin,/keyword_rows\)!==66/);
});
