// Generates an official Better Auth SQL schema for review ONLY.
// This file uses a disposable PostgreSQL service in CI and never
// connects to or alters the production Neon database.
import {createLocAuth} from '../workers/loc-authority/auth.mjs';

if(process.env.LOC_AUTH_SCHEMA_GENERATION!=='1')
  throw new Error('This config is exclusively for offline schema generation');
const mockEnv={
  LOC_AUTH_DATABASE_URL:'postgresql://loc_ci:loc_ci_only@127.0.0.1:5432/loc_auth_schema',
  BETTER_AUTH_SECRET:'temporary-vendor-schema-generation-not-a-prod-secret-2026',
  LOC_GOOGLE_CLIENT_ID:'schema-generation-client-id',
  LOC_GOOGLE_CLIENT_SECRET:'schema-generation-client-secret'
};
export const auth=createLocAuth(mockEnv).auth;
