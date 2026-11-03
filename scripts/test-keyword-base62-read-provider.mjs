import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createDatabaseClient} from '../app/loc/db-contract.mjs';

const treeSql=readFileSync(
  new URL('../supabase/migrations/20261029226100_keyword_tree_readers.sql',import.meta.url),'utf8');
const retirementSql=readFileSync(
  new URL('../supabase/migrations/20261030230000_keyword_class_base62_read.sql',import.meta.url),'utf8');

const catalog=(uid)=>({class_uid:uid,rows:[
  {uid,type:'class',name:'Sample',desc:'',lists:[],uid_lists:[]}
]});

function client({published=null,privateRows=null,login=false,verified=true}={}){
  const requests=[];
  const publicClient={schema:schema=>({rpc:async(name,args)=>{
    requests.push({kind:'public',schema,name,args});
    return {data:published,error:null};
  }})};
  const authClient={schema:schema=>({rpc:async(name,args)=>{
    requests.push({kind:'private',schema,name,args});
    return {data:privateRows,error:null};
  }})};
  const auth={
    getSession:async()=>({data:{session:login?{user:{id:'owner-1'},access_token:'valid.jwt.token'}:null},error:null}),
    getUser:async()=>({data:{user:verified?{id:'owner-1'}:{id:'other-user'}},error:null}),
    signInWithOAuth:async()=>({error:null}),
    signOut:async()=>({error:null})
  };
  return {db:createDatabaseClient({publicClient,authClient,auth}),requests};
}

test('UID tree Class lookup preserves case-sensitive Base62 characters',async()=>{
  const {db,requests}=client({published:catalog('eeCc')});
  assert.deepEqual(await db.readKeywordClass('lo3rwang','eeCc'),catalog('eeCc'));
  assert.equal(requests[0].name,'read_scope_analytics');
  assert.equal(requests[0].args.p_view,'keyword_catalog');
  assert.equal(requests[0].args.p_options.classUid,'eeCc');
  assert.equal(await db.readKeywordClass('lo3rwang','eecc'),null);
  assert.equal(requests[1].args.p_options.classUid,'eecc');
  assert.equal(await db.readKeywordClass('lo3rwang','ee!c'),null);
  assert.equal(requests.length,2);
});

test('private Class requires current verified Scope-owner session',async()=>{
  const {db,requests}=client({published:null,privateRows:catalog('wDov'),login:true});
  assert.deepEqual(await db.readKeywordClass('lrunes','wDov'),catalog('wDov'));
  assert.deepEqual(requests.map(x=>x.kind),['public','private']);
});

test('guest and mismatched identity cannot fetch private Keywords',async()=>{
  for(const options of [{login:false},{login:true,verified:false}]){
    const {db,requests}=client(options);
    assert.equal(await db.readKeywordClass('lrunes','wDov'),null);
    assert.deepEqual(requests.map(x=>x.kind),['public']);
  }
});

test('Postgres catalog guards active Class and Scope authorization without case folding',()=>{
  assert.match(treeSql,/v_class IS NULL OR v_class !~ '\^\[A-Za-z0-9\]\{4\}\$'/);
  assert.match(treeSql,/silver\.can_manage_scope\(v_scope\)/);
  assert.match(treeSql,/current_keyword_class_uid FROM %s WHERE id=\$1/);
  assert.match(treeSql,/REVOKE ALL ON FUNCTION silver\.read_keyword_tree_catalog\(text,text\) FROM PUBLIC/);
  assert.doesNotMatch(treeSql,/upper\s*\(/i);
  assert.match(retirementSql,/DROP FUNCTION IF EXISTS silver\.read_keyword_class_by_uid\(text,text\)/);
});

test('verified LOC owner reads current Class from unified Anchor without stale legacy RPC',async()=>{
  const calls=[];
  const rows=[
    {uid:'eeCc',type:'class',name:'符文 66',desc:'Class',lists:['Gr01']},
    {uid:'Gr01',type:'group',name:'靈魂組',desc:'Group',lists:['It01']},
    {uid:'It01',type:'item',name:'靈',desc:'Private meaning',lists:['private','judgement']}
  ];
  const adapter={schema:()=>({
    from:table=>{
      assert.equal(table,'lo3rwang_keywords');
      let filters=[];
      const q={
        select(){return q},
        eq(field,value){filters.push(row=>row[field]===value);return q},
        in(field,values){filters.push(row=>values.includes(row[field]));return q},
        order(){return q},
        limit(){return q},
        then(resolve,reject){
          calls.push({table,filters:filters.length});
          return Promise.resolve({
            data:rows.filter(row=>filters.every(fn=>fn(row))),error:null
          }).then(resolve,reject);
        }
      };
      return q;
    },
    rpc:async()=>{throw Error('Owner must not hit the old Keywords RPC')}
  })};
  const auth={
    getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'token'}},error:null}),
    getUser:async()=>({data:{user:{id:'owner'}},error:null}),
    signInWithOAuth:async()=>({error:null}),
    signOut:async()=>({error:null})
  };
  const db=createDatabaseClient({publicClient:adapter,authClient:adapter,auth});
  const actual=await db.readKeywordClass('lo3rwang','eeCc');
  assert.equal(actual.class_uid,'eeCc');
  assert.deepEqual(actual.rows.map(row=>row.uid),['eeCc','Gr01','It01']);
  assert.deepEqual(actual.rows[2].lists,[]);
  assert.equal(actual.rows[2].desc,'');
  assert.equal(calls.length,3);
  const shared=await db.readSharedKeywordClasses('lo3rwang');
  assert.deepEqual(shared,[{
    scopeId:'lo3rwang',classUid:'eeCc',name:'符文 66',category:'eeCc'
  }]);
});

test('Clerk Keywords owner uses a single Authority-verified session rather than getSession then getUser',async()=>{
  let verified=0,legacy=0;
  const mock={
    getVerifiedSession:async()=>{verified++;return {
      user:{id:'owner',email:'owner@example.com'},
      oauth:{email:'owner@example.com'}
    };},
    getSession:async()=>{legacy++;throw new Error('duplicate getSession');},
    getUser:async()=>{legacy++;throw new Error('duplicate getUser');},
    signInWithOAuth:async()=>({error:null}),signOut:async()=>({error:null})
  };
  const calls=[];
  const publicClient={schema:()=>({rpc:async()=>{calls.push('public');return {data:null,error:null};}})};
  const authClient={schema:()=>({rpc:async()=>{calls.push('private');return {data:catalog('Ab12'),error:null};}})};
  const db=createDatabaseClient({publicClient,authClient,auth:mock});
  assert.deepEqual(await db.readKeywordClass('lrunes','Ab12'),catalog('Ab12'));
  assert.equal(verified,1);assert.equal(legacy,0);
  assert.deepEqual(calls,['public','private']);
});
