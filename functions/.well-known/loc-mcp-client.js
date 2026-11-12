// Public MCP Client ID Metadata Document (CIMD); no credentials live here.
import {LOC_MCP_CALLBACK,LOC_MCP_CLIENT_DOCUMENT} from '../../app/loc/mcp/upstream-providers.mjs';
export function onRequestGet(){
  return Response.json({
    client_id:LOC_MCP_CLIENT_DOCUMENT,client_name:'LOC MCP Gateway',
    client_uri:'https://loc.lo3rwang.cc',
    redirect_uris:[LOC_MCP_CALLBACK],grant_types:['authorization_code','refresh_token'],
    response_types:['code'],token_endpoint_auth_method:'none'
  },{headers:{'cache-control':'public, max-age=3600',
    'x-content-type-options':'nosniff'}});
}
