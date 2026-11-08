// LOC native Auth ingress QoS. Applies only to external HTTP entrypoints;
// future internal Worker service-binding RPCs do not pass through this gate.
const LIMITS = Object.freeze({
  session: 120,
  token: 30,
  login: 16,
  callback: 30,
  register: 10,
  authorize: 60,
  revoke: 30,
  logout: 30,
  identity: 120,
  delegation: 60
});
const text = new TextEncoder();
function mode(path) {
  if (path === '/v1/auth/session') return 'session';
  if (path === '/v1/auth/ref/check') return 'login';
  if (path === '/oauth/token') return 'token';
  if (path === '/oauth/login' || path === '/oauth/ref') return 'login';
  if (path.startsWith('/oauth/callback/')) return 'callback';
  if (path === '/oauth/register') return 'register';
  if (path === '/oauth/authorize') return 'authorize';
  if (path === '/oauth/revoke') return 'revoke';
  if (path === '/oauth/logout') return 'logout';
  if (path === '/v1/identity') return 'identity';
  if (path === '/v1/delegation') return 'delegation';
  return '';
}
export function externalAuthQosPolicy(request) {
  if (request.method === 'OPTIONS') return null;
  const name = mode(new URL(request.url).pathname);
  return name ? {name, limit: LIMITS[name]} : null;
}
export async function checkExternalAuthQos(request, env) {
  const policy = externalAuthQosPolicy(request);
  if (!policy) return null;
  if (!env.LOC_AUTHORITY_STATE) throw new Error('LOC Auth QoS state unavailable');
  // Cloudflare populates CF-Connecting-IP at ingress. Do NOT use a client-
  // controlled X-Forwarded-For header as a source of truth.
  const ip = String(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 96);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(ip)));
  const id = [...digest].map(x => x.toString(16).padStart(2, '0')).join('');
  const state = env.LOC_AUTHORITY_STATE.get(
    env.LOC_AUTHORITY_STATE.idFromName('loc-auth-qos-' + id.slice(0, 4)));
  const result = await state.authQuotaAcquire(policy.name, id, policy.limit);
  if (result.allowed) return null;
  // Standard HTTP semantics; no ad-hoc protocol error or noisy warning body.
  return new Response(null, {
    status: 429,
    headers: {
      'retry-after': String(Math.max(1, Math.ceil(result.retryAfter || 60))),
      'cache-control': 'no-store'
    }
  });
}
