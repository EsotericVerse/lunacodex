import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewKeywordDiscovery,existingKeywordSet,readableKeywordContent} from '../app/loc/keyword-discovery.mjs';
import {detectChangepoints,PoissonCost} from 'karaul';
import {parsePortableOrExpression} from '../app/loc/providers/portable-search.mjs';
import {detectCountChangepoints} from '../app/loc/karaul-count-changepoints.mjs';

test('discovery only excludes existing Item names and literal Keywords, without mutating them',()=>{
  const rows=[
    {uid:'It01',type:'item',name:'城市記憶',lists:['夜班生活','混沌']},
    {uid:'Gr01',type:'group',name:'城市組',lists:['It01']}
  ];
  const old=JSON.stringify(rows);
  const scanner=createNewKeywordDiscovery(rows);
  scanner.consume([
    {uid:'Ab12Cd01',content:'都市牢籠，城市記憶，混沌風暴，夜班生活。',createtime:'2026-01-01'},
    {uid:'Ab12Cd02',content:'都市牢籠裡的混沌風暴。',createtime:'2026-02-01'},
    {uid:'Ab12Cd03',content:'混沌風暴中的都市牢籠。',createtime:'2026-03-01'}
  ]);
  const result=scanner.finish();
  const words=new Set(result.candidates.map(row=>row.word));
  assert.equal(result.read,3);
  assert.equal(result.withContent,3);
  assert.ok(words.has('都市牢籠'));
  assert.ok(words.has('混沌風暴'));
  assert.ok(!words.has('城市記憶'));
  assert.ok(!words.has('夜班生活'));
  assert.ok(!words.has('混沌'));
  assert.equal(JSON.stringify(rows),old);
});

test('existing terms use normalized, case-insensitive exact comparison',()=>{
  const set=existingKeywordSet([{type:'item',name:'Ｍａｎｄｏｐｏｐ',lists:['  黑刃 ','DARK JAZZ']}]);
  assert.ok(set.has('mandopop'));
  assert.ok(set.has('黑刃'));
  assert.ok(set.has('dark jazz'));
  assert.ok(!set.has('jazz'));
});

test('candidate needs evidence in multiple documents, not many repeats in one',()=>{
  const discovery=createNewKeywordDiscovery([]);
  discovery.consume([{content:'暗黑爵士，暗黑爵士，暗黑爵士。',createtime:'2026-01-01'}]);
  assert.equal(discovery.finish().candidates.length,0);
  discovery.consume([{content:'暗黑爵士與深夜之聲。',createtime:'2026-02-01'}]);
  const term=discovery.finish().candidates.find(row=>row.word==='暗黑爵士');
  assert.ok(term);
  assert.equal(term.documents,2);
  assert.equal(term.occurrences,4);
  assert.equal(term.sample.includes('暗黑爵士'),true);
});

test('output keeps Chinese and Latin new terms visible without defining Groups',()=>{
  const discovery=createNewKeywordDiscovery([]);
  for(let i=0;i<4;i++)discovery.consume([{
    content:'符文軌跡 旋律星圖 darkjazz ambientwave cyberpunk bossa dancepop synthwave',
    createtime:'2026-0'+(i+1)+'-01'
  }]);
  const result=discovery.finish({limit:5,minDocuments:3});
  assert.ok(result.candidates.some(row=>row.language==='zh'));
  assert.ok(result.candidates.some(row=>row.language==='other'));
  assert.ok(result.candidates.every(row=>!Object.hasOwn(row,'class_uid')&&!Object.hasOwn(row,'group_uid')));
});

test('empty content produces an empty proposal list without writes',()=>{
  const discovery=createNewKeywordDiscovery([]);
  discovery.consume([{content:null},{content:'   '}]);
  const result=discovery.finish();
  assert.equal(result.read,2);
  assert.equal(result.withContent,0);
  assert.deepEqual(result.candidates,[]);
});

test('word joins stop at Chinese connectors and writing-instruction phrases',()=>{
  const scanner=createNewKeywordDiscovery([]);
  for(let i=0;i<3;i++)scanner.consume([{
    content:'都市牢籠與混沌風暴。要用同樣風格寫一首歌。',
    createtime:'2026-10-01'
  }]);
  const terms=new Set(scanner.finish().candidates.map(item=>item.word));
  assert.ok(terms.has('都市牢籠'));
  assert.ok(terms.has('混沌風暴'));
  assert.ok(!terms.has('牢籠與混沌'));
  assert.ok(!terms.has('與混沌風暴'));
  assert.ok(!terms.has('要用同樣風格'));
  assert.ok(!terms.has('同樣風格寫'));
});

test('All complete, broken and HTML-escaped div tags disappear before counting',()=>{
  const raw=[
    '<div class="entry"><span>都市牢籠</span></div>',
    '&lt;div&gt;混沌風暴&lt;/div&gt;',
    '城市記憶 <div',
    '夢想旅程 </div>',
    '<div class="intro"',
    '</div> 混沌風暴'
  ];
  const cleaned=raw.map(readableKeywordContent);
  assert.ok(cleaned.every(text=>!text.includes('<')&&!text.includes('div')));
  const analyzer=createNewKeywordDiscovery([]);
  for(let i=0;i<3;i++){
    analyzer.consume([{content:raw.join(' '),createtime:'2026-10-01'}]);
  }
  const words=analyzer.finish().candidates.map(item=>item.word);
  for(const bad of ['div','span','class','script'])assert.ok(!words.includes(bad));
  assert.ok(words.includes('都市牢籠'));
});

test('Code blocks and serialized JSON metadata are not analyzed as ordinary prose',()=>{
  const samples=[
    '{"type":"div","class":"span","ref":"uid123","content":"城市記憶 <div>幸福頻段</div>"}',
    '文章開始 \`\`\`html\\n<div class="template">CSS layout</div>\\n\`\`\` 城市記憶',
    '<style>.myclass{display:block}</style>混沌風暴'
  ];
  const cleaned=samples.map(readableKeywordContent);
  assert.ok(cleaned[0].includes('城市記憶'));
  assert.ok(!cleaned[0].includes('"type"')&&!cleaned[0].includes('"class"'));
  assert.ok(!cleaned[1].includes('template'));
  assert.ok(!cleaned[2].includes('display'));
  const analyzer=createNewKeywordDiscovery([]);
  for(let i=0;i<3;i++)analyzer.consume(samples.map(content=>({content,createtime:'2026-09-01'})));
  const words=analyzer.finish().candidates.map(item=>item.word);
  for(const bad of ['div','span','template','display','myclass'])assert.ok(!words.includes(bad));
});


test('PELT suggestions use weighted novel hits per article, not a twice-divided monthly rate',()=>{
  const emitted=[];
  const code=readFileSync(new URL('../app/loc/keyword-discovery-worker.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'');
  const fakeDiscovery={
    consume:()=>({read:220,withContent:220}),
    finish:()=>({
      read:220,withContent:220,
      candidates:[{word:'暗黑爵士',documents:20,occurrences:20,
        months:[['2026-01',5],['2026-02',5],['2026-03',5],['2026-04',5]]}],
      monthCoverage:[
        {month:'2026-01',documents:100,existingCovered:10},
        {month:'2026-02',documents:100,existingCovered:10},
        {month:'2026-03',documents:10,existingCovered:5},
        {month:'2026-04',documents:10,existingCovered:5}
      ]
    })
  };
  const self={postMessage:data=>emitted.push(data)};
  runInNewContext(code,{self,createNewKeywordDiscovery:()=>fakeDiscovery,
    detectCountChangepoints:series=>series.length>=4?[2]:[]});
  self.onmessage({data:{type:'start',existingRows:[]}});
  self.onmessage({data:{type:'batch',rows:[]}});
  self.onmessage({data:{type:'finish'}});
  const result=emitted.at(-1).result;
  assert.equal(result.dense.start,'2026-03');
  assert.equal(result.dense.novelPerArticle,0.5);
  assert.equal(result.sparse.novelPerArticle,0.05);
  assert.equal(result.candidates[0].trendChanges,1);
  assert.equal(result.overallExistingRatio,30/220);
});

test('new-term discovery uses one-pass date + UID keysets including dense days and undated pages',async()=>{
  const code=readFileSync(new URL('../app/loc/keyword-discovery-runner.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replaceAll('export async function ','async function ')
    .replaceAll('import.meta.url',"'file:///test.mjs'");
  // Dense same-date peer groups and missing dates must not trigger rereads.
  const docs=Array.from({length:4207},(_,i)=>({
    uid:'Aa'+String(i).padStart(6,'0'),
    date:i<1550?'2026-01-01':
      i<2450?'2026-02-01':
      i<2800?'2026-03-01':null,
    content:'都市牢籠',createtime:'2026-01-01T00:00:00Z'
  }));
  const queries=[],batches=[];
  const dbAuthRelation=()=>({
    select(columns,options={}){
      const query={columns,options,filters:[],orders:[],or:'',limit:Infinity};
      const builder={
        gt(k,v){query.filters.push([k,'gt',v]);return builder;},
        not(k,op,v){query.filters.push([k,'not',op,v]);return builder;},
        eq(k,v){query.filters.push([k,'eq',v]);return builder;},
        is(k,v){query.filters.push([k,'is',v]);return builder;},
        or(expression){query.or=expression;return builder;},
        order(k){query.orders.push(k);return builder;},
        limit(n){query.limit=n;return builder;},
        range(){throw new Error('Deep OFFSET must not be used by keyword discovery');},
        then(resolve,reject){
          queries.push(query);
          let rows=docs;
          for(const [key,op,value] of query.filters){
            if(op==='gt')rows=rows.filter(row=>row[key]>value);
            else if(op==='eq')rows=rows.filter(row=>row[key]===value);
            else if(op==='is')rows=rows.filter(row=>row[key]===null);
            else if(op==='not')rows=rows.filter(row=>row[key]!==null);
          }
          if(query.or){
            const parsed=parsePortableOrExpression(query.or);
            assert.equal(parsed.items.length,2);
            const first=parsed.items[0],second=parsed.items[1];
            assert.equal(first.column,'date');
            assert.equal(first.operator,'gt');
            assert.equal(second.type,'and');
            assert.equal(second.items.length,2);
            const date=first.value,uid=second.items[1].value;
            assert.equal(second.items[0].value,date);
            assert.equal(second.items[1].column,'uid');
            rows=rows.filter(row=>row.date>date||
              row.date===date&&row.uid>uid);
          }
          if(query.orders.length)rows=[...rows].sort((a,b)=>{
            for(const field of query.orders){
              const comparison=String(a[field]).localeCompare(String(b[field]),'en');
              if(comparison)return comparison;
            }
            return 0;
          });
          // Emulate a transport which returns less than LIMIT without being done.
          const cap=Math.min(query.limit,413);
          return Promise.resolve({
            data:options.head?null:rows.slice(0,cap),
            count:options.count==='exact'?rows.length:null,error:null
          }).then(resolve,reject);
        }
      };
      return builder;
    }
  });
  const Worker=class{
    postMessage(data){
      Promise.resolve().then(()=>this.onmessage({
        data:data.type==='start'?{type:'ready'}:
          data.type==='finish'?{type:'finished',result:{read:batches.flat().length}}:
            (batches.push(data.rows),{type:'progress',withContent:batches.flat().length})
      }));
    }
    terminate(){}
  };
  const ctx={dbAuthRelation,Worker,URL};
  runInNewContext(code+';this.suggestNewKeywords=suggestNewKeywords;',ctx);
  const result=await ctx.suggestNewKeywords({
    galaxy:'silver.lo3rwang_galaxy',existingRows:[],onProgress:()=>{}
  });
  const all=batches.flat().map(row=>row.uid);
  assert.equal(result.read,docs.length);
  assert.equal(new Set(all).size,docs.length);
  assert.deepEqual(new Set(all),new Set(docs.map(row=>row.uid)));
  assert.ok(queries.some(query=>query.orders.join(',')==='date,uid'));
  assert.ok(queries.some(query=>query.or.includes('uid.gt.')));
  assert.ok(queries.some(query=>query.filters.some(([field,op])=>field==='uid'&&op==='gt')));
  assert.equal(queries.filter(query=>query.options.head).length,1);
  assert.ok(queries.every(query=>query.limit===Infinity||query.limit<=1000));
  assert.ok(queries.every(query=>!query.orders.includes('createtime')));
  // Excluding the initial count query, one scan delivers every body once.
  const transferred=batches.reduce((sum,batch)=>sum+batch.length,0);
  assert.equal(transferred,docs.length);
});

test('Karaul exact-count prefix cost preserves native Poisson changepoints',()=>{
  const sources=[
    [0,0,0,0],
    [3,3,3,3,3,3],
    [0,0,1,2,0,0,0,8,12,11,9,0,0,0],
    [1,1,1,1,8,8,9,8,0,0,0,0,4,4,4,4],
    Array.from({length:180},(_,i)=>i>=60&&i<120?10:i%17===0?2:0),
    Array.from({length:180},()=>0)
  ];
  for(const series of sources){
    assert.deepEqual(detectCountChangepoints(series),
      detectChangepoints(series,new PoissonCost()),
      'Native Karaul results must remain unchanged for count data');
  }
  // Non-count values preserve the native Karaul cost path.
  for(const series of [[1,1.5,2,3],[3,-1,4,0]]){
    assert.deepEqual(detectCountChangepoints(series),
      detectChangepoints(series,new PoissonCost()));
  }
});

test('keyword suggestions run PELT only for the 120 retained candidates',()=>{
  const code=readFileSync(new URL('../app/loc/keyword-discovery-worker.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'');
  const emitted=[];
  let calls=0;
  const monthCoverage=['2026-01','2026-02','2026-03','2026-04']
    .map(month=>({month,documents:100,existingCovered:0}));
  const candidates=Array.from({length:240},(_,i)=>({
    word:'term'+i,documents:4,occurrences:4,
    months:[['2026-01',1],['2026-02',1],['2026-03',1],['2026-04',1]]
  }));
  const self={postMessage:data=>emitted.push(data)};
  runInNewContext(code,{self,
    createNewKeywordDiscovery:()=>({consume:()=>({read:4,withContent:4}),
      finish:()=>({candidates,monthCoverage})}),
    detectCountChangepoints:()=>{calls++;return [2];}
  });
  self.onmessage({data:{type:'start',existingRows:[]}});
  self.onmessage({data:{type:'finish'}});
  assert.equal(emitted.at(-1).result.candidates.length,120);
  assert.equal(calls,121,'1 density scan + 120 retained candidate scans');
});

test('new keyword discovery retains counts and Unicode normalization across repeated batches',()=>{
  const scanner=createNewKeywordDiscovery([
    {type:'item',name:'ｍａｎｄｏｐｏｐ',lists:['城市記憶']}
  ]);
  const article='都市牢籠，都市牢籠，城市記憶，Ｍａｎｄｏｐｏｐ，darkjazz。';
  for(let index=0;index<100;index++)scanner.consume([{
    uid:'AA'+String(index).padStart(6,'0'),content:article,
    createtime:'2026-01-01'
  }]);
  const result=scanner.finish();
  const terms=new Map(result.candidates.map(row=>[row.word,row]));
  assert.equal(result.read,100);
  assert.equal(terms.get('都市牢籠').documents,100);
  assert.equal(terms.get('都市牢籠').occurrences,200);
  assert.equal(terms.get('darkjazz').documents,100);
  assert.equal(terms.has('mandopop'),false);
  assert.equal(terms.has('城市記憶'),false);
});

test('keyword lookahead overlaps Worker parsing with one bounded SQL read',async()=>{
  const code=readFileSync(new URL('../app/loc/keyword-discovery-runner.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replaceAll('export async function ','async function ')
    .replaceAll('import.meta.url',"'file:///test.mjs'");
  const docs=Array.from({length:36},(_,i)=>({
    uid:'Ab'+String(i).padStart(6,'0'),date:i<30?'2026-01-01':null,
    createtime:'2026-01-01',content:'都市牢籠'
  }));
  const queries=[],received=[],lookaheadAtBatch=[];
  let readsInFlight=0,maxReadsInFlight=0,abortedSignals=[];
  const dbAuthRelation=()=>({
    select(columns,options={}){
      const query={columns,options,filters:[],orders:[],or:'',limit:Infinity,signal:null};
      const builder={
        gt(k,v){query.filters.push([k,'gt',v]);return builder;},
        not(k,op,v){query.filters.push([k,'not',op,v]);return builder;},
        eq(k,v){query.filters.push([k,'eq',v]);return builder;},
        is(k,v){query.filters.push([k,'is',v]);return builder;},
        or(value){query.or=value;return builder;},
        order(k){query.orders.push(k);return builder;},
        limit(n){query.limit=n;return builder;},
        abortSignal(v){query.signal=v;abortedSignals.push(v);return builder;},
        then(resolve,reject){
          readsInFlight++;maxReadsInFlight=Math.max(maxReadsInFlight,readsInFlight);
          let rows=docs;
          for(const [key,operator,value] of query.filters){
            if(operator==='is')rows=rows.filter(row=>row[key]===null);
            else if(operator==='not')rows=rows.filter(row=>row[key]!==null);
            else if(operator==='gt')rows=rows.filter(row=>row[key]>value);
          }
          if(query.or){
            const node=parsePortableOrExpression(query.or);
            const date=node.items[0].value,uid=node.items[1].items[1].value;
            rows=rows.filter(row=>row.date>date||row.date===date&&row.uid>uid);
          }
          if(query.orders.length)rows=[...rows].sort((a,b)=>{
            for(const col of query.orders){
              if(a[col]!==b[col])return a[col]<b[col]?-1:1;
            }
            return 0;
          });
          return Promise.resolve().then(()=>({
            data:query.options.head?null:rows.slice(0,Math.min(query.limit,7)),
            count:query.options.count==='exact'?rows.length:null,error:null
          })).then(value=>{readsInFlight--;return value},error=>{readsInFlight--;throw error})
            .then(resolve,reject);
        }
      };
      queries.push(query);
      return builder;
    }
  });
  const Worker=class{
    postMessage(data){
      if(data.type==='batch'){
        received.push(...data.rows);
        lookaheadAtBatch.push(queries.filter(query=>query.columns==='uid,content,createtime,date').length);
      }
      Promise.resolve().then(()=>this.onmessage({data:
        data.type==='start'?{type:'ready'}:
        data.type==='finish'?{type:'finished',result:{read:received.length}}:
        {type:'progress',withContent:received.length}
      }));
    }
    terminate(){}
  };
  const ctx={dbAuthRelation,Worker,URL,AbortController,AbortSignal};
  runInNewContext(code+';this.suggestNewKeywords=suggestNewKeywords;',ctx);
  const result=await ctx.suggestNewKeywords({
    galaxy:'silver.lo3rwang_galaxy',existingRows:[]
  });
  assert.equal(result.read,docs.length);
  assert.equal(new Set(received.map(row=>row.uid)).size,docs.length);
  assert.ok(lookaheadAtBatch[0]>=2,'next SQL page must start before first Worker batch');
  assert.ok(maxReadsInFlight<=1,'read requests may not fan out');
  assert.ok(abortedSignals.length>0&&abortedSignals.every(s=>s.aborted),
    'read signal must abort in finally');
});

test('Aho coverage respects NFKC, regex punctuation and existing Item words',()=>{
  const scanner=createNewKeywordDiscovery([
    {type:'item',name:'c++',lists:['DARK JAZZ','ＭＡＮＤＯＰＯＰ','城市記憶']}
  ]);
  scanner.consume([
    {uid:'Ab000001',content:'c++ 帶來新的語言節奏',createtime:'2026-01-01'},
    {uid:'Ab000002',content:'DARK JAZZ 與城市記憶',createtime:'2026-01-02'},
    {uid:'Ab000003',content:'毫無相同關鍵詞的旅行記事',createtime:'2026-02-01'},
    {uid:'Ab000004',content:'Ｍａｎｄｏｐｏｐ 交錯節拍',createtime:'2026-02-02'}
  ]);
  const result=scanner.finish({minDocuments:1});
  assert.deepEqual(result.monthCoverage,[
    {month:'2026-01',documents:2,existingCovered:2},
    {month:'2026-02',documents:2,existingCovered:1}
  ]);
});
