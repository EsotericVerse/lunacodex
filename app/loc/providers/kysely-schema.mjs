import {portableRelation} from './sql-engine-ports.mjs';
import {scopedZModelColumns} from '../../../zenstack/scoped-schema.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const effectiveNamespace=(engine,namespace)=>
  namespace||'public';

// A matching table name is not enough: validate once at onboarding instead
// of letting every feature fail independently on a missing SQL column.
export function validatePortableScopeSchema(tables,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope');
  const schema=effectiveNamespace(engine,namespace||
    (engine==='mssql'?'dbo':'public'));
  // The existing frozen ZModel defines the canonical portable field contract.
  // Physical type adaptation remains the responsibility of each Kysely Dialect.
  // No runtime introspection, migration, or extra SQL request is performed.
  const {galaxy,anchor}=scopedZModelColumns({scopeId,namespace:schema});
  const expected={galaxy,anchor};
  const names={scopeId};
  for(const [kind,columns] of Object.entries(expected)){
    const name=scopeId+'_'+kind;
    const table=tables.find(t=>t.name===name&&
      (!t.schema||t.schema===schema));
    if(!table)throw new Error('Missing LOC table: '+name);
    const present=new Set((table.columns||[]).map(c=>c.name));
    const missing=columns.filter(col=>!present.has(col));
    if(missing.length)throw new Error('LOC table '+name+' has missing columns: '+missing.join(', '));
    names[kind]=portableRelation(name,engine,namespace);
  }
  return names;
}
