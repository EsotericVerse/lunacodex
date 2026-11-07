// The legacy cuid@3 fingerprint helper used by the ZenStack dependency graph
// reads process.pid at module evaluation time. An embedded Node runtime shim may
// expose "process" without a numeric pid, crashing the entire SQL Function
// before OPTIONS/CORS, routing, authorization, or database code can execute.
//
// Run this tiny prelude BEFORE dynamically importing the shared SQL handler.
// Do not disable ZenStack, change authorization, or touch database settings.
import nodeProcess from 'node:process';

export function ensureCuidProcessPid(processObject, fallbackPid) {
  if (!processObject || typeof processObject !== 'object') return false;
  if (Number.isSafeInteger(processObject.pid) && processObject.pid >= 0) return false;
  Object.defineProperty(processObject, 'pid', {
    value: fallbackPid,
    configurable: true,
    writable: true,
    enumerable: true
  });
  return true;
}

export function prepareLocSqlEdgeRuntime() {
  // Make the Node module and the global shim agree. cuid's CommonJS code
  // references the global process variable rather than importing node:process.
  if (!globalThis.process) globalThis.process = nodeProcess;
  const pid = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  for (const processObject of new Set([nodeProcess, globalThis.process])) {
    ensureCuidProcessPid(processObject, pid);
  }
}
