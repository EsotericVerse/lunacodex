// ZenStack V3 SchemaDef bridge for LOC's permanently fixed physical schema.
// Uses the published @zenstackhq/schema shape; does not need ZenStack CLI,
// schema introspection, a migration, or a database connection at module load.
// Only use this from trusted server code after Clerk + LOC Authority checks.
// SQL-nullable list fields and dynamic Scope/SQL dialects remain on Kysely.
import contract from './schema-contract.json' with {type:'json'};

const formatTypes=Object.freeze({
  text:'String',varchar:'String',bpchar:'String',bool:'Boolean',
  int2:'Int',int4:'Int',int8:'BigInt',timestamptz:'DateTime',
  timestamp:'DateTime',date:'DateTime',numeric:'Decimal',
  jsonb:'Json',json:'Json',_text:'String',_varchar:'String',
  _int2:'Int',_int4:'Int'
});
const nativeAttributes=Object.freeze({
  text:'@db.Text',varchar:'@db.VarChar',bpchar:'@db.Char',
  int2:'@db.SmallInt',int4:'@db.Integer',int8:'@db.BigInt',
  timestamptz:'@db.Timestamptz',timestamp:'@db.Timestamp',
  date:'@db.Date',numeric:'@db.Decimal',jsonb:'@db.JsonB',
  json:'@db.Json',_text:'@db.Text',_varchar:'@db.VarChar',
  _int2:'@db.SmallInt',_int4:'@db.Integer'
});
const literal=(name,key,value)=>({name,args:[{name:key,value:{kind:'literal',value}}]});
const PUBLIC_FIXED_READS=new Set(['manage','loc','lo3rwang','lrunes']);
const PUBLIC_POLICY_ALLOW_READ={
  name:'@@allow',
  args:[
    {name:'operation',value:{kind:'literal',value:'read'}},
    {name:'condition',value:{kind:'literal',value:true}}
  ]
};
const GLOBAL_ADMIN_MANAGE=new Set(['manage','loc']);
const GLOBAL_ADMIN_POLICY={
  name:'@@allow',args:[
    {name:'operation',value:{kind:'literal',value:'update,delete'}},
    {name:'condition',value:{kind:'binary',op:'>=',
      left:{kind:'member',receiver:{kind:'call',function:'auth',args:[]},members:['roleLevel']},
      right:{kind:'literal',value:4}}}
  ]
};
const locPrincipal={
  name:'LocPrincipal',
  fields:{
    id:{name:'id',type:'String'},
    role:{name:'role',type:'String'},
    roleLevel:{name:'roleLevel',type:'Int'},
    scopeIds:{name:'scopeIds',type:'String',array:true},
    groupIds:{name:'groupIds',type:'String',array:true}
  },
  attributes:[{name:'@@auth'}]
};
const databaseDefault=Object.freeze({kind:'call',function:'dbgenerated',args:[]});
const modelName=table=>table.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join('');
function compileFixedSchema({schema:namespace,tables}){
  if(namespace!=='silver'||tables.length!==17)
    throw new Error('Invalid fixed LOC schema contract');
  const models={};
  for(const table of tables){
    const name=modelName(table.table);
    const fields={},pk=new Set(table.pk);
    for(const col of table.columns){
      const type=formatTypes[col.format];
      if(!type)throw new Error('Unsupported fixed column '+table.table+'.'+col.name);
      const native=nativeAttributes[col.format];
      fields[col.name]={
        name:col.name,type,
        ...(pk.has(col.name)?{id:true}:{}),
        ...(col.format.startsWith('_')?{array:true}:{}),
        ...(col.nullable&&!col.format.startsWith('_')?{optional:true}:{}),
        ...(col.hasDefault&&!col.generated?{default:databaseDefault}:{}),
        attributes:[...(native?[{name:native}]:[]),
          ...(col.hasDefault&&!col.generated?[{name:'@default',args:[{name:'value',value:databaseDefault}]}]:[])]
      };
    }
    const uniqueFields=table.pk.length===1
      ?{[table.pk[0]]:{type:fields[table.pk[0]].type}}
      :{[table.pk.join('_')]:Object.fromEntries(table.pk.map(key=>[key,{type:fields[key].type}]))};
    for(const keys of table.uniques||[]){
      uniqueFields[keys.join('_')]=Object.fromEntries(keys.map(key=>[key,{type:fields[key].type}]));
    }
    models[name]={
      name,fields,idFields:[...table.pk],uniqueFields,
      attributes:[
        literal('@@map','name',table.table),
        literal('@@schema','map',table.schema||namespace),
        ...(PUBLIC_FIXED_READS.has(table.table)?[PUBLIC_POLICY_ALLOW_READ]:[]),
        ...(GLOBAL_ADMIN_MANAGE.has(table.table)?[GLOBAL_ADMIN_POLICY]:[])
      ]
    };
  }
  return {provider:{type:'postgresql',defaultSchema:namespace},models,
    typeDefs:{LocPrincipal:locPrincipal},authType:'LocPrincipal',
    plugins:{policy:{provider:'@zenstackhq/plugin-policy'}}};
}
export const schema=compileFixedSchema(contract);
