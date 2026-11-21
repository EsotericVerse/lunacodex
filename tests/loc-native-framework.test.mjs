import test from 'node:test';
import assert from 'node:assert/strict';
import {html,renderHTML,createLOC,defineModel,validateRecord,createDataSystem,
  compileSelect,compileCount,compileInsert,compileUpdate,compileDelete} from '../modules/loc/core/index.mjs';
import {parseRichText} from '../modules/loc/core/rich-text.mjs';

const schema=defineModel({name:'galaxy',table:'silver.loc_galaxy',fields:{
  uid:{type:'text',primary:true},title:{type:'text',required:true},
  score:{type:'number'},published:{type:'boolean'}
}});
const where={all:[{column:'published',operator:'eq',value:true},{column:'title',operator:'like',value:'%月%'}]};

test('native HTML escapes text and attributes, without rendering listeners',()=>{
  const node=html('a',{href:'/culture/?a=1&b=2',onClick:()=>{}},'<hello>');
  assert.equal(renderHTML(node),'<a href="/culture/?a=1&amp;b=2">&lt;hello&gt;</a>');
  assert.throws(()=>renderHTML(html('a',{href:'javascript:alert(1)'},'bad')),/Unsafe LOC URL/);
  assert.throws(()=>renderHTML(html('p',{innerHTML:'<img>'},'bad')),/Invalid LOC HTML attribute/);
  assert.throws(()=>renderHTML(html('img',{},'no')),/Void HTML element/);
});

test('published prose parsed to safe native markup',()=>{
  assert.equal(renderHTML(parseRichText('<p>Hello <strong>LOC</strong> &amp; friends</p>')),
    '<p>Hello <strong>LOC</strong> &amp; friends</p>');
  assert.throws(()=>renderHTML(parseRichText('<a href="javascript:alert(1)">X</a>')),/Unsafe LOC URL/);
  assert.equal(renderHTML(parseRichText('<img src="https://a.example/x.png" onerror="alert(1)">')),
    '<img src="https://a.example/x.png" alt="" loading="lazy">');
});

test('model fields and writes validate independently of database driver',()=>{
  assert.deepEqual(Object.keys(validateRecord(schema,{uid:'A',title:'題名'})),['uid','title']);
  assert.throws(()=>validateRecord(schema,{uid:'A',title:'題名',nonsense:1}),/Unknown LOC model field/);
  assert.throws(()=>validateRecord(schema,{uid:'A'}),/Missing required LOC field/);
});

test('SQL dialects use true engine-specific placeholders and quoting',()=>{
  for(const dialect of ['postgres','mysql','mssql','sqlite']){
    const select=compileSelect(schema,{columns:['uid','title'],where,orderBy:['uid'],limit:10,offset:5},dialect);
    assert.equal(select.params.length,4);
    assert.deepEqual(select.params,[true,'%月%',10,5].length===4&&dialect==='mssql'?
      [true,'%月%',5,10]:[true,'%月%',10,5]);
    assert.match(select.text,/SELECT .* FROM .* WHERE .* ORDER BY /);
    const count=compileCount(schema,{where},dialect);
    assert.equal(count.params.length,2);
    const insert=compileInsert(schema,{uid:'A',title:'T'},dialect);
    assert.equal(insert.params.length,2);
    const update=compileUpdate(schema,{title:'New'},{column:'uid',value:'A'},dialect);
    assert.deepEqual(update.params,['New','A']);
    const del=compileDelete(schema,{column:'uid',value:'A'},dialect);
    assert.deepEqual(del.params,['A']);
    assert.throws(()=>compileUpdate(schema,{title:'X'},null,dialect),/WHERE filter/);
    assert.throws(()=>compileDelete(schema,{all:[]},dialect),/concrete WHERE predicate/);
  }
});

test('LOC owns models, components, routes, and capabilities',async()=>{
  const loc=createLOC();
  loc.components.register('heading',({name})=>html('h1',{},name));
  assert.equal(loc.components.html('heading',{name:'LOC'}),'<h1>LOC</h1>');
  loc.routes.register('/scope/:id/',({id})=>html('p',{},id));
  assert.equal(loc.routes.resolve('/scope/demo/').params.id,'demo');
  let loads=0,cleanups=0;
  loc.extensions.register('chart',async()=>{loads++;return {mount:async()=>()=>{cleanups++;}};});
  const target={};
  const off=await loc.extensions.mount('chart',target);
  await loc.extensions.load('chart');
  assert.equal(loads,1);
  await off();await off();
  assert.equal(cleanups,1);
});

test('LOC data uses caller-owned authorization and driver',async()=>{
  const calls=[];
  const db=createDataSystem({dialect:'postgres',
    authorize:({operation})=>operation==='select',
    execute:async statement=>{calls.push(statement);return [{uid:'A'}];}
  });
  db.register({name:'galaxy',table:'silver.loc_galaxy',fields:{
    uid:{type:'text',primary:true},title:{type:'text',required:true}
  }});
  assert.deepEqual(await db.select('galaxy',{where:{column:'uid',value:'A'}}),[{uid:'A'}]);
  assert.equal(calls.length,1);
  await assert.rejects(db.delete('galaxy',{column:'uid',value:'A'}),/access denied/);
});
