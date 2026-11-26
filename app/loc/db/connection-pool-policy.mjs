// Connection-pool limits are runtime/provider policy, not SQL Dialect policy.
// These are conservative ceilings; adaptive resource management can tune
// effective concurrency below them without changing the selected SQL Type.
export const CONNECTION_POOL_POLICY=Object.freeze({
  nodePoolMax:12,
  nodeIdleTimeoutMillis:30000,
  connectionTimeoutMillis:6000,
  // Cloudflare Worker requests own their pg.Client; Hyperdrive owns the
  // cross-request origin pool. This is a request lifecycle cap, not a
  // PostgreSQL query or Dialect capability.
  workerRequestMaxConnections:1
});
