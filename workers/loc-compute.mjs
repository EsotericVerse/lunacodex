import {DurableObject} from 'cloudflare:workers';

// Keep the historical SQLite class export for its existing namespace state.
// It is unbound and has no runtime work; deleting it requires a data migration.
export class LocCompute extends DurableObject {}
