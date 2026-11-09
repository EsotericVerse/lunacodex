import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredAdapter} from '../app/loc/providers/configured.mjs';
import {executeLocPersonal} from '../app/loc/providers/kysely-personal.mjs';

const SUB='loc_'+'A'.repeat(40);
const claims={provider:'loc',me:true,sub:SUB,email:'person@example.org',grants:[]};

test('LOC OAuth personal settings do not require Admin grants or direct Data API writes',async()=>{
  const calls=[];
  const adapter=createConfiguredAdapter({
    url:'https://example.org/rest/v1',publishableKey:'public',
    accountAdapter:{auth:{},getAccessToken:async()=> 'loc.oauth.session'},
    fetchImpl:async(url,options)=>{
      calls.push({url:String(url),options});
      if(String(url).endsWith('/v1/delegation')){
        assert.deepEqual(JSON.parse(options.body),{audience:'sql',identity:true});
        return Response.json({access_token:'header.payload.signature',grants:[]});
      }
      if(String(url)==='/api/loc-native'){
        const body=JSON.parse(options.body);
        assert.equal(body.kind,'personal-write');
        assert.equal(body.payload.p_table,'api.user_settings');
        return Response.json({data:{count:1,data:[{
          owner_id:SUB,setting_key:'home',text_value:'loc'
        }]}});
      }
      throw Error('Unauthenticated public Data API write/read');
    }
  });
  const {data,error}=await adapter.authClient.schema('api').from('user_settings')
    .upsert([{setting_key:'home',text_value:'loc'}],
      {onConflict:'owner_id,setting_key'}).select('setting_key,text_value');
  assert.equal(error,null);
  assert.equal(data[0].text_value,'loc');
  assert.equal(calls.length,2);
  assert.equal(calls[1].options.credentials,'omit');
});

test('unverified identities cannot write personal tables',async()=>{
  const adapter=createConfiguredAdapter({
    url:'https://example.org/rest/v1',publishableKey:'public',
    accountAdapter:{auth:{},getAccessToken:async()=>''},
    fetchImpl:async()=>{throw Error('Unexpected network')}
  });
  await assert.rejects(adapter.authClient.schema('api').from('loc_user')
    .insert([{keyword:'none'}]).select('uid'),/LOC login required/);
});

test('personal writer binds owner_id and refuses foreign or Admin relations',async()=>{
  const seen=[],table='api.user_settings';
  const db={insertInto(value){
    assert.equal(value,table);
    return {values(rows){seen.push(rows);return this},
      onConflict(cb){
        cb({columns:()=>({doUpdateSet:()=>{},doNothing:()=>{}})});
        return this;
      },
      returning(){return this},
      returningAll(){return this},
      async execute(){return [{owner_id:SUB,setting_key:'home'}]}
    };
  }};
  const created=await executeLocPersonal(db,claims,{
    kind:'personal-write',payload:{p_table:table,p_operation:'upsert',
      p_rows:[{setting_key:'home',owner_id:'loc_FORGED'}],p_columns:['setting_key']}
  });
  assert.equal(created.count,1);
  assert.equal(seen[0][0].owner_id,SUB);
  await assert.rejects(executeLocPersonal(db,claims,{
    kind:'personal-write',payload:{p_table:'api.manage',p_operation:'insert',
      p_rows:[{email:'wrong@example.org'}]}
  }),{httpStatus:403});
  await assert.rejects(executeLocPersonal(db,{...claims,me:false},{
    kind:'personal-write',payload:{p_table:table,p_operation:'insert',
      p_rows:[{setting_key:'home'}]}
  }),{httpStatus:403});
});
