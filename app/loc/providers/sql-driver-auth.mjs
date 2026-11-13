// PostgreSQL is the only installed SQL driver. LOC OAuth authorization and
// database credentials remain separate concerns.
export function sqlAuthNeedsUserPassword(){return true;}
export function normalizeSqlDriverAuthentication(engine,input){
 if(engine!=='postgres')throw Error('Unsupported SQL driver authentication for engine');
 const source=input===undefined?{type:'default'}:input;
 if(!source||typeof source!=='object'||Array.isArray(source))
  throw Error('Invalid SQL driver authentication configuration');
 if(source.type!==undefined&&source.type!=='default')
  throw Error('Unsupported SQL driver authentication for engine');
 if(Object.keys(source).some(key=>key!=='type'))
  throw Error('Unexpected SQL driver authentication field');
 return {type:'default'};
}
export function publicSqlDriverAuthentication(){return {type:'default'};}
