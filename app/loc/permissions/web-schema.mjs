import {z} from 'zod';

// Web business roles are independent of the LOC Auth identity/session schema.
export const WebManageRowSchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  email:z.email(),
  manage_role:z.enum(['admin','group','scope']),
  active:z.boolean()
});
export const WebRoleSchema=z.strictObject({
  id:z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
  email:z.email(),
  role:z.enum(['admin','group','scope'])
});
export const WebPermissionSessionSchema=z.strictObject({
  subject:z.string().min(1).max(128),
  email:z.email(),
  roles:z.array(WebRoleSchema).max(256),
  createdAt:z.number().int().nonnegative(),
  usedAt:z.number().int().nonnegative()
});
