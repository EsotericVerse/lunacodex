// LOC deployment-time database access registry.
// Source of truth for the two current SQL targets; never place passwords,
// control tokens, connection URLs containing credentials, or API secrets here.
// Updating this file requires a new site + Edge deployment.
// Credentials remain in trusted server secrets / Vault.
export const DATABASE_ACCESS_LIST=Object.freeze([
  Object.freeze({
    target_id:'supabase-current',label:'Supabase',provider:'supabase',
    engine:'postgres',connection_alias:'supabase_current',connection_mode:'pooler',
    project_id:'qlouywsdiiyiyzpoxyqy',
    project_url:'https://qlouywsdiiyiyzpoxyqy.supabase.co',
    region:'',selected:true,backup_selected:false
  }),
  Object.freeze({
    target_id:'neon-current',label:'Neon',provider:'neon',
    engine:'postgres',connection_alias:'neon_current',connection_mode:'direct',
    project_id:null,
    project_url:'https://ep-rapid-queen-b3oyboy6.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    region:'',selected:false,backup_selected:true
  })
]);
export function databaseAccessTargets(){
  return DATABASE_ACCESS_LIST.map(entry=>({...entry}));
}
