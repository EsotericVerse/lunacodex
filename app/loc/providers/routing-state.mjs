import {DATABASE_ROUTING_CONFIG,resolveDatabaseRouting} from './routing-config.mjs';

// Database routing is a server-controlled decision. Public browser storage
// must never override the LOC primary target, even if a legacy key remains.
// The privileged admin target is managed and checked by the trusted gateway.
export function runtimeDatabaseRouting(){
  return resolveDatabaseRouting(DATABASE_ROUTING_CONFIG);
}
const route=runtimeDatabaseRouting();
export async function selectedDatabaseRouting(){return route;}
