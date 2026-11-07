import {portableRelation} from './sql-engine-ports.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const FLAGS=['statics','culture','search','trace','list','keyword','extract','others'];
const effectiveNamespace=(engine,namespace)=>
  namespace||(engine==='mssql'?'dbo':'public');

// A matching table name is not enough: validate once at onboarding instead
// of letting every feature fail independently on a missing SQL column.
export function validatePortableScopeSchema(tables,{engine,namespace='',scopeId}={}){
  if(!SCOPE.test(String(scopeId||''))||!['postgres','mysql','mssql'].includes(engine))
    throw new Error('Invalid portable LOC Scope');
  const schema=effectiveNamespace(engine,namespace);
  const expected={
    galaxy:['uid','title','content','createtime','location','UpdateTime','url',
      'source_id','target_id','ref_id','site','place_id','media_link','date','site_id',
      ...FLAGS],
    // All portable Anchor relations must expose the physical creation time.
    // Existing databases need the additive, non-destructive Anchor migration.
    anchor:['uid','type','title','description','invisible','attr','createtime']
  };
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
