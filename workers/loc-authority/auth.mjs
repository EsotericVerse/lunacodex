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
export const LOC_IMPORT=LOC_ISSUER+'/v1/import/short';
const OWNER_EMAIL='sopa2306@gmail.com';

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
  return true;
}

export function createLocAuth(env){
  checkLocAuthEnvironment(env);
  // Built-in Kysely PostgreSQL adapter. No hand-written Auth storage, SQL,
  // session table, account linking, signing, PKCE or OAuth state handlers.
  const pool=new Pool({
    connectionString:env.LOC_AUTH_DATABASE_URL,
    max:5,
    connectionTimeoutMillis:7000,
    idleTimeoutMillis:10000,
    ssl:env.LOC_AUTH_SCHEMA_GENERATION==='1'?false:{rejectUnauthorized:true}
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
      // Isolated namespace: never run LOC Auth against Neon-managed neon_auth.
      schemaName:'loc_auth'
    },
    emailAndPassword:{enabled:false},
    socialProviders:{
      google:{
        clientId:env.LOC_GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_ID,
        clientSecret:env.LOC_GOOGLE_CLIENT_SECRET||env.GOOGLE_CLIENT_SECRET,
        disableIdTokenSignIn:true
      }
    },
    account:{accountLinking:{enabled:false}},
    session:{expiresIn:30*86400,updateAge:86400,storeSessionInDatabase:true},
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
        disableSettingJwtHeader:true,
        jwks:{
          keyPairConfig:{alg:'RS256',modulusLength:3072},
          rotationInterval:30*86400,
          gracePeriod:30*86400
        },
        jwt:{issuer:LOC_ISSUER+'/api/auth'}
      }),
      oauthProvider({
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
