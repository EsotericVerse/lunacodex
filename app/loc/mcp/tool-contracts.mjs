// One Zod 4 source of truth for MCP JSON Schema advertising and requests.
// No separate hand-maintained JSON schemas, parallel validators, or SQL access.
import {z} from 'zod';
import {SCOPE_ROUTE_INDEX} from '../../modular/scope-route-index.js';
import {ProviderIdSchema,ProviderToolSchema,ProviderArgumentsSchema}
  from './upstream-providers.mjs';

const SCOPE_ID=z.string().regex(/^[a-z][a-z0-9]{0,14}$/);
const UID=z.string().regex(/^[A-Za-z0-9]{8}$/);
const PUBLIC_SCOPES=Object.freeze(SCOPE_ROUTE_INDEX
  .filter(row=>row.active&&row.scope_id!=='loc')
  .map(row=>row.scope_id).filter(id=>SCOPE_ID.safeParse(id).success));
const publicScope=z.enum(PUBLIC_SCOPES);
const nonNegative=z.int().min(0);
const action=z.enum(['search','read','check','record']);
const conversationRecord=z.strictObject({
  role:z.enum(['user','assistant']),kind:z.enum(['original','advice']),
  sent_at:z.string(),text:z.string(),message_id:z.string()
});
const none=z.strictObject({});
export const MCP_TOOL_INPUTS=Object.freeze({
  loc_connection_status:none,
  read_memory:z.strictObject({
    uid:UID.describe('Exact Galaxy article UID'),
    scopeid:publicScope.optional(),
    offset:nonNegative.max(1000000).optional(),
    max_chars:z.int().min(1).max(40000).optional()
  }),
  scope_storage:z.strictObject({scopeid:SCOPE_ID}),
  galaxy_link:z.strictObject({
    action,scopeid:SCOPE_ID,uid:UID.optional(),
    query:z.string().min(2).max(100).optional(),
    limit:z.int().min(1).max(5).optional(),
    user_requested:z.boolean().optional(),
    conversation_id:z.string().optional(),
    updated_at:z.string().optional(),created_at:z.string().optional(),
    records:z.array(conversationRecord).min(1).max(100).optional(),
    title:z.string().max(350).optional(),
    content:z.string().max(125000).optional(),
    offset:nonNegative.optional(),
    max_chars:z.int().min(1).max(40000).optional()
  }),
  provider_list:none,
  provider_tools:z.strictObject({provider:ProviderIdSchema}),
  provider_call:z.strictObject({
    provider:ProviderIdSchema,tool:ProviderToolSchema,
    args:ProviderArgumentsSchema.optional()
  }),
  provider_receipt:z.strictObject({
    approval_id:z.string().min(25).max(64).regex(/^[A-Za-z0-9_-]+$/)
  })
});

// Let the installed Zod module generate the MCP-facing JSON Schema.
// The same schema will parse tool arguments before any external call or SQL.
export function mcpToolJsonSchema(name){
  return z.toJSONSchema(MCP_TOOL_INPUTS[name]);
}
export function parseMcpToolArgs(name,input){
  const parsed=MCP_TOOL_INPUTS[name]?.safeParse(input);
  return parsed?.success?parsed.data:null;
}
export const McpRpcSchema=z.looseObject({
  jsonrpc:z.literal('2.0'),
  id:z.union([z.string(),z.number(),z.null()]).optional(),
  method:z.string().min(1),
  params:z.unknown().optional()
});
