import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const snapshot=JSON.parse(readFileSync(new URL('../zenstack/schema-contract.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../zenstack/schema.zmodel',import.meta.url),'utf8');
const native={
  text:['String','@db.Text'],
  varchar:['String','@db.VarChar'],
  bpchar:['String','@db.Char'],
  bool:['Boolean',''],
  int2:['Int','@db.SmallInt'],
  int4:['Int','@db.Integer'],
  int8:['BigInt','@db.BigInt'],
  timestamptz:['DateTime','@db.Timestamptz'],
  timestamp:['DateTime','@db.Timestamp'],
  date:['DateTime','@db.Date'],
  numeric:['Decimal','@db.Decimal'],
  jsonb:['Json','@db.JsonB'],
  json:['Json','@db.Json'],
  _text:['String[]','@db.Text'],
  _varchar:['String[]','@db.VarChar'],
  _int2:['Int[]','@db.SmallInt'],
  _int4:['Int[]','@db.Integer']
};
const modelName=table=>table.split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
const blocks=[...source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
const physical=new Map();
for(const [,name,body] of blocks){
  const table=body.match(/^\s+@@map\("([^"]+)"\)\s*$/m)?.[1];
  assert.ok(table,'missing physical table mapping for '+name);
  assert.match(body,/^\s+@@schema\("silver"\)\s*$/m);
  assert.equal(name,modelName(table),'unexpected model name');
  assert.ok(!physical.has(table),'duplicate physical model: '+table);
  const fields=new Map();
  for(const line of body.split('\n')){
    const m=line.match(/^\s{4}([A-Za-z_]\w*)\s+((?:String|Boolean|Int|BigInt|Float|Decimal|DateTime|Json|Bytes)(?:\[\]|\?)?)(?:\s+(.*))?$/);
    if(m){
      assert.ok(!fields.has(m[1]),'duplicate field: '+table+'.'+m[1]);
      fields.set(m[1],{type:m[2],attributes:m[3]||''});
    }
  }
  physical.set(table,{body,fields});
}

test('ZModel maps exactly to the frozen silver physical table and column contract',()=>{
  assert.equal(snapshot.schema,'silver');
  assert.equal(snapshot.tables.length,17);
  assert.equal(physical.size,snapshot.tables.length);
  let total=0;
  for(const t of snapshot.tables){
    const model=physical.get(t.table);
    assert.ok(model,'missing table: '+t.table);
    assert.equal(model.fields.size,t.columns.length,'column count drift for '+t.table);
    assert.deepEqual([...model.fields.keys()].sort(),t.columns.map(x=>x.name).sort(),
      'column name drift for '+t.table);
    const ids=t.pk;
    if(ids.length===1)assert.match(model.fields.get(ids[0]).attributes,/(?:^|\s)@id(?:\s|$)/);
    else assert.ok(model.body.includes('@@id(['+ids.join(', ')+'])'));
    for(const col of t.columns){
      total++;
      const field=model.fields.get(col.name);
      assert.ok(field,'missing '+t.table+'.'+col.name);
      assert.ok(native[col.format],'unexpected source type '+col.format);
      const [kind,dbType]=native[col.format];
      // ZModel cannot express nullable SQL scalar lists (String[]?, Int[]?).
      // Those nullable arrays stay on Kysely's SQL/driver path.
      const optional=col.nullable&&!kind.endsWith('[]')?'?':'';
      assert.equal(field.type,kind+optional,t.table+'.'+col.name+' scalar type changed');
      if(dbType)assert.ok(field.attributes.includes(dbType),
        t.table+'.'+col.name+' native database type changed');
      if(col.generated)assert.ok(!field.attributes.includes('@default('),
        t.table+'.'+col.name+' is a stored generated column');
    }
  }
  assert.equal(total,273);
});

test('Anchor remains the extension point; model does not declare migrations or bypass authorization',()=>{
  for(const table of ['lo3rwang_anchor','lrunes_anchor']){
    const anchor=physical.get(table);
    assert.ok(anchor);
    assert.equal(anchor.fields.get('uid').type,'String');
    assert.equal(anchor.fields.get('type').type,'String');
    assert.equal(anchor.fields.get('attr').type,'Json');
    assert.match(anchor.fields.get('attr').attributes,/@db\.JsonB/);
    assert.equal(anchor.fields.size,7);
  }
  assert.doesNotMatch(source,/^\s*generator\s+/m);
  assert.doesNotMatch(source,/^\s*@@allow\s*\(/m);
  assert.doesNotMatch(source,/^\s*@@deny\s*\(/m);
});

test('ZenStack V3 runtime schema bridge stays in sync with the frozen contract',async()=>{
  const {schema}=await import('../zenstack/schema.mjs');
  assert.equal(schema.provider.type,'postgresql');
  assert.equal(schema.provider.defaultSchema,'silver');
  assert.equal(Object.keys(schema.models).length,snapshot.tables.length);
  for(const table of snapshot.tables){
    const model=schema.models[modelName(table.table)];
    assert.ok(model,'missing generated model '+table.table);
    assert.deepEqual(model.idFields,table.pk);
    assert.equal(Object.keys(model.fields).length,table.columns.length);
    for(const col of table.columns){
      const field=model.fields[col.name];
      assert.ok(field,'missing generated field '+table.table+'.'+col.name);
      assert.equal(field.type,native[col.format][0].replace('[]',''));
      assert.equal(Boolean(field.array),col.format.startsWith('_'));
      assert.equal(Boolean(field.optional),col.nullable&&!col.format.startsWith('_'));
    }
    assert.equal(model.attributes.find(a=>a.name==='@@map')?.args?.[0]?.value?.value,table.table);
    assert.equal(model.attributes.find(a=>a.name==='@@schema')?.args?.[0]?.value?.value,'silver');
  }
});
