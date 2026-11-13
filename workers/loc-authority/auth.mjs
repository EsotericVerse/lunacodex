import {betterAuth} from 'better-auth';
import {APIError,createAuthMiddleware,getAuthoritativeSessionFromCtx} from 'better-auth/api';
import {admin,jwt} from 'better-auth/plugins';
import {sso} from '@better-auth/sso';
import {createAccessControl} from 'better-auth/plugins/access';
import {ZenStackClient} from '@zenstackhq/orm';
import {zenstackAdapter} from '@zenstackhq/better-auth';
import {oauthProvider} from '@better-auth/oauth-provider';
import {PostgresDialect} from 'kysely';
import {Pool, neonConfig} from '@neondatabase/serverless';
import * as z from 'zod';
import {RAINBOW_TABLES} from './rainbow-tables.mjs';
import {rainbowSchema,RAINBOW_MODEL_NAMES} from './rainbow-zmodel.mjs';
import {authKaraulRatePolicy} from './auth-qos.mjs';
import {extensionClientDiscovery} from './extension-client.mjs';

// LOC Auth is the issuer. Cloudflare Access is the delegated upstream OIDC
// provider; it does not own LOC Sessions or LOC OAuth tokens. Neon supplies
// PostgreSQL storage, NOT Neon Auth. Neither website rendering nor business
// permissions are implemented here.
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
  // Identities that came in through Cloudflare SSO rather than Google. A tier
  // of its own so its permissions can diverge later; for now it has the same
  // empty permission set as a plain user, and widening it is a one-line change
  // here, not a schema change.
  scope:authAc.newRole({user:[],session:[]}),
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
  cloudflareIssuer:z.url().refine(value=>new URL(value).protocol==='https:'),
  cloudflareClientId:z.string().min(1),
  cloudflareClientSecret:z.string().min(1),
  namespace:z.literal('public')
});

// Google stays configured alongside Cloudflare Access only while the single
// existing LOC identity is still bound to its Google account. It is optional:
// once the Cloudflare account is attached, removing the two Google variables
// disables that button without a code change or a 503.
export function googleSocialConfig(env={}){
  const clientId=String(env?.LOC_GOOGLE_CLIENT_ID||env?.GOOGLE_CLIENT_ID||'').trim();
  const clientSecret=String(env?.LOC_GOOGLE_CLIENT_SECRET||env?.GOOGLE_CLIENT_SECRET||'').trim();
  return clientId&&clientSecret?{clientId,clientSecret}:null;
}

export function cloudflareSsoConfig(env={}){
  return {
    issuer:String(env.LOC_CLOUDFLARE_SSO_ISSUER||env.CLOUDFLARE_SSO_ISSUER||'').trim(),
    clientId:String(env.LOC_CLOUDFLARE_SSO_CLIENT_ID||env.CLOUDFLARE_SSO_CLIENT_ID||'').trim(),
    clientSecret:String(env.LOC_CLOUDFLARE_SSO_CLIENT_SECRET||env.CLOUDFLARE_SSO_CLIENT_SECRET||'').trim()
  };
}

export function checkLocAuthEnvironment(env){
  const cloudflare=cloudflareSsoConfig(env);
  const data={
    connectionString:env?.LOC_AUTH_DATABASE_URL,
    secret:env?.BETTER_AUTH_SECRET||env?.LOC_CONTROL_ENCRYPTION_KEY,
    cloudflareIssuer:cloudflare.issuer,
    cloudflareClientId:cloudflare.clientId,
    cloudflareClientSecret:cloudflare.clientSecret,
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
  const cloudflare=cloudflareSsoConfig(env);
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
  // The OAuth provider delegates client/resource authorization to the
  // application; it does not automatically apply the Admin Plugin's roles.
  // Use Better Auth's authoritative on-demand Session check for privileged
  // management operations only. Ordinary SSO retains the signed cookie cache.
  const activeAuthAdmin=async (headers)=>{
    try{
      const live=await auth.api.getSession({
        headers,query:{disableCookieCache:true,disableRefresh:true}
      });
      return live?.user?.role==='admin'&&live.user.banned!==true
        &&live.user.emailVerified===true?live.user:null;
    }catch{return null;}
  };
  const ownerPrivilege=async ({headers})=>{
    const user=await activeAuthAdmin(headers);
    return Boolean(user&&String(user.email||'').trim().toLowerCase()===OWNER_EMAIL);
  };
  const auth=betterAuth({
    appName:'LOC Auth',
    baseURL:LOC_ISSUER,
    basePath:'/api/auth',
    secret:env.BETTER_AUTH_SECRET||env.LOC_CONTROL_ENCRYPTION_KEY,
    // The SSO plugin checks the upstream discovery document, and every
    // endpoint named inside it, against this list before the first redirect
    // (validateDiscoveryUrl / normalizeAndValidateUrl), so the delegated
    // provider's own origin has to be here or sign-in fails with
    // "Untrusted OIDC discovery URL". It is derived from the configured
    // issuer rather than hardcoded, so replacing the Cloudflare application
    // only means changing that variable.
    trustedOrigins:[LOC_ISSUER,LOC_WEB,new URL(cloudflare.issuer).origin],
    // Official Better Auth middleware: high-risk Admin API requests bypass the
    // 30-minute cookie cache once, preventing revoked Sessions from managing
    // Auth accounts. No background polling or extra Session store.
    hooks:{before:createAuthMiddleware(async ctx=>{
      // Better Auth's top-level before hook is one native middleware, not an
      // array of {matcher,handler} entries. Branch here so the published
      // Better Auth 1.7.x runner receives the callable middleware it expects.
      if(['/oauth2/authorize','/oauth2/consent','/oauth2/continue'].includes(ctx.path)){
        // Better Auth's native authoritative reader bypasses a signed Cookie
        // Cache for OAuth issuance. Initial unauthenticated authorization still
        // reaches the provider's standard login redirect, without DB polling.
        const token=await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,ctx.context.secret
        );
        if(!token)return;
        const active=await getAuthoritativeSessionFromCtx(ctx);
        if(!active?.session)
          throw new APIError('UNAUTHORIZED',{
            message:'OAuth Session expired or revoked'
          });
        return;
      }
      // has-permission is an introspection endpoint for ordinary users, not
      // an account-management action; leave its native authorization intact.
      if(ctx.path?.startsWith('/admin/')===true&&ctx.path!=='/admin/has-permission'&&
         !await activeAuthAdmin(ctx.headers))
        throw new APIError('FORBIDDEN',{message:'Active administrator session required'});
    })},
    // Better Auth validates its own plugin inputs; ZenStack validates ORM
    // writes using the same shared schema, without duplicate custom hooks.
    // Existing Rainbow array-valued fields are JSONB, not PostgreSQL
    // native array columns. Let the published adapter serialize them.
    database:zenstackAdapter(db,{provider:'postgresql',supportsArrays:false}),
    user:{modelName:RAINBOW_MODEL_NAMES.user},
    session:{modelName:RAINBOW_MODEL_NAMES.session,
      expiresIn:30*86400,updateAge:86400,storeSessionInDatabase:true,
      cookieCache:locAuthSessionCache(env)},
    // One LOC identity per verified email address. Linking must be enabled or
    // Better Auth refuses outright (oauth2/link-account.mjs: a false
    // `accountLinking.enabled` alone rejects the link), which would strand the
    // existing owner account on its original provider and leave nobody able to
    // administer Auth. Different email addresses are still never merged.
    account:{modelName:RAINBOW_MODEL_NAMES.account,
      accountLinking:{enabled:true,allowDifferentEmails:false,
        trustedProviders:['cloudflare-access','google']}},
    verification:{modelName:RAINBOW_MODEL_NAMES.verification},
    emailAndPassword:{enabled:false},
    // Cloudflare Access is the intended upstream provider. Google remains
    // available as the recovery path for the already-registered owner account
    // and disappears on its own when its credentials are removed.
    // disableSignUp makes Google a whitelist, not an open door. Better Auth
    // only consults this flag when no user with the incoming email exists
    // (oauth2/link-account.mjs: the check sits in the no-existing-user branch,
    // after the link branch has already returned). So an address the owner
    // pre-created through the admin menu still links on first Google login,
    // while an unknown Gmail is refused instead of silently getting an
    // account. Admin create-user goes through the admin endpoint, not this
    // path, so the owner can still add people.
    ...(googleSocialConfig(env)?{socialProviders:{google:{
      ...googleSocialConfig(env),disableIdTokenSignIn:true,disableSignUp:true
    }}}:{}),
    disabledPaths:['/token'],
    // Karaul owns all LOC Auth QoS policy; Better Auth enforces its decision.
    rateLimit:authKaraulRatePolicy,
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
        // OAuth endpoint budgets are included in the unified Karaul policy.
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
        // Galaxy-Link is a fixed first-party public client resolved from the
        // bundled client.json below; arbitrary anonymous DCR remains disabled.
        // Other client registrations must authenticate and pass privileges.
        allowUnauthenticatedClientRegistration:false,
        enforcePerClientResources:false,
        clientRegistrationDefaultScopes:['openid','profile','email'],
        clientRegistrationAllowedScopes:['offline_access','loc:import'],
        clientRegistrationAllowedResources:[LOC_IMPORT],
        clientRegistrationDefaultResources:[LOC_MCP],
        clientPrivileges:ownerPrivilege,
        resourcePrivileges:ownerPrivilege,
        extensions:[{clientDiscovery:extensionClientDiscovery()}]
      }),
      // Cloudflare Access is the one delegated upstream identity provider.
      // Better Auth still owns the LOC user/session/account records and all
      // LOC OAuth issuance. Keeping the provider in defaultSSO avoids a
      // user-controlled provider registry and does not require a Clerk/Auth0
      // SDK or an Enterprise SSO plan.
      sso({
        providersLimit:0,
        trustEmailVerified:true,
        // Cloudflare Access issues an identity only after its own policy has
        // authenticated the person, but its ID token carries no
        // `email_verified` claim, so Better Auth saw an unverified profile and
        // refused to attach it to the existing owner account: sign-in returned
        // "account not linked" after an otherwise complete round trip. Marking
        // the provider authoritative for its own domain supplies the trust
        // signal that the missing claim cannot.
        // Scope of that trust: an identity may attach only to a LOC user that
        // already exists with the same address, because implicit sign-up stays
        // off below, and only after Cloudflare Access has let it through. The
        // domain comes from the owner's address, so widen or split it before
        // admitting anyone whose mailbox is outside the owner's control.
        domainVerification:{enabled:true},
        // "No open registration" means a stranger who can authenticate at the
        // upstream provider still does not become a LOC identity: approval
        // stays a LOC Web decision. It does NOT mean refusing to attach a new
        // provider to an account that already exists, which is why account
        // linking above is enabled. Collapsing the two locks out the owner.
        disableImplicitSignUp:true,
        defaultSSO:[{
          // `domain` is matched against the part of the signed-in address
          // after the @, not against the provider's name, so the previous
          // 'cloudflare-access' could never match anything.
          providerId:'cloudflare-access',
          domain:OWNER_EMAIL.split('@')[1],
          oidcConfig:{
            issuer:cloudflare.issuer,
            discoveryEndpoint:cloudflare.issuer+'/.well-known/openid-configuration',
            // Naming all three required endpoints makes `needsRuntimeDiscovery`
            // false, so signing in no longer fetches the discovery document
            // first. That fetch is the step that currently fails: from this
            // Worker the connection to the provider's host succeeds in about
            // half a second on one attempt and never answers on the next, and
            // the plugin's discovery timeout is a fixed ten seconds, so an
            // unlucky attempt dies before the user is ever redirected. The
            // paths are the provider's documented layout and were read twice
            // from its live discovery document; they are derived from the
            // configured issuer, so replacing the application stays a
            // variable change.
            authorizationEndpoint:cloudflare.issuer+'/authorization',
            tokenEndpoint:cloudflare.issuer+'/token',
            jwksEndpoint:cloudflare.issuer+'/jwks',
            userInfoEndpoint:cloudflare.issuer+'/userinfo',
            clientId:cloudflare.clientId,
            clientSecret:cloudflare.clientSecret,
            pkce:true,
            scopes:['openid','email','profile'],
            mapping:{email:'email',emailVerified:'email_verified',name:'name'}
          }
        }]
      })
    ]
  });
  return {auth,pool};
}
