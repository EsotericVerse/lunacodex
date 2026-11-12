import {createSchemaFactory} from '@zenstackhq/zod';
import * as z from 'zod';
import {schema} from '../../../zenstack/schema.mjs';

// Reuse the fixed Manage ZModel. Zod narrows its business role projection
// without maintaining a second copy of the physical column types.
const fields=createSchemaFactory(schema)
  .makeModelSchema('Manage',{optionality:'defaults'}).shape;
export const WebManageRowSchema=z.strictObject({
  id:fields.id.pipe(z.string().regex(/^[a-z][a-z0-9]{0,14}$/)),
  email:fields.email.pipe(z.email()),
  manage_role:fields.manage_role.pipe(z.enum(['admin','group','scope'])),
  active:fields.active.pipe(z.boolean())
});
