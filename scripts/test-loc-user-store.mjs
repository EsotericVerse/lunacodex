import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function harness(){
  const source=readFileSync(new URL('../app/loc/loc-user-store.mjs',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/^export /gm,'');
  let stored=null,reads=0,inserts=0,writes=0,sessionReads=0;
  const defaults=()=>({
    culture:{time:'era',display:'density',unit:'day',sort:'desc'},
    statics:{display:'source',unit:'day',sort:'desc'},
    trace:{display:'anchor',time:'none',sort:'desc'},
    search:{field:'content',sort:'asc'},keyword:'none'
  });
  const dbAuthRelation=()=>({
    select(){return {limit:async()=>{
      reads++;return {data:stored?[{...stored}]:[],error:null};
    }};},
    insert(rows){return {select:async()=>{
      inserts++;
      if(stored)return {error:{code:'23505',message:'duplicate owner'},data:null};
      stored={uid:'Aa0Bb123',owner_id:'user_OAuth1',email:'',
        ...defaults(),...rows[0],updated_at:'2026-11-04T00:00:00Z'};
      return {data:[{...stored}],error:null};
    }};},
    update(patch){
      const filters=[];
      return {
        eq(key,value){filters.push([key,value]);return this;},
        async select(){
          writes++;
          if(!stored||filters.some(([key,value])=>stored[key]!==value))
            return {data:[],error:null};
          stored={...stored,...patch};
          return {data:[{...stored}],error:null};
        }
      };
    }
  });
  const getAccountSession=async()=>{
    sessionReads++;throw Error('Settings must not request OAuth again');
  };
  const api=new Function('dbAuthRelation','getAccountSession',source+
    ';return {normalizeLocUser,validateLocUserField,loadOrCreateLocUser,saveLocUserField};'
  )(dbAuthRelation,getAccountSession);
  return {...api,counts(){return {reads,inserts,writes,sessionReads}},stored(){return stored}};
}

test('missing OAuth preferences are default values without any INSERT',async()=>{
  const h=harness();
  const first=await h.loadOrCreateLocUser();
  assert.equal(first.uid,'');
  assert.equal(first.keyword,'none');
  assert.equal(first.culture.time,'era');
  assert.equal(first.culture.list,false);
  assert.equal(h.counts().inserts,0);
  await h.loadOrCreateLocUser();
  assert.equal(h.counts().inserts,0);
  assert.equal(h.counts().sessionReads,0);
});

test('first explicit preference change creates one user row without email checks',async()=>{
  const h=harness();
  const missing=await h.loadOrCreateLocUser();
  const saved=await h.saveLocUserField(missing.uid,'culture',{
    time:'anchor',display:'keywords',unit:'day',sort:'asc',list:false
  });
  assert.equal(saved.uid,'Aa0Bb123');
  assert.equal(saved.culture.time,'anchor');
  assert.equal(saved.statics.display,'source');
  assert.equal(saved.email,'');
  assert.equal(h.counts().inserts,1);
  const changed=await h.saveLocUserField(saved.uid,'keyword','none');
  assert.equal(changed.uid,saved.uid);
  assert.equal(h.counts().writes,1);
  assert.equal(h.counts().sessionReads,0);
});

test('a saved row is readable without another INSERT or email comparison',async()=>{
  const h=harness();
  await h.saveLocUserField('','keyword','none');
  const loaded=await h.loadOrCreateLocUser();
  assert.equal(loaded.uid,'Aa0Bb123');
  assert.equal(h.counts().inserts,1);
  assert.equal(h.counts().sessionReads,0);
});

test('reject unknown columns and invalid preference values',()=>{
  const h=harness();
  assert.throws(()=>h.validateLocUserField('owner_id','other'),/不允許/);
  assert.throws(()=>h.validateLocUserField('culture',{time:'invalid'}),/不符合/);
  assert.throws(()=>h.validateLocUserField('keyword','xxx:<script>'),/四碼/);
  assert.equal(h.validateLocUserField('keyword','myscope:Ab3z'),'myscope:Ab3z');
});
