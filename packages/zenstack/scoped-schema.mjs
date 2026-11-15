// ZenStack V3 dynamic Scope model projection over the EXISTING physical SQL tables.
// No DDL, introspection, RPC, migrations, credentials or network access.
// Only use the resulting ORM from a trusted server AFTER LOC Auth/Gateway has
// verified the requested database, Scope, operation and row visibility.
//
// Ordinary Scopes share galaxy, anchor and blocks. LOC itself stores its
// presentation Blocks in loc_anchor, so it does not expose a LOC Blocks table.
// The scopes' independent data and eight-character UIDs are never merged here.
// ZenStack V3 can compile PostgreSQL and MySQL providers; MSSQL remains on
// the shared Kysely path because ZenStack V3 has no MSSQL provider.
import {schema as fixedSchema} from './schema.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const NAMESPACE=/^[a-z_][a-z0-9_]{0,62}$/;
const SOURCES=Object.freeze({
  Galaxy:['Lo3rwangGalaxy','LrunesGalaxy','galaxy'],
  Anchor:['Lo3rwangAnchor','LrunesAnchor','anchor'],
  Blocks:['Lo3rwangBlocks','LrunesBlocks','blocks']
});
const ZENSTACK_PROVIDERS=Object.freeze({postgres:'postgresql',mysql:'mysql'});
const literal=value=>({kind:'literal',value});
const mapped=(name,value)=>({name,args:[{name:name==='@@schema'?'map':'name',value:literal(value)}]});

export function zenStackProviderForEngine(engine='postgres'){
  const provider=ZENSTACK_PROVIDERS[String(engine)];
  if(!provider)
    throw new TypeError('ZenStack V3 does not support the '+String(engine)+' provider; use native Kysely');
  return provider;
}

function equivalentPhysicalFields(left,right,kind){
  const a=fixedSchema.models[left],b=fixedSchema.models[right];
  if(!a||!b)throw Error('Missing frozen LOC '+kind+' ZModel');
  const leftNames=Object.keys(a.fields),rightNames=Object.keys(b.fields);
  const shape=field=>JSON.stringify([
    field.type,Boolean(field.array),Boolean(field.optional),
    Boolean(field.id),Boolean(field.default),
    (field.attributes||[]).map(attr=>attr.name).sort()
  ]);
  if(leftNames.length!==rightNames.length||
     leftNames.some(name=>!b.fields[name]||
       shape(a.fields[name])!==shape(b.fields[name]))||
     a.idFields.join(',')!==b.idFields.join(',')||
     Object.keys(a.uniqueFields).sort().join(',')!==
       Object.keys(b.uniqueFields).sort().join(','))
    throw Error('Frozen LOC '+kind+' ZModel schemas differ');
  return a;
}

// SchemaDef and its physical column set are frozen. Verify the two existing
// exemplars once at module initialization, not on every HTTP Scope query.
const VERIFIED_SCOPE_MODELS=Object.freeze(Object.fromEntries(
  Object.entries(SOURCES).map(([kind,[first,second,suffix]])=>[
    kind,Object.freeze({base:equivalentPhysicalFields(first,second,kind),suffix})
  ])
));

/**
 * Instantiates only the model *metadata* of a single verified Scope.
 *
 * It intentionally omits @@allow policies for Galaxy/Anchor/Blocks:
 * their visibility depends on operation-specific article flags and signed
 * delegation, not on a universal unconditional read policy. The associated
 * ORM client MUST NOT be exposed to public requests or treated as an ACL.
 */
export function scopedZModelSchema({scopeId,namespace='silver',engine='postgres'}={}){
  if(typeof scopeId!=='string'||!SCOPE.test(scopeId)||
     typeof namespace!=='string'||!NAMESPACE.test(namespace))
    throw new TypeError('Invalid trusted LOC Scope schema identifier');
  const models={};
  for(const [kind,{base,suffix}] of Object.entries(VERIFIED_SCOPE_MODELS)){
    if(scopeId==='loc'&&kind==='Blocks')continue;
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
    provider:{type:zenStackProviderForEngine(engine),defaultSchema:namespace},
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
