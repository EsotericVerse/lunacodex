import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timeRecordHierarchy} from '../app/loc/culture/time-record-hierarchy-options.mjs';

const era=(uid,title,anchor_ids,attr={})=>({uid,title,type:'era',anchor_ids,attr});
const period=(uid,title,anchor_ids,attr={})=>({uid,title,type:'period',anchor_ids,attr});
const date=(uid,address)=>({uid,type:'anchor',title:address,address});

test('Era rows sort oldest-to-newest by their linked Period/Date, not input order',()=>{
  const rows=[
    era('LATER001','Later',['PERI0002']),
    period('PERI0002','Later period',['DATE0002']),
    date('DATE0002','2025-06-01'),
    era('EARLY001','Early',['PERI0001']),
    date('DATE0001','2010-04-02'),
    period('PERI0001','Early period',['DATE0001']),
    era('NODATE01','Undated',['MISSING1'])
  ];
  const tree=timeRecordHierarchy(rows);
  assert.deepEqual(tree.eras.map(group=>group.row.uid),['EARLY001','LATER001','NODATE01']);
  assert.deepEqual(tree.eras.map(group=>group.start),['2010-04-02','2025-06-01','9999-12-31']);
  assert.deepEqual(tree.eras[0].periods.map(branch=>branch.row.uid),['PERI0001']);
  assert.deepEqual(tree.eras[0].periods[0].dates.map(row=>row.uid),['DATE0001']);
});

test('Periods and Dates have their own chronological order even if saved links are reversed',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','A',['PERI0002','PERI0001']),
    period('PERI0002','Later',['DATE0004','DATE0003']),
    period('PERI0001','Earlier',['DATE0002','DATE0001']),
    date('DATE0004','2020-12-01'),date('DATE0003','2020-01-01'),
    date('DATE0002','2002-07-01'),date('DATE0001','2001-05-01')
  ]);
  assert.deepEqual(tree.eras[0].periods.map(x=>x.row.uid),['PERI0001','PERI0002']);
  assert.deepEqual(tree.eras[0].periods[0].dates.map(x=>x.uid),['DATE0001','DATE0002']);
  assert.deepEqual(tree.eras[0].periods[1].dates.map(x=>x.uid),['DATE0003','DATE0004']);
});

test('Unlinked Period and Date stay in two separate unclassified groups',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','A',['PERI0001']),
    period('PERI0001','Linked',['DATE0001']),
    date('DATE0001','2023-10-01'),
    period('PERI0003','Orphan 2022',['DATE0003']),
    period('PERI0002','Orphan 2020',['DATE0002']),
    date('DATE0003','2022-01-01'),
    date('DATE0002','2020-01-01'),
    date('DATE0000','1990-01-01')
  ]);
  assert.deepEqual(tree.unclassifiedPeriods.map(x=>x.row.uid),['PERI0002','PERI0003']);
  assert.deepEqual(tree.unclassifiedDates.map(x=>x.uid),['DATE0000']);
  assert.equal(tree.eras.length,1);
});

test('Shared Date/Period links are projected without falsely classifying them as orphan',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00002','B',['PERI0001']),era('ERA00001','A',['PERI0001']),
    period('PERI0001','Shared',['DATE0001']),date('DATE0001','2020-01-01')
  ]);
  assert.equal(tree.eras.length,2);
  assert.equal(tree.eras[0].periods[0].dates[0].uid,'DATE0001');
  assert.deepEqual(tree.unclassifiedPeriods,[]);
  assert.deepEqual(tree.unclassifiedDates,[]);
});

test('Saved explicit range sorts Period when its Date endpoints are not present',()=>{
  const tree=timeRecordHierarchy([
    era('ERA00001','Old',['PERI0001']),
    period('PERI0001','Old period',[],{date:['1995-01-01','1995-12-31']}),
    era('ERA00002','New',['PERI0002']),
    period('PERI0002','New period',['DATE0002']),
    date('DATE0002','2005-01-01')
  ]);
  assert.deepEqual(tree.eras.map(x=>x.row.uid),['ERA00001','ERA00002']);
});

test('Time editor uses expandable tree, not one flat picker for TimeAnchor records',()=>{
  const tree=readFileSync(new URL('../app/modular/features/TimeAnchorTree.jsx',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../app/modular/features/CultureTimelineEditor.jsx',import.meta.url),'utf8');
  assert.match(tree,/const \[openEras,setOpenEras\]=useState\(\(\)=>new Set\(\)\)/);
  assert.match(tree,/const \[openPeriods,setOpenPeriods\]=useState\(\(\)=>new Set\(\)\)/);
  assert.match(tree,/aria-expanded=\{expanded\}/);
  assert.match(tree,/periods\.map\(period=>periodItem\(period,ownMatch\)\)/);
  assert.match(tree,/filtered\.map\(dateItem\)/);
  assert.match(editor,/<TimeAnchorTree rows=\{rows\} value=\{selectedId\}/);
  assert.doesNotMatch(editor,/ScopeOptionPicker id="culture-record-search"/);
});
