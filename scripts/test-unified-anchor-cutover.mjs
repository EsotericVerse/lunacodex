import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isUnifiedAnchorScope,unifiedAnchorSpec,toAnchorRow,fromAnchorRow,unifiedAnchorRelation}
  from '../app/loc/unified-anchor-compat.mjs';
import {readUnifiedAnchorUids} from '../app/loc/unified-anchor-uids.mjs';

const spec=section=>unifiedAnchorSpec('silver','lo3rwang_'+section);

test('lo3rwang and lrunes legacy relations share the eight-character Anchor contract',()=>{
  for(const [suffix,kind] of Object.entries({
    time:'time',trace:'trace',keywords:'keywords',galaxy_media:'media'
  }))assert.deepEqual(spec(suffix),{table:'lo3rwang_anchor',kind,legacy:suffix});
  for(const [suffix,kind] of Object.entries({time:'time',trace:'trace',keywords:'keywords',galaxy_media:'media'}))
    assert.deepEqual(unifiedAnchorSpec('silver','lrunes_'+suffix),{table:'lrunes_anchor',kind,legacy:suffix});
});

test('date, period and era store typed contents in attr without label',()=>{
  const time=spec('time');
  const date=toAnchorRow(time,{uid:'A1234567',type:'anchor',address:'2026-11-02',
    range:{version:1,segments:['bogus']}});
  assert.deepEqual(date,{uid:'A1234567',type:'date',attr:{date:'2026-11-02'}});
  const period=toAnchorRow(time,{uid:'B1234567',type:'period',anchor_ids:['A1234567']});
  assert.deepEqual(period.attr,{uid:['A1234567']});
  const era=toAnchorRow(time,{uid:'C1234567',type:'era',anchor_ids:['B1234567']});
  assert.deepEqual(era.attr,{period:['B1234567']});
  assert.equal(fromAnchorRow(time,date).address,'2026-11-02');
  assert.deepEqual(fromAnchorRow(time,period).anchor_ids,['A1234567']);
  assert.deepEqual(fromAnchorRow(time,era).anchor_ids,['B1234567']);
  for(const row of [date,period,era])assert.equal(Object.hasOwn(row,'label'),false);
});

test('point, path and trace use geographic and UID relationships in attr',()=>{
  const trace=spec('trace');
  const point=toAnchorRow(trace,{
    uid:'P1234567',trace_type:'space_anchor',address:[121.5,25.1],times:[]
  });
  assert.deepEqual(point,{uid:'P1234567',type:'point',attr:{longitude:121.5,latitude:25.1}});
  assert.deepEqual(fromAnchorRow(trace,point).address,[121.5,25.1]);
  const path=toAnchorRow(trace,{uid:'X1234567',type:'path',anchor_list:['P1234567','P7654321']});
  assert.deepEqual(path.attr,{point:['P1234567','P7654321']});
  assert.deepEqual(fromAnchorRow(trace,path).anchor_list,['P1234567','P7654321']);
  const map=toAnchorRow(trace,{uid:'T1234567',type:'trace',anchor_list:['P1234567'],
    route_list:{routes:['X1234567'],segments:[]}});
  assert.deepEqual(map.attr,{point:['P1234567'],path:['X1234567']});
});

test('keyword classification keeps 8-character links in attr, not obsolete label lists',()=>{
  const keywords=spec('keywords');
  const group=toAnchorRow(keywords,{
    uid:'G1234567',type:'group',name:'靈魂組',lists:['I1234567'],
    uid_lists:{articles:['A1234567','B1234567','A1234567']}
  });
  assert.deepEqual(group.attr,{uid:['I1234567'],total:2});
  assert.equal(Object.hasOwn(group,'label'),false);
  assert.deepEqual(fromAnchorRow(keywords,group).lists,['I1234567']);
  const item=toAnchorRow(keywords,{
    uid:'I1234567',type:'item',name:'靈',lists:['精神','心靈'],
    uid_lists:{hits:[{uid:'A1234567',times:3}]}
  });
  assert.deepEqual(item.attr,{keyword:['精神','心靈'],total:3});
  const category=toAnchorRow(keywords,{
    uid:'C1234567',type:'category',name:'符文66',lists:['G1234567']
  });
  assert.deepEqual(category.attr,{uid:['G1234567']});
});

test('media URL goes to attr.url, not to the article body or a separate label',()=>{
  const media=spec('galaxy_media');
  const saved=toAnchorRow(media,{
    uid:'M1234567',type:'音樂',url:'https://suno.com/song/abc',
    meta_tags:'song metadata',createtime:'2026-11-02'
  });
  assert.deepEqual(saved,{
    uid:'M1234567',type:'suno',attr:{url:'https://suno.com/song/abc'},
    description:'song metadata'
  });
  const decoded=fromAnchorRow(media,saved);
  assert.equal(decoded.url,'https://suno.com/song/abc');
  assert.equal(decoded.meta_tags,'song metadata');
  assert.equal(decoded.createtime,null);
});

test('legacy read selects attr and reconstructs date without selecting nonexistent label',async()=>{
  const calls=[],rows=[
    {uid:'A1234567',type:'date',title:'生日',attr:{date:'2026-11-02'}},
    {uid:'M1234567',type:'suno',title:'音樂',attr:{url:'https://suno.com/song/2'}}
  ];
  const schema={from:table=>{
    assert.equal(table,'lo3rwang_anchor');
    const filters=[];
    const q={
      select(columns){calls.push(['select',columns]);return q},
      eq(column,value){filters.push(row=>row[column]===value);return q},
      in(column,values){filters.push(row=>values.includes(row[column]));return q},
      range:async()=>({data:rows.filter(r=>filters.every(f=>f(r))),error:null})
    };
    return q;
  }};
  const r=await unifiedAnchorRelation(schema,spec('time')).select('uid,title,address')
    .eq('type','anchor').limit(5);
  assert.deepEqual(r.data,[{uid:'A1234567',title:'生日',address:'2026-11-02'}]);
  assert.ok(calls.some(([op,cols])=>op==='select'&&cols.includes('attr')&&!cols.includes('label')));
});

test('new date anchor insertion stores only attr and enforces eight-character UID',async()=>{
  const saved=[];
  const schema={from:()=>({
    insert:rows=>({
      select:async()=>{
        saved.push(...(Array.isArray(rows)?rows:[rows]));
        return {data:saved,error:null};
      }
    })
  })};
  const r=await unifiedAnchorRelation(schema,spec('time')).insert({
    uid:'A1234567',type:'anchor',address:'2026-11-02',title:'打卡日期'
  }).select('uid,address');
  assert.deepEqual(saved[0].attr,{date:'2026-11-02'});
  assert.equal(Object.hasOwn(saved[0],'label'),false);
  assert.equal(r.data[0].address,'2026-11-02');
  await assert.rejects(unifiedAnchorRelation(schema,spec('time')).insert({
    uid:'A001',type:'anchor',address:'2026-11-02'
  }).select('uid'),/eight-character|UID/);
});

test('partial update merges existing attr keys without clearing current relationships',async()=>{
  let written;
  const schema={from:()=>({
    select:()=>({
      eq(){return this},in(){return this},
      maybeSingle:async()=>({data:{
        uid:'X1234567',type:'path',attr:{point:['P1234567','P7654321']}
      },error:null})
    }),
    update:value=>{
      written=value;
      return {eq(){return this},in(){return this},select:async()=>({
        data:[{uid:'X1234567',type:'path',attr:value.attr}],error:null
      })};
    }
  })};
  await unifiedAnchorRelation(schema,spec('trace'))
    .update({title:'路線改名'}).eq('uid','X1234567').select('uid');
  assert.deepEqual(written,{title:'路線改名'});
  await unifiedAnchorRelation(schema,spec('trace'))
    .update({anchor_list:['P1234567']}).eq('uid','X1234567').select('uid,anchor_list');
  assert.deepEqual(written.attr,{point:['P1234567']});
});

test('read-only UID pool shares the physical unified Anchor across feature sections',async()=>{
  const rows=await readUnifiedAnchorUids('silver.lo3rwang_time',
    async(table,offset)=>{assert.equal(table,'silver.lo3rwang_anchor');
      return offset===0?[{uid:'A1234567'}]:[];},{pageSize:2});
  assert.deepEqual(rows,[{uid:'A1234567'}]);
});

test('unified source code does not project or persist the removed label column',()=>{
  const code=readFileSync(new URL('../app/loc/unified-anchor-compat.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/physicalColumns=.*['"]label['"]/);
  assert.doesNotMatch(code,/\bout\.label\s*=/);
  assert.doesNotMatch(code,/\brow\.label\b/);
});


test('scope time readers use the virtual Time projection, not physical Anchor columns',()=>{
  const scope=readFileSync(new URL('../app/loc/scope-data.js',import.meta.url),'utf8');
  assert.match(scope,/time:\x60silver\.\${id}_time\x60/);
  assert.match(scope,/anchor:\x60silver\.\${id}_\${anchorSuffix}\x60/);
});

test('time date predicates and media date windows stay on SQL JSON paths',async()=>{
  const calls=[];
  const rows=[
    {uid:'A1234567',type:'date',title:'時間',attr:{date:'2026-11-02'}},
    {uid:'M1234567',type:'suno',title:'歌曲',attr:{url:'https://suno.com/song/1',date:'2026-11-02'}}
  ];
  const schema={from:()=>{const q={
    select:()=>q,
    eq:(col,value)=>{calls.push(['eq',col,value]);return q},
    in:(col,value)=>{calls.push(['in',col,value]);return q},
    gte:(col,value)=>{calls.push(['gte',col,value]);return q},
    lte:(col,value)=>{calls.push(['lte',col,value]);return q},
    order:(col)=>{calls.push(['order',col]);return q},
    range:async()=>({data:rows,error:null})
  };return q;}};
  const time=await unifiedAnchorRelation(schema,spec('time'))
    .select('uid,title,address').eq('type','anchor').eq('address','2026-11-02').limit(10);
  assert.ok(calls.some(([op,col,value])=>op==='eq'&&col==='attr->>date'&&value==='2026-11-02'));
  assert.equal(time.data[0].address,'2026-11-02');
  calls.length=0;
  const media=await unifiedAnchorRelation(schema,spec('galaxy_media'))
    .select('uid,date,createtime,url').gte('date','2026-11-01').lte('date','2026-11-30')
    .order('date',{ascending:true}).limit(10);
  assert.ok(calls.some(([op,col,value])=>op==='gte'&&col==='attr->>date'&&value==='2026-11-01'));
  assert.ok(calls.some(([op,col,value])=>op==='lte'&&col==='attr->>date'&&value==='2026-11-30'));
  assert.ok(calls.some(([op,col])=>op==='order'&&col==='attr->>date'));
  assert.equal(media.data[1].createtime,'2026-11-02');
  assert.equal(media.data[1].date,'2026-11-02');
});


test('Search editor uses eight-character Point UIDs and only persisted media attrs',()=>{
  const draft=readFileSync(new URL('../app/modular/features/search-edit-draft.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../app/modular/features/Search.jsx',import.meta.url),'utf8');
  assert.match(draft,/定錨點 ID 必須為八碼/);
  assert.match(draft,/for\(const key of \['type','url','meta_tags'\]\)/);
  assert.match(draft,/changed\.date=/);
  assert.match(ui,/const MEDIA_EDITOR_COLUMNS='uid,type,title,url,meta_tags,date'/);
  assert.doesNotMatch(ui,/const MEDIA_EDITOR_COLUMNS='uid,location/);
});


test('device-local SQLite and LOC Group do not use scoped cloud Anchor projections',()=>{
  assert.equal(isUnifiedAnchorScope('local'),false);
  assert.equal(isUnifiedAnchorScope('loc'),false);
  assert.equal(isUnifiedAnchorScope('lo3rwang'),true);
  assert.equal(isUnifiedAnchorScope('lrunes'),true);
  assert.equal(unifiedAnchorSpec('silver','local_time'),null);
});
