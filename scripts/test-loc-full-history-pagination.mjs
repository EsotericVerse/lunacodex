import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('culture article titles respect dates and fetch exactly 100 new rows per page',async()=>{
  const source=read('app/loc/culture-query.js');
  const section=source.slice(source.indexOf('export async function selectCultureArticleListPage'),
    source.indexOf('export async function selectScopePeriodWorkIndex'))
    .replace('export async function','async function');
  const records=[
    ...Array.from({length:233},(_,i)=>({uid:'O'+String(i).padStart(7,'0'),
      date:'2026-10-'+String(i%30+1).padStart(2,'0'),title:'October '+i,
      createtime:'2026-10-'+String(i%30+1).padStart(2,'0')+'T12:00:00Z',site:'threads',list:true})),
    ...Array.from({length:5},(_,i)=>({uid:'N'+String(i).padStart(7,'0'),
      date:'2026-11-'+String(i+1).padStart(2,'0'),title:'November '+i,
      createtime:'2026-11-'+String(i+1).padStart(2,'0')+'T12:00:00Z',site:'threads',list:true}))
  ];
  const calls=[];
  const selectRows=async(_table,options)=>{
    calls.push(options);
    const lower=options.filters.find(f=>f.column==='date'&&f.operator==='gte').value;
    const upper=options.filters.find(f=>f.column==='date'&&f.operator==='lte').value;
    const sites=options.filters.find(f=>f.column==='site')?.value||[];
    const filtered=records.filter(r=>r.date>=lower&&r.date<=upper&&sites.includes(r.site))
      .sort((a,b)=>b.createtime.localeCompare(a.createtime)||a.uid.localeCompare(b.uid));
    return {rows:filtered.slice(options.offset,options.offset+options.limit),count:filtered.length};
  };
  const readPage=new Function('selectRows','scopeIdOf','dateFilters',
    section+'\nreturn selectCultureArticleListPage;')(selectRows,String,
    (start,end)=>[{column:'date',operator:'gte',value:start},{column:'date',operator:'lte',value:end}]);
  const scope={id:'lo3rwang',galaxy:'silver.lo3rwang_galaxy'};
  let offset=0;const pages=[];
  for(let i=0;i<4;i++){
    const page=await readPage(scope,{startDate:'2026-10-01',endDate:'2026-10-31',site:'threads',offset});
    pages.push(page);if(!page.hasMore)break;offset=page.nextCursor.offset;
  }
  assert.deepEqual(pages.map(p=>p.rows.length),[100,100,33]);
  assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.uid))).size,233);
  const nextMonth=await readPage(scope,{startDate:'2026-11-01',endDate:'2026-11-30',site:'threads'});
  assert.equal(nextMonth.rows.length,5);
  assert.ok(nextMonth.rows.every(r=>r.title.startsWith('November ')));
  assert.ok(calls.every(x=>x.limit===100));
});

test('complete SELECT makes one unbounded SQL request even when COUNT is absent',async()=>{
  const source=read('app/loc/db-query.mjs');
  const section=source.slice(source.indexOf('export async function selectAllRows('),
    source.indexOf('// Retain the former entry point')).replace('export async function','async function');
  const values=Array.from({length:2305},(_,i)=>i);let calls=0;
  const selectRows=async(_table,{limit,count})=>{
    calls++;
    assert.equal(limit,undefined,'no LIMIT for a complete SELECT');
    assert.equal(count,'exact');
    return {rows:values,count:null,dataSource:'primary'};
  };
  const readAll=new Function('selectRows','DB_QUERY_BATCH_SIZE',
    section+'\nreturn selectAllRows;')(selectRows,5000);
  const result=await readAll('silver.example',{columns:'uid',pageSize:1000});
  assert.equal(result.rows.length,2305);
  assert.equal(result.count,2305);
  assert.equal(calls,1);
});

test('import compares every same-timestamp record, including after 1000',async()=>{
  const source=read('app/loc/ManagementImportPanel.jsx');
  const section=source.slice(source.indexOf('      const readSiteSpan=async(site,start,end)=>{'),
    source.indexOf('      const readRowsByUid=async uids=>{'));
  const records=[...Array.from({length:1250},(_,i)=>({uid:'A'+String(i).padStart(7,'0'),
    site:'threads',createtime:'2026-10-01T09:00:00Z'})),
    ...Array.from({length:50},(_,i)=>({uid:'B'+String(i).padStart(7,'0'),
      site:'threads',createtime:'2026-10-02T09:00:00Z'}))];
  class Query{
    constructor(){this.predicates=[];this.sortField=null;}
    select(){return this;}ilike(k,v){this.predicates.push(r=>r[k]===v);return this;}
    gte(k,v){this.predicates.push(r=>r[k]>=v);return this;}
    lte(k,v){this.predicates.push(r=>r[k]<=v);return this;}
    gt(k,v){this.predicates.push(r=>r[k]>v);return this;}
    eq(k,v){this.predicates.push(r=>r[k]===v);return this;}
    order(k){this.sortField=k;return this;}
    async range(start,end){
      let rows=records.filter(r=>this.predicates.every(p=>p(r)));
      if(this.sortField)rows=rows.sort((a,b)=>String(a[this.sortField]).localeCompare(String(b[this.sortField])));
      return {data:rows.slice(start,end+1),error:null};
    }
  }
  const reader=new Function('dbAuthRelation','galaxy','MAX_ROWS',
    section+'\nreturn readSiteSpan;')(()=>new Query(),'silver.lo3rwang_galaxy',1000);
  const saved=await reader('threads','2026-09-30T00:00:00Z','2026-10-03T00:00:00Z');
  assert.equal(saved.length,1300);assert.equal(new Set(saved.map(r=>r.uid)).size,1300);
});
