import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileExistingImportAnchors} from '../app/loc/reconcile-import-anchors.mjs';

function mockDatabase(){
  const galaxy=[
    {uid:'AAAAAAAA',location:'台北車站',date:'2024-04-05',createtime:'2024-04-04T18:00:00Z',place_id:null},
    {uid:'BBBBBBBB',location:'台北車站',date:'2024-04-05',createtime:'2024-04-05T08:00:00Z',place_id:null},
    {uid:'CCCCCCCC',location:null,date:'2024-04-06',createtime:'2024-04-06T08:00:00Z',place_id:null}
  ];
  const trace=[];
  const time=[
    {uid:'0001',type:'anchor',address:'2024-04-01',anchor_ids:[]},
    {uid:'0002',type:'anchor',address:'2024-04-30',anchor_ids:[]},
    {uid:'0003',type:'period',address:null,anchor_ids:['0001','0002']}
  ];
  let traceIndex=4;
  const relation=table=>{
    const source=table==='silver.lo3rwang_galaxy'?galaxy:
      table==='silver.lo3rwang_trace'?trace:
      table==='silver.lo3rwang_anchor'?[...time,...trace]:time;
    const selectors=[];
    const query={
      select(){return query;},
      not(column,operator,value){if(column==='location'&&operator==='is'&&value===null)
        selectors.push(row=>row.location!==null);return query;},
      eq(column,value){selectors.push(row=>row[column]===value);return query;},
      order(){return query;},
      async range(start,end){
        const rows=source.filter(row=>selectors.every(matches=>matches(row)));
        return {data:rows.slice(start,end+1),error:null};
      },
      insert(rows){return {select:async()=>{
        const items=rows.map(row=>table.endsWith('_trace')
          ?{uid:(traceIndex++).toString(16).toUpperCase().padStart(4,'0'),...row}:row);
        source.push(...items);
        return {data:items,error:null};
      }};},
      update(values){return {
        eq(column,value){return {
          eq:async(nextColumn,nextValue)=>{
            const row=source.find(row=>row[column]===value&&row[nextColumn]===nextValue);
            if(!row)return {error:{message:'Row missing'}};
            Object.assign(row,values);return {error:null};
          }
        };}
      };}
    };
    return query;
  };
  const updateImportRows=async(table,rows)=>{
    assert.equal(table,'silver.lo3rwang_galaxy');
    for(const input of rows){
      const row=galaxy.find(item=>item.uid===input.uid);
      if(!row)throw Error('Missing uid');
      row.place_id=input.place_id;
    }
    return {count:rows.length};
  };
  return {galaxy,trace,time,relation,updateImportRows};
}

test('backfills only location articles, persists exact Galaxy.date and is idempotent',async()=>{
  const db=mockDatabase();
  const options={scopeId:'lo3rwang',galaxy:'silver.lo3rwang_galaxy',
    timeTable:'silver.lo3rwang_time',relation:db.relation,
    updateImportRows:db.updateImportRows};
  const first=await reconcileExistingImportAnchors(options);
  assert.equal(first.scanned,2);
  assert.equal(first.linked,2);
  assert.equal(first.places.created,1);
  assert.equal(first.dates.created,1);
  assert.equal(first.visits,2);
  assert.equal(db.trace.length,1);
  assert.deepEqual(db.trace[0].times,[
    '2024-04-04T18:00:00.000Z','2024-04-05T08:00:00.000Z'
  ]);
  assert.equal(db.galaxy[0].place_id,db.trace[0].uid);
  assert.equal(db.galaxy[1].place_id,db.trace[0].uid);
  assert.equal(db.galaxy[2].place_id,null);
  assert.equal(db.time.at(-1).address,'2024-04-05');
  assert.equal(db.time.at(-1).type,'anchor');
  // New Time anchors use independent eight-character physical UIDs,
  // never colliding with existing Trace anchors or one another.
  assert.equal(db.trace[0].uid,'0004');
  assert.match(db.time.at(-1).uid,/^[A-Za-z0-9]{8}$/);
  assert.notEqual(db.time.at(-1).uid,db.trace[0].uid);
  const second=await reconcileExistingImportAnchors(options);
  assert.equal(second.linked,0);
  assert.equal(second.places.created,0);
  assert.equal(second.dates.created,0);
  assert.equal(second.visits,0);
  assert.equal(db.trace.length,1);
  assert.equal(db.time.length,4);
});

test('valid saved Trace IDs restore visits when place names are ambiguous',async()=>{
  const db=mockDatabase();
  db.trace.push(
    {uid:'AB12',trace_type:'space_anchor',title:'台北車站',address:[121.5,25],times:[]},
    {uid:'CD34',trace_type:'space_anchor',title:'台北車站',address:[121.6,25],times:[]}
  );
  db.galaxy[0].place_id='AB12';
  db.galaxy[1].place_id='CD34';
  const result=await reconcileExistingImportAnchors({
    scopeId:'lo3rwang',galaxy:'silver.lo3rwang_galaxy',
    timeTable:'silver.lo3rwang_time',relation:db.relation,
    updateImportRows:db.updateImportRows
  });
  assert.equal(result.linked,0);
  assert.equal(result.unmatched,0);
  assert.equal(result.places.created,0);
  assert.equal(result.visits,2);
  assert.equal(db.trace.length,2);
  assert.deepEqual(db.trace[0].times,['2024-04-04T18:00:00.000Z']);
  assert.deepEqual(db.trace[1].times,['2024-04-05T08:00:00.000Z']);
});
