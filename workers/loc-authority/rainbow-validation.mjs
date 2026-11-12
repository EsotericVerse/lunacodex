import {createSchemaFactory} from '@zenstackhq/zod';
import * as z from 'zod';
import {rainbowSchema,RAINBOW_CORE_MODELS} from './rainbow-zmodel.mjs';

// The existing ZenStack model is the source of each field's runtime type.
// Better Auth still owns all Session/OAuth reads, writes and authorization;
// these validation-only hooks add no SQL, joins, policies, or DB connections.
const factory=createSchemaFactory(rainbowSchema);
const shape=key=>factory.makeModelSchema(
  RAINBOW_CORE_MODELS[key],{optionality:'defaults'}
).shape;
const user=shape('user');
const session=shape('session');
const account=shape('account');

// Validate only the core fields that Better Auth supplies at these lifecycle
// points. Don't revalidate plugin-owned custom fields or modify stored data.
const validators=Object.freeze({
  user:z.object({
    email:user.email.pipe(z.email()),
    emailVerified:user.emailVerified
  }).partial(),
  session:z.object({
    userId:session.userId,
    token:session.token,
    expiresAt:session.expiresAt
  }).partial(),
  account:z.object({
    userId:account.userId,
    accountId:account.accountId,
    providerId:account.providerId
  }).partial()
});

export function validateRainbowRecord(kind,record){
  if(!record||typeof record!=='object'||Array.isArray(record))
    throw new TypeError('Invalid LOC Auth '+kind+' record');
  const schema=validators[kind];
  if(!schema)throw new TypeError('Unknown LOC Auth model');
  const projected=Object.fromEntries(Object.keys(schema.shape)
    .filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
  if(!schema.safeParse(projected).success)
    throw new TypeError('Invalid LOC Auth '+kind+' fields');
  // Never replace Better Auth's original record, including plugin fields.
  return {data:record};
}

export const rainbowDatabaseHooks={
  user:{create:{before:async record=>validateRainbowRecord('user',record)}},
  session:{create:{before:async record=>validateRainbowRecord('session',record)}},
  account:{create:{before:async record=>validateRainbowRecord('account',record)}}
};
