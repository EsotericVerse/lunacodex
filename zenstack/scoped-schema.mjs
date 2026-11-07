// ZenStack V3 dynamic Scope model projection over the EXISTING physical SQL tables.
// No DDL, introspection, RPC, migrations, credentials or network access.
// Only use the resulting ORM from a trusted server AFTER LOC Auth/Gateway has
// verified the requested database, Scope, operation and row visibility.
//
// Three tables share one schema contract in each Scope: galaxy, anchor, blocks.
// The scopes' independent data and eight-character UIDs are never merged here.
// Non-PostgreSQL SQL engines continue to use Kysely's existing dialect adapters.
import {schema as fixedSchema} from './schema.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const NAMESPACE=/^[a-z_][a-z0-9_]{0,62}$/;
const SOURCES=Object.freeze({
  Galaxy:['Lo3rwangGalaxy','LrunesGalaxy','galaxy'],
  Anchor:['Lo3rwangAnchor','LrunesAnchor','anchor'],
  Blocks:['Lo3rwangBlocks','LrunesBlocks','blocks']
});
const literal=value=>({kind:'literal',value});
const mapped=(name,value)=>({name,args:[{name:name==='@@schema'?'map':'name',value:literal(value)}]});

function equivalentPhysicalFields(left,right,kind){
  const a=fixedSchema.models[left],b=fixedSchema.models[right];
  if(!a||!b)throw Error('Missing frozen LOC '+kind+' ZModel');
  const leftNames=Object.keys(a.fields),rightNames=Object.keys(b.fields);
  if(leftNames.length!==rightNames.length||
     leftNames.some(name=>{
       const x=a.fields[name],y=b.fields[name];
       return !y||x.type!==y.type||Boolean(x.array)!==Boolean(y.array)||
         Boolean(x.optional)!==Boolean(y.optional)||Boolean(x.id)!==Boolean(y.id);
     })||
     a.idFields.join(',')!==b.idFields.join(','))
    throw Error('Frozen LOC '+kind+' ZModel schemas differ');
  return a;
}

/**
 * Instantiates only the model *metadata* of a single verified Scope.
 *
 * It intentionally omits @@allow policies for Galaxy/Anchor/Blocks:
 * their visibility depends on operation-specific article flags and signed
 * delegation, not on a universal unconditional read policy. The associated
 * ORM client MUST NOT be exposed to public requests or treated as an ACL.
 */
export function scopedZModelSchema({scopeId,namespace='silver'}={}){
  if(typeof scopeId!=='string'||!SCOPE.test(scopeId)||
     typeof namespace!=='string'||!NAMESPACE.test(namespace))
    throw new TypeError('Invalid trusted LOC Scope schema identifier');
  const models={};
  for(const [kind,[first,second,suffix]] of Object.entries(SOURCES)){
    const base=equivalentPhysicalFields(first,second,kind);
    models[kind]={
      ...base,
      name:kind,
      // Never modify the cached fixed SchemaDef object.
      fields:base.fields,
      idFields:[...base.idFields],
      uniqueFields:base.uniqueFields,
      attributes:[mapped('@@map',scopeId+'_'+suffix),mapped('@@schema',namespace)]
    };
  }
  return {
    provider:{type:'postgresql',defaultSchema:namespace},
    models,
    typeDefs:fixedSchema.typeDefs,
    authType:fixedSchema.authType,
    // No implied public access or unsound scope inheritance.
    plugins:{}
  };
}
export function scopedZModelColumns(options={}){
  const model=scopedZModelSchema(options).models;
  return Object.freeze(Object.fromEntries(
    Object.entries(model).map(([name,entry])=>
      [name.toLowerCase(),Object.freeze(Object.keys(entry.fields))])
  ));
}
