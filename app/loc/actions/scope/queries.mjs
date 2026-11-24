'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {scopeConfigColumns} from '../../scope/scope-config-fields.mjs';

// Read only this Scope's configuration after the existing JS grant check.
export async function readScopeConfig(scopeId){
  const scope=String(scopeId||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='admin'||scope==='local')
    throw Error('Invalid Scope configuration');
  return withAuthorizedLocRead({scope},async(db,port)=>{
    const table=portableRelation(scope,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    const row=await db.selectFrom(table)
      .select(scopeConfigColumns(scope).split(',').filter(Boolean))
      .where('id','=',scope).executeTakeFirst();
    if(!row)throw Error('Scope settings unavailable');
    return row;
  });
}
