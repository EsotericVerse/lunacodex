// Code-only ZenStack V3 model of Better Auth's EXISTING Rainbow core tables.
// No migrations, schema introspection, RLS changes or second database adapter.
// Better Auth remains the only writer and owner of the Auth persistence layer.
import {RAINBOW_TABLES} from './rainbow-tables.mjs';

const definitions=Object.freeze({
  user:{
    id:'String',name:'String',email:'String',emailVerified:'Boolean',
    image:'String?',createdAt:'DateTime',updatedAt:'DateTime'
  },
  session:{
    id:'String',expiresAt:'DateTime',token:'String',createdAt:'DateTime',
    updatedAt:'DateTime',ipAddress:'String?',userAgent:'String?',userId:'String'
  },
  account:{
    id:'String',accountId:'String',providerId:'String',userId:'String',
    accessToken:'String?',refreshToken:'String?',idToken:'String?',
    accessTokenExpiresAt:'DateTime?',refreshTokenExpiresAt:'DateTime?',
    scope:'String?',password:'String?',createdAt:'DateTime',updatedAt:'DateTime'
  },
  verification:{
    id:'String',identifier:'String',value:'String',expiresAt:'DateTime',
    createdAt:'DateTime',updatedAt:'DateTime'
  }
});
const literal=(name,key,value)=>({name,args:[{name:key,value:{kind:'literal',value}}]});
function model(name,table,columns){
  const fields=Object.fromEntries(Object.entries(columns).map(([field,declared])=>[
    field,{
      name:field,type:declared.replace('?',''),attributes:[],
      ...(declared.endsWith('?')?{optional:true}:{}),
      ...(field==='id'?{id:true}:{})
    }
  ]));
  return {
    name,fields,idFields:['id'],uniqueFields:{id:{type:'String'}},
    attributes:[literal('@@map','name',table),literal('@@schema','map','public')]
  };
}
const models={};
for(const [key,columns] of Object.entries(definitions)){
  const name='Rainbow'+key[0].toUpperCase()+key.slice(1);
  models[name]=model(name,RAINBOW_TABLES[key],columns);
}
export const rainbowSchema={
  provider:{type:'postgresql',defaultSchema:'public'},
  models,typeDefs:{},plugins:{}
};
export const RAINBOW_CORE_MODELS=Object.freeze(
  Object.fromEntries(Object.keys(definitions).map(key=>[
    key,'Rainbow'+key[0].toUpperCase()+key.slice(1)
  ]))
);
