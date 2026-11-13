import {createSchemaFactory} from '@zenstackhq/zod';
import * as z from 'zod';
import {schema} from '../../../zenstack/schema.mjs';

// loc_access is a business function, not a physical table or second ZModel.
// Derive the role row directly from the existing api.manage -> Manage mapping.
const fields=createSchemaFactory(schema)
  .makeModelSchema('Manage',{optionality:'defaults'}).shape;
export const LocAccessRowSchema=z.strictObject({
  id:fields.id.pipe(z.string().regex(/^[a-z][a-z0-9]{0,14}$/)),
  email:fields.email.pipe(z.email()),
  manage_role:fields.manage_role.pipe(z.enum(['admin','group','scope'])),
  active:fields.active.pipe(z.boolean())
});
