import {betterAuth} from 'better-auth';
import {admin,jwt} from 'better-auth/plugins';
import {createAccessControl} from 'better-auth/plugins/access';
import {ZenStackClient} from '@zenstackhq/orm';
import {zenstackAdapter} from '@zenstackhq/better-auth';
import {oauthProvider} from '@better-auth/oauth-provider';
import {PostgresDialect} from 'kysely';
import {Pool, neonConfig} from '@neondatabase/serverless';
import * as z from 'zod';
import {RAINBOW_TABLES} from './rainbow-tables.mjs';
import {rainbowSchema,RAINBOW_MODEL_NAMES} from './rainbow-zmodel.mjs';

// LOC Auth is the issuer. Neon supplies PostgreSQL storage, NOT Neon Auth.
// Neither website rendering nor business permissions are implemented here.
export const LOC_ISSUER='https://auth.lo3rwang.cc';
export const LOC_WEB='https://loc.lo3rwang.cc';
export const LOC_MCP='https://mcp.lo3rwang.cc';
export const LOC_IMPORT=LOC_MCP+'/api/loc-native';
const OWNER_EMAIL='sopa2306@gmail.com';
// Native Better Auth resource/action permissions. The Auth administrator may
// ban/unban and revoke sessions, but cannot impersonate, delete accounts or
// grant itself new roles. LOC Web business rights remain in api.manage.
const authActions={user:['get','list','ban'],session:['list','revoke','delete']};
const authAc=createAccessControl(authActions);
const authRoles={
  admin:authAc.newRole(authActions),
  user:authAc.newRole({user:[],session:[]})
};

// Auth owns only explicitly named Rainbow tables. This is model mapping,
// NOT SQL DDL. No table or RLS policy is created when this module loads.
export {RAINBOW_TABLES} from './rainbow-tables.mjs';


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

// Validate the Worker boundary once. Do not expose connection strings or
// OAuth secrets in Zod errors, logs, or HTTP responses.
const AuthEnvironmentSchema=z.object({
  connectionString:z.url().refine(value=>
    ['postgresql:','postgres:'].includes(new URL(value).protocol)),
  secret:z.string().min(32),
  googleId:z.string().min(1),
  googleSecret:z.string().min(1),
  namespace:z.literal('public')
});

export function checkLocAuthEnvironment(env){
  const data={
    connectionString:env?.LOC_AUTH_DATABASE_URL,
    secret:env?.BETTER_AUTH_SECRET||env?.LOC_CONTROL_ENCRYPTION_KEY,
    googleId:env?.LOC_GOOGLE_CLIENT_ID||env?.GOOGLE_CLIENT_ID,
    googleSecret:env?.LOC_GOOGLE_CLIENT_SECRET||env?.GOOGLE_CLIENT_SECRET,
    namespace:String(env?.LOC_AUTH_SCHEMA||'public')
  };
  if(data.namespace!=='public')
    throw new Error('LOC Auth Rainbow tables are in the public PostgreSQL schema');
  const verified=AuthEnvironmentSchema.safeParse(data);
  if(!verified.success)
    throw new Error('LOC Auth requires valid PostgreSQL and OAuth credentials (secret >= 32 characters)');
  return true;
}

export function createLocAuth(env){
  checkLocAuthEnvironment(env);
  // Built-in Kysely PostgreSQL adapter. No hand-written Auth storage, SQL,
  // session table, account linking, signing, PKCE or OAuth state handlers.
  // Cloudflare Workers cannot open a raw TCP socket to Neon, so node-postgres
  // hangs on every query. Neon's serverless driver connects over WebSocket and
  // is pg-pool compatible, so the Kysely PostgresDialect below is unchanged and
  // TLS is handled by the driver.
  neonConfig.webSocketConstructor=WebSocket;
  const pool=new Pool({
    connectionString:env.LOC_AUTH_DATABASE_URL,
    // Two connections at most per Worker isolate; never expand the pool for probes.
    max:2
  });
  // Official ZenStack v3 Better Auth adapter delegates all Auth storage CRUD
  // to ZenStack ORM over the existing Kysely PostgresDialect. No parallel SQL
  // adapter or runtime schema discovery is introduced.
  const db=new ZenStackClient(rainbowSchema,{dialect:new PostgresDialect({pool})});
  const auth=betterAuth({
    appName:'LOC Auth',
    baseURL:LOC_ISSUER,
    basePath:'/api/auth',
    secret:env.BETTER_AUTH_SECRET||env.LOC_CONTROL_ENCRYPTION_KEY,
    trustedOrigins:[LOC_ISSUER,LOC_WEB],
    // Better Auth validates its own plugin inputs; ZenStack validates ORM
    // writes using the same shared schema, without duplicate custom hooks.
    // Existing Rainbow array-valued fields are JSONB, not PostgreSQL
    // native array columns. Let the published adapter serialize them.
    database:zenstackAdapter(db,{provider:'postgresql',supportsArrays:false}),
    user:{modelName:RAINBOW_MODEL_NAMES.user},
    session:{modelName:RAINBOW_MODEL_NAMES.session,
      expiresIn:30*86400,updateAge:86400,storeSessionInDatabase:true,
      cookieCache:locAuthSessionCache(env)},
    account:{modelName:RAINBOW_MODEL_NAMES.account,accountLinking:{enabled:false}},
    verification:{modelName:RAINBOW_MODEL_NAMES.verification},
    emailAndPassword:{enabled:false},
    socialProviders:{
      google:{
        clientId:env.LOC_GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_ID,
        clientSecret:env.LOC_GOOGLE_CLIENT_SECRET||env.GOOGLE_CLIENT_SECRET,
        disableIdTokenSignIn:true
      }
    },


    disabledPaths:['/token'],
    // Routine Session/OIDC traffic should not exhaust the same tiny 30/min
    // default budget. Sensitive OAuth operations have narrower native limits.
    rateLimit:{enabled:true,window:60,max:120},
    advanced:{
      useSecureCookies:true,
      // The LOC website receives the opaque session cookie only for explicit
      // protected operations. Public rendering never consults Auth.
      crossSubDomainCookies:{enabled:true,domain:'lo3rwang.cc'},
      // Schema is verified out of band; skip the per-request introspection
      // query, which otherwise runs on every fresh serverless connection.
      database:{joins:false,validateSchema:false},
      ipAddress:{ipAddressHeaders:['cf-connecting-ip']}
    },
    plugins:[
      admin({ac:authAc,roles:authRoles,defaultRole:'user',adminRoles:['admin']}),
      jwt({
        schema:{jwks:{modelName:RAINBOW_MODEL_NAMES.jwks}},
        disableSettingJwtHeader:true,
        jwks:{
          keyPairConfig:{alg:'RS256',modulusLength:3072},
          rotationInterval:30*86400,
          gracePeriod:30*86400
        },
        jwt:{issuer:LOC_ISSUER+'/api/auth'}
      }),
      oauthProvider({
        // Native per-endpoint quotas; retain strong controls over client
        // registration and key rotation while allowing normal SSO traffic.
        rateLimit:{
          token:{window:60,max:40},
          authorize:{window:60,max:60},
          introspect:{window:60,max:100},
          revoke:{window:60,max:30},
          register:{window:60,max:5},
          rotateClientKeys:{window:60,max:5},
          userinfo:{window:60,max:120}
        },
        schema:{
          oauthClient:{modelName:RAINBOW_MODEL_NAMES.oauthClient},
          oauthResource:{modelName:RAINBOW_MODEL_NAMES.oauthResource},
          oauthClientResource:{modelName:RAINBOW_MODEL_NAMES.oauthClientResource},
          oauthRefreshToken:{modelName:RAINBOW_MODEL_NAMES.oauthRefreshToken},
          oauthAccessToken:{modelName:RAINBOW_MODEL_NAMES.oauthAccessToken},
          oauthConsent:{modelName:RAINBOW_MODEL_NAMES.oauthConsent},
          oauthClientAssertion:{modelName:RAINBOW_MODEL_NAMES.oauthClientAssertion}
        },
        loginPage:'/login',
        consentPage:'/consent',
        scopes:['openid','profile','email','offline_access','loc:import'],
        resources:[LOC_WEB,LOC_MCP,LOC_IMPORT],
        grantTypes:['authorization_code','refresh_token'],
        // PKCE/authorization codes/refresh rotation/OIDC are native modules.
        allowDynamicClientRegistration:true,
        // Galaxy-Link uses the existing HTTPS Client ID Metadata Document
        // (CIMD), so arbitrary anonymous DCR is unnecessary and unsafe.
        // Other client registrations must authenticate and pass privileges.
        allowUnauthenticatedClientRegistration:false,
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
