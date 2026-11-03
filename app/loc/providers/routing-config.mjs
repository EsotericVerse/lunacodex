// One deployment-time config for database SOURCE routing only.
// No secrets, login grants, or database calls are stored here.
// The existing LOC deployment keeps its optional Neon mirror by default;
// NEXT_PUBLIC_LOC_BACKUP_ID='' explicitly runs with ONE database. No backup
// connection, health check or synchronization is required for normal operation.
export const DATABASE_ROUTING_CONFIG=Object.freeze({
  targets:Object.freeze({
    'supabase-current':Object.freeze({provider:'supabase',primaryControl:true}),
    'neon-current':Object.freeze({provider:'neon',primaryControl:true}),
    // Opt-in portable primary: profile credentials stay in the trusted
    // Gateway's LOC_DB_CONNECTIONS_JSON, never in browser/LOC settings.
    'custom-current':Object.freeze({
      provider:'custom',
      engine:(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_SQL_ENGINE)||'mysql',
      connection_alias:(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_SQL_ALIAS)||'custom_current',
      primaryControl:true
    })
  }),
  // Optional fallback. An empty build setting disables it without code edits.
  blacklist:Object.freeze([]),
  primaryId:(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_PRIMARY_ID)||'supabase-current',
  backupId:(typeof process!=='undefined'&&process.env.NEXT_PUBLIC_LOC_BACKUP_ID!==undefined)
    ?(process.env.NEXT_PUBLIC_LOC_BACKUP_ID.trim()||null)
    :'neon-current',
  mode:'single'
});

export function resolveDatabaseRouting(config=DATABASE_ROUTING_CONFIG){
  const blocked=new Set(config.blacklist||[]);
  const primary=config.targets?.[config.primaryId];
  if(!primary||blocked.has(config.primaryId))throw new Error('Primary database route is missing or blacklisted');
  if(!['supabase','neon','custom'].includes(primary.provider))
    throw new Error('Unsupported SQL primary');
  if(primary.primaryControl!==true)throw new Error('Primary route has no full provider adapter');
  const backupId=config.backupId&&config.backupId!==config.primaryId&&!blocked.has(config.backupId)?config.backupId:null;
  const backup=backupId?config.targets?.[backupId]:null;
  if(backupId&&(!backup||!['supabase','neon'].includes(backup.provider)))
    throw new Error('Database backup route is not supported');
  return Object.freeze({
    provider:primary.provider,
    primaryId:config.primaryId,
    backupId:backupId||null,
    backupProvider:backup?.provider||null,
    mode:config.mode==='db-managed'?'db-managed':'single',
    primaryControl:primary.primaryControl===true,
    ...(primary.provider==='custom'
      ?{engine:primary.engine,connectionAlias:primary.connection_alias}:{}),
    verified:true
  });
}
