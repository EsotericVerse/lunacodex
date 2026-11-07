import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../app/loc/providers/kysely-scope-admin.mjs',import.meta.url),'utf8');

test('new Scope does not expose private Galaxy or block anonymous public pages',()=>{
  assert.ok(code.includes('const publicGalaxy=sql'+'`search is true'));
  assert.match(code,/lower\(coalesce\(site,''\)\)='mcp'/);
  assert.match(code,/lower\(coalesce\(site,''\)\)='github'/);
  assert.match(code,/create policy.*_galaxy_scope_read/);
  const provision=code.slice(code.indexOf('async function provisionScope('));
  assert.equal((provision.match(/for select to anon,anonymous,authenticated/g)||[]).length,4);
  assert.match(provision,/grant select on/);
  assert.ok(provision.includes('to anon,anonymous,authenticated'));
  assert.equal((code.match(/export async function executeKyselyScopeAdmin/g)||[]).length,1);
  assert.doesNotMatch(provision,/for select to anonymous,authenticated using \(true\)/);
});

test('new Scope checks all reserved table names in one SQL round trip',()=>{
  const provision=code.slice(code.indexOf('async function provisionScope('));
  assert.match(provision,/const occupied=await sql/);
  assert.match(provision,/c\.relname in/);
  assert.doesNotMatch(provision,/for\(const name of variants\)if\(await existsRelation/);
});

test('default Keyword Class is cloned with batched Kysely SELECT and INSERT, preserving UID tree',async()=>{
  const begin=code.indexOf('async function copyDefaultKeywordClass(');
  const end=code.indexOf('async function provisionScope(',begin);
  assert.ok(begin>0&&end>begin);
  const source=code.slice(begin,end);
  let nextId=0;
  const allocateUid=()=> 'N'+String(++nextId).padStart(7,'0');
  const sql=(strings,...values)=>({strings:[...strings],values});
  const clone=new Function('allocateAnchorUid','UID','sql','fail',
    source+';return copyDefaultKeywordClass;')(
      allocateUid,/^[A-Za-z0-9]{8}$/,sql,msg=>{throw new Error(msg);}
    );
  const classRow={uid:'Class001',title:'C',description:'Class',attr:{uid:['Group001']}};
  const groupRow={uid:'Group001',title:'G',description:'Group',attr:{uid:['Item0001','Item0002'],total:12}};
  const items=[
    {uid:'Item0001',title:'I1',description:'First',attr:{keyword:['one'],total:7}},
    {uid:'Item0002',title:'I2',description:'Second',attr:{keyword:['two'],total:8}}
  ];
  let queries=0;
  const batches=[];
  const trx={
    selectFrom(table){
      const filters=[];
      return {
        select(){return this;},
        where(...args){filters.push(args);return this;},
        async executeTakeFirst(){
          queries++;
          if(table==='silver.lo3rwang')return {current_keyword_class_uid:'Class001'};
          if(filters.some(x=>x[0]==='type'&&x[2]==='class'))return classRow;
          if(filters.some(x=>x[0]==='type'&&x[2]==='category'))
            return {title:'Category',description:'Head'};
          throw new Error('Unexpected single-record SELECT');
        },
        async execute(){
          queries++;
          if(filters.some(x=>x[0]==='type'&&x[2]==='group'))return [groupRow];
          if(filters.some(x=>x[0]==='type'&&x[2]==='item'))return items;
          throw new Error('Unexpected bulk SELECT');
        }
      };
    },
    insertInto(table){
      assert.equal(table,'silver.writer_anchor');
      return {
        values(rows){this.rows=rows;return this;},
        async execute(){queries++;batches.push(this.rows);}
      };
    }
  };
  const result=await clone(trx,'writer','silver.writer_anchor');
  assert.equal(queries,6,'1 config, 1 class, 1 category, 1 group batch, 1 item batch, 1 insert');
  assert.equal(batches.length,1,'not one INSERT per keyword');
  assert.equal(result.count,2);
  const rows=batches[0];
  assert.equal(rows.length,5);
  const attr=row=>JSON.parse(row.attr.values[0]);
  const category=rows.find(row=>row.type==='category');
  const klass=rows.find(row=>row.type==='class');
  const group=rows.find(row=>row.type==='group');
  const newItems=rows.filter(row=>row.type==='item');
  assert.deepEqual(attr(category).uid,[klass.uid]);
  assert.deepEqual(attr(klass).uid,[group.uid]);
  assert.deepEqual(attr(group).uid,newItems.map(item=>item.uid));
  assert.ok(newItems.every(row=>attr(row).total===0));
  assert.equal(attr(group).total,0);
  assert.deepEqual(newItems.map(row=>attr(row).keyword),[['one'],['two']]);
});
