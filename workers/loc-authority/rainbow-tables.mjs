// The existing Better Auth SQL model mappings are a single immutable source
// for Better Auth and its ZenStack/Zod validation-only model contract.
export const RAINBOW_TABLES=Object.freeze({
  user:'rainbow_auth',
  session:'rainbow_session',
  account:'rainbow_account',
  verification:'rainbow_verification',
  jwks:'rainbow_jwks',
  oauthClient:'rainbow_oauth_client',
  oauthResource:'rainbow_oauth_resource',
  oauthClientResource:'rainbow_oauth_client_resource',
  oauthRefreshToken:'rainbow_oauth_refresh_token',
  oauthAccessToken:'rainbow_oauth_access_token',
  oauthConsent:'rainbow_oauth_consent',
  oauthClientAssertion:'rainbow_oauth_client_assertion'
});
