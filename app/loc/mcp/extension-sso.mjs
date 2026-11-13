// Shared contract for the extension's one-time upstream SSO handoff.
// The email is a login hint for the upstream provider; it is never an
// identity or authorization claim.
export const LOC_MCP_EXTENSION_RETURN=
  'https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/mcp';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS=new Set(['clerk','github','neon','supabase']);

export function normalizeSsoEmail(value){
  const email=String(value??'').trim().toLowerCase();
  if(email.length>320||!EMAIL.test(email))throw new Error('Enter a valid SSO email');
  return email;
}

export function parseExtensionProviderCallback(returned,expectedState){
  let url;
  try{url=new URL(String(returned))}catch{throw new Error('Invalid upstream SSO callback')}
  if(url.origin+url.pathname!==LOC_MCP_EXTENSION_RETURN)
    throw new Error('Invalid upstream SSO callback');
  if(url.searchParams.get('state')!==String(expectedState||''))
    throw new Error('Upstream SSO state mismatch');
  if(url.searchParams.get('error'))
    throw new Error('Upstream SSO authorization failed');
  const provider=url.searchParams.get('provider')||'';
  if(!PROVIDERS.has(provider)||url.searchParams.get('connected')!=='1')
    throw new Error('Upstream SSO authorization failed');
  return {provider,connected:true};
}
