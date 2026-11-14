// LOC MCP Gateway QoS reuses the existing bounded LOC Search/Karaul budget.
// This controls request admission, never authorization or Function grants.
// Purely in-memory per isolate: no KV, SQL, timers, polling or new storage.
import {createSearchQos} from '../providers/search-qos.mjs';

export const MCP_QOS_BUDGET=Object.freeze({
  max:120,windowMs:60000,blockMs:30000,maxEntries:1024
});

export function createMcpGatewayQos(overrides={}){
  return createSearchQos({...MCP_QOS_BUDGET,...overrides});
}
export const checkMcpGatewayQos=createMcpGatewayQos();
