import {sql} from 'kysely';

// This is a single fixed LOC runtime preference stored in the existing JSONB
// settings envelope. Missing configuration means Hyperdrive is enabled.
export async function readLocHyperdriveMode(db){
  const result=await sql`select coalesce((select caches->'runtime'->>'hyperdrive_enabled'
    from silver.loc where id='loc'),'true') as enabled`.execute(db);
  const row=result.rows?.[0];
  if(!row)throw Error('LOC Hyperdrive mode unavailable');
  return String(row.enabled).toLowerCase()!=='false';
}

// Merge only this setting into the existing JSON object. Preserve all other
// runtime cache fields; no schema change or migration is required.
export async function writeLocHyperdriveMode(db,enabled){
  if(typeof enabled!=='boolean')throw TypeError('Invalid LOC Hyperdrive mode');
  const result=await sql`
    update silver.loc
    set caches=jsonb_set(
      case when jsonb_typeof(caches)='object' then caches else '{}'::jsonb end,
      '{runtime}',
      (case when jsonb_typeof(caches->'runtime')='object'
        then caches->'runtime' else '{}'::jsonb end)
        || jsonb_build_object('hyperdrive_enabled',${enabled}),
      true
    )
    where id='loc'
    returning id
  `.execute(db);
  if(result.rows?.length!==1)throw Error('LOC Hyperdrive mode unavailable');
  return enabled;
}
