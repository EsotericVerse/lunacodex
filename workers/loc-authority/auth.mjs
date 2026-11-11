import {betterAuth} from 'better-auth';
import {jwt} from 'better-auth/plugins';
import {oauthProvider} from '@better-auth/oauth-provider';
import {PostgresDialect} from 'kysely';
import {Pool} from 'pg';

// LOC Auth is the issuer. Neon supplies PostgreSQL storage, NOT Neon Auth.
// Neither website rendering nor business permissions are implemented here.
export const LOC_ISSUER='https://auth.lo3rwang.cc';
export const LOC_WEB='https://loc.lo3rwang.cc';
export const LOC_MCP='https://mcp.lo3rwang.cc';
export const LOC_IMPORT=LOC_MCP+'/api/loc-native';
const OWNER_EMAIL='sopa2306@gmail.com';
// Auth owns only explicitly named Rainbow tables. This is model mapping,
// NOT SQL DDL. No table or RLS policy is created when this module loads.
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


// Session data is a *short-lived signed cache*, not the Auth source of truth.
// Cloudflare gives each Worker version a stable ID. A new deployment changes
// that ID, invalidating old cookie-cache values without deleting SQL Sessions.
// This is intentionally independent of LOC Web and its api.manage rights.
export function locAuthSessionCache(env={}){
  const workerVersion=String(env?.CF_VERSION_METADATA?.id||'').trim();
  return {
    enabled:true,
    maxAge:30*60,
    strategy:'compact',
    version:workerVersion||'loc-auth-local'
  };
}

export function checkLocAuthEnvironment(env){
  const secret=env?.BETTER_AUTH_SECRET||env?.LOC_CONTROL_ENCRYPTION_KEY;
  const googleId=env?.LOC_GOOGLE_CLIENT_ID||env?.GOOGLE_CLIENT_ID;
  const googleSecret=env?.LOC_GOOGLE_CLIENT_SECRET||env?.GOOGLE_CLIENT_SECRET;
  if(!env?.LOC_AUTH_DATABASE_URL||!secret||!googleId||!googleSecret)
    throw new Error('LOC Auth needs PostgreSQL and the existing OAuth credentials');
  if(secret.length<32)throw new Error('LOC Auth secret must be at least 32 characters');
  const url=new URL(env.LOC_AUTH_DATABASE_URL);
  if(!['postgresql:','postgres:'].includes(url.protocol))
    throw new Error('LOC Auth requires a PostgreSQL connection');
  // This is a deployment gate, not a table creator. No storage schema is
  // selected by LOC Auth until its exact tables, columns and grants are
  // individually reviewed. A temporary test-only name is never a default.
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(String(env.LOC_AUTH_SCHEMA||'')))
    throw new Error('Approved LOC Auth PostgreSQL schema is not configured');
  return true;
}

export function createLocAuth(env){
  checkLocAuthEnvironment(env);
  // Built-in Kysely PostgreSQL adapter. No hand-written Auth storage, SQL,
  // session table, account linking, signing, PKCE or OAuth state handlers.
  const pool=new Pool({
    connectionString:env.LOC_AUTH_DATABASE_URL,
    // Two connections at most per Worker isolate; never expand the pool for probes.
    max:2,
    connectionTimeoutMillis:7000,
    idleTimeoutMillis:10000,
    ssl:{rejectUnauthorized:true}
  });
  const auth=betterAuth({
    appName:'LOC Auth',
    baseURL:LOC_ISSUER,
    basePath:'/api/auth',
    secret:env.BETTER_AUTH_SECRET||env.LOC_CONTROL_ENCRYPTION_KEY,
    trustedOrigins:[LOC_ISSUER,LOC_WEB],
    database:{
      dialect:new PostgresDialect({pool}),
      type:'postgres',
      // Approved storage namespace only. No automatic DDL or test schema.
      schemaName:env.LOC_AUTH_SCHEMA
    },
    user:{modelName:RAINBOW_TABLES.user},
    session:{modelName:RAINBOW_TABLES.session,
      expiresIn:30*86400,updateAge:86400,storeSessionInDatabase:true,
      cookieCache:locAuthSessionCache(env)},
    account:{modelName:RAINBOW_TABLES.account,accountLinking:{enabled:false}},
    verification:{modelName:RAINBOW_TABLES.verification},
    emailAndPassword:{enabled:false},
    socialProviders:{
      google:{
        clientId:env.LOC_GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_ID,
        clientSecret:env.LOC_GOOGLE_CLIENT_SECRET||env.GOOGLE_CLIENT_SECRET,
        disableIdTokenSignIn:true
      }
    },


    disabledPaths:['/token'],
    rateLimit:{enabled:true,window:60,max:30},
    advanced:{
      useSecureCookies:true,
      // The LOC website receives the opaque session cookie only for explicit
      // protected operations. Public rendering never consults Auth.
      crossSubDomainCookies:{enabled:true,domain:'lo3rwang.cc'},
      database:{joins:true},
      ipAddress:{ipAddressHeaders:['cf-connecting-ip']}
    },
    plugins:[
      jwt({
        schema:{jwks:{modelName:RAINBOW_TABLES.jwks}},
        disableSettingJwtHeader:true,
        jwks:{
          keyPairConfig:{alg:'RS256',modulusLength:3072},
          rotationInterval:30*86400,
          gracePeriod:30*86400
        },
        jwt:{issuer:LOC_ISSUER+'/api/auth'}
      }),
      oauthProvider({
        schema:{
          oauthClient:{modelName:RAINBOW_TABLES.oauthClient},
          oauthResource:{modelName:RAINBOW_TABLES.oauthResource},
          oauthClientResource:{modelName:RAINBOW_TABLES.oauthClientResource},
          oauthRefreshToken:{modelName:RAINBOW_TABLES.oauthRefreshToken},
          oauthAccessToken:{modelName:RAINBOW_TABLES.oauthAccessToken},
          oauthConsent:{modelName:RAINBOW_TABLES.oauthConsent},
          oauthClientAssertion:{modelName:RAINBOW_TABLES.oauthClientAssertion}
        },
        loginPage:'/login',
        consentPage:'/consent',
        scopes:['openid','profile','email','offline_access','loc:import'],
        resources:[LOC_WEB,LOC_MCP,LOC_IMPORT],
        grantTypes:['authorization_code','refresh_token'],
        // PKCE/authorization codes/refresh rotation/OIDC are native modules.
        allowDynamicClientRegistration:true,
        // Official RFC 7591 DCR is needed by LOC galaxy-link's public PKCE client.
        // Better Auth limits registration per IP and grants no LOC data write.
        allowUnauthenticatedClientRegistration:true,
        clientRegistrationDefaultScopes:['openid','profile','email'],
        clientRegistrationAllowedScopes:['offline_access','loc:import'],
        clientRegistrationAllowedResources:[LOC_IMPORT],
        clientRegistrationDefaultResources:[LOC_MCP],
        clientPrivileges:async ({user})=>
          user?.emailVerified===true&&
          String(user.email).trim().toLowerCase()===OWNER_EMAIL,
        resourcePrivileges:async ({user})=>
          user?.emailVerified===true&&
          String(user.email).trim().toLowerCase()===OWNER_EMAIL
      })
    ]
  });
  return {auth,pool};
}
