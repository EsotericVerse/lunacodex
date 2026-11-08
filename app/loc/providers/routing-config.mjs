// Database source routing is read directly from access.js, never SQL.
// No secrets, login grants, or database calls are stored here.
// The default control alias is server-owned. Personal database choices are
// resolved by LOC Auth, not by this deployment-time registry.
import {DATABASE_ACCESS_LIST} from './access.js';

const sourceTargets=Object.freeze(Object.fromEntries(
  DATABASE_ACCESS_LIST.map(item=>[item.target_id,Object.freeze({
    provider:item.provider,
    primaryControl:true,
    engine:item.engine,connection_alias:item.connection_alias
  })])
));
// Only trusted server-side configuration can select a database profile; this is not a SQL relay.
 // LOC_CONTROL_DB_ALIAS selects a server-owned connection profile; it is never
 // accepted from a request or exposed as a browser-selected database.
const serverControlAlias=typeof Deno!=='undefined'
  ?String(Deno.env.get('LOC_CONTROL_DB_ALIAS')||''):'';
const serverControlEngine=typeof Deno!=='undefined'
  ?String(Deno.env.get('LOC_CONTROL_DB_ENGINE')||''):'';
const active=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
const backup=DATABASE_ACCESS_LIST.find(item=>item.backup_selected===true);
if(!active||DATABASE_ACCESS_LIST.filter(item=>item.selected===true).length!==1)
  throw new Error('access.js must select exactly one database');

export const DATABASE_ROUTING_CONFIG=Object.freeze({
  targets:Object.freeze({
    ...sourceTargets,
    // Generic portable targets remain opt-in. Credentials are server secrets.
    'custom-current':Object.freeze({
      provider:'custom',
      engine:serverControlEngine||(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_SQL_ENGINE)||'postgres',
      connection_alias:serverControlAlias||(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_SQL_ALIAS)||'custom_current',
      primaryControl:true
    })
  }),
  blacklist:Object.freeze([]),
  primaryId:serverControlAlias?'custom-current':active.target_id,
  backupId:serverControlAlias?null:backup?.target_id||null,
  mode:'single'
});

export function resolveDatabaseRouting(config=DATABASE_ROUTING_CONFIG){
  const blocked=new Set(config.blacklist||[]);
  const primary=config.targets?.[config.primaryId];
  if(!primary||blocked.has(config.primaryId))throw new Error('Primary database route is missing or blacklisted');
  if(primary.provider!=='custom')
    throw new Error('Unsupported SQL primary');
  if(primary.primaryControl!==true)throw new Error('Primary route has no control alias');
  const backupId=config.backupId&&config.backupId!==config.primaryId&&!blocked.has(config.backupId)?config.backupId:null;
  const backup=backupId?config.targets?.[backupId]:null;
  if(backupId&&(!backup||backup.provider!=='custom'))
    throw new Error('Database backup route is not supported');
  return Object.freeze({
    provider:primary.provider,
    primaryId:config.primaryId,
    backupId:backupId||null,
    backupProvider:backup?.provider||null,
    mode:config.mode==='db-managed'?'db-managed':'single',
    primaryControl:primary.primaryControl===true,
    engine:primary.engine,connectionAlias:primary.connection_alias,
    verified:true
  });
}
