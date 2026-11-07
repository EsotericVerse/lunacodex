import {portableRelation} from './sql-engine-ports.mjs';
import {schema as fixedZModel} from '../../../zenstack/schema.mjs';

// Both existing Scope variants must agree before accepting any portable Scope.
// The fixed models act as a read-only template; they do not imply that a
// dynamic Scope table is a generated ZenStack ORM model.
function canonicalColumns(first,second,kind){
  const a=Object.keys(fixedZModel.models[first]?.fields||{});
  const b=Object.keys(fixedZModel.models[second]?.fields||{});
  if(!a.length||a.length!==b.length||
     a.some(key=>!Object.hasOwn(fixedZModel.models[second].fields,key)))
    throw new Error('LOC ZModel '+kind+' column contract mismatch');
  return Object.freeze(a);
}
const EXPECTED_SCOPE_FIELDS=Object.freeze({
  galaxy:canonicalColumns('Lo3rwangGalaxy','LrunesGalaxy','Galaxy'),
  anchor:canonicalColumns('Lo3rwangAnchor','LrunesAnchor','Anchor')
});


const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const effectiveNamespace=(engine,namespace)=>
  namespace||(engine==='mssql'?'dbo':'public');

// A matching table name is not enough: validate once at onboarding instead
// of letting every feature fail independently on a missing SQL column.
export function validatePortableScopeSchema(tables,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope');
  const schema=effectiveNamespace(engine,namespace);
  // The existing frozen ZModel defines the canonical portable field contract.
  // Physical type adaptation remains the responsibility of each Kysely Dialect.
  // No runtime introspection, migration, or extra SQL request is performed.
  const expected=EXPECTED_SCOPE_FIELDS;
  const names={scopeId};
  for(const [kind,columns] of Object.entries(expected)){
    const name=scopeId+'_'+kind;
    const table=tables.find(t=>t.name===name&&
      (engine==='mysql'||!t.schema||t.schema===schema));
    if(!table)throw new Error('Missing LOC table: '+name);
    const present=new Set((table.columns||[]).map(c=>c.name));
    const missing=columns.filter(col=>!present.has(col));
    if(missing.length)throw new Error('LOC table '+name+' has missing columns: '+missing.join(', '));
    names[kind]=portableRelation(name,engine,namespace);
  }
  return names;
}
