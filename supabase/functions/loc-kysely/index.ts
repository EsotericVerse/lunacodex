// Legacy Supabase Function adapter. Canonical SQL implementation is LOC-owned.
// The same handler is launched by the independent Deno SQL service.
// cuid@3 requires process.pid during import; Edge may omit it.
import {prepareLocSqlEdgeRuntime} from '../../../app/loc/gateway/edge-runtime-compat.mjs';

prepareLocSqlEdgeRuntime();
await import('../../../app/loc/gateway/sql-handler.ts');
