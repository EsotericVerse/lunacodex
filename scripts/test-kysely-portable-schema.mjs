import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('app/loc/providers/kysely-schema.mjs','utf8');
const create=new Function('sql','portableRelation',source
  .replace(/^import .*$/gm,'').replace(/^export /gm,'')+
  ';return ensurePortableScopeSchema;')(
  Object.assign((strings,...values)=>({strings,values}),{raw:value=>value}),
  (table,engine,ns)=>engine==='mysql'?table:ns+'.'+table
);

function mockDb(existing=[]){
  const tables=[],indexes=[];
  const db={
    introspection:{getTables:async()=>existing},
    schema:{
      createTable(table){
        const entry={table,columns:[]};tables.push(entry);
        const chain={ifNotExists(){return this},
          addColumn(name,type,callback){
            entry.columns.push(name);
            const column={notNull(){return this},primaryKey(){return this},
              defaultTo(){return this}};
            if(callback)callback(column);
            return this;
          },modifyEnd(){return this},
          execute:async()=>{}};
        return chain;
      },
      createIndex(name){
        const item={name};indexes.push(item);
        return {on(table){item.table=table;return this},
          column(column){item.column=column;return this},execute:async()=>{}};
      }
    }
  };
  return {db,tables,indexes};
}

for(const [engine,namespace] of [['postgres','public'],['mysql','silver'],['mssql','dbo']]){
  test(engine+' initializes exactly Galaxy and Anchor with UID and eight permissions',async()=>{
    const {db,tables,indexes}=mockDb();
    const out=await create(db,{engine,namespace,scopeId:'writer'});
    assert.equal(tables.length,2);
    assert.deepEqual(tables.map(t=>t.table),engine==='mysql'
      ?['writer_galaxy','writer_anchor']
      :[namespace+'.writer_galaxy',namespace+'.writer_anchor']);
    const galaxy=tables[0].columns,anchor=tables[1].columns;
    assert.ok(galaxy.includes('uid')&&galaxy.includes('content')&&galaxy.includes('date'));
    for(const column of ['statics','culture','search','trace','list','keyword','extract','others'])
      assert.ok(galaxy.includes(column));
    assert.ok(anchor.includes('uid')&&anchor.includes('type')&&anchor.includes('attr'));
    assert.ok(!galaxy.includes('able'));
    assert.equal(indexes.length,2);
    assert.equal(out.created.length,2);
  });
}
test('already present Scope tables are never replaced',async()=>{
  const {db,tables}=mockDb([{schema:'dbo',name:'writer_galaxy'},
    {schema:'dbo',name:'writer_anchor'}]);
  const out=await create(db,{engine:'mssql',namespace:'dbo',scopeId:'writer'});
  assert.equal(out.created.length,0);
  assert.equal(tables.length,0);
});
