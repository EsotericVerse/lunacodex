# LOC Role hierarchy in ZenStack V3 (code-only stage)

## Product contract

LOC roles, from lowest to highest: User (OAuth), Scope (OAuth + LOC
Scope authorization), virtual Group (OAuth + LOC hierarchical delegation),
Admin (owner-issued LOC global authority). Guest is anonymous and does not
receive an `@@auth` principal.

```
guest (anonymous; no @@auth principal)
user < scope < group <= admin
```

- Group is a **virtual management tier** that can contain further Groups and
  multiple Scopes. It is **not a User, a user.role database value, or a new
  physical Group table**.
- The four role levels are stable regardless of enterprise organization depth.
  A manager of several Scopes is not automatically Group; a Group manager
  is not automatically Admin.
- The global Admin authority requires the existing explicit
  `global:manage` LOC-signed delegation. It cannot be inferred from a Group
  ancestor, organization size or user-provided role string.
- The existing `scope_id/scope_kind/parent_scope_id/active` registry shape
  is suitable for representing a trusted nested virtual Group tree; no new
  columns, database objects or migrations are introduced.

## What this stage implements

- `zenstack/schema.zmodel`: table-free `LocPrincipal @@auth` with
  `id, role, roleLevel, scopeIds, groupIds`. The fixed Registry Admin
  update/delete policy checks `auth().roleLevel >= 4`; public fixed-model
  SELECT remains `@@allow('read', true)`.
- `zenstack/schema.mjs`: mirrors the same fields and policy in the runtime
  `SchemaDef`; the 17 frozen physical models are unchanged.
- `zenstack/role-hierarchy.mjs`: pure role projector for **already verified**
  LOC delegations; expands explicitly granted virtual Groups downward through
  trusted, active, nested Group/Scope registry nodes. It does not query a
  database, create a User Group record or issue credentials.
- `zenstack/policy-runtime.mjs`: binds the derived User/Scope/Admin principal
  for the existing fixed public read and global admin write transactions.
  Current Gateway does **not** pass a virtual Group tree, so nested Group
  expansion is implemented and tested but **not yet enabled** for live writes.
- Existing focused `scripts/test-fixed-zmodel.mjs` and
  `scripts/test-zenstack-policy-runtime.mjs` cover schema parity, role tiers,
  nested groups, inactive Scopes, cycle rejection and lack of automatic Admin
  escalation.

## Authority and SQL boundary remain unchanged

This is independent of Draft PR #1210. No changes to Authority Worker, OAuth,
delegation contract, Gateway, SQL handlers, MCP, Extension, database schema,
RLS, GRANT, RPC or physical SQL policy.

The `scopeIds` derived from Group membership are a **policy projection**, not
a signed resource grant. A current SQL mutation still requires its exact
LOC-signed grant via the existing Gateway/Authority checks. In particular,
**do not** use the derived Group list to bypass `canManageDelegation` or
`canManageLoc` until the ongoing LOC Auth cutover separately issues and
verifies the corresponding resource-scoped delegations.

Once #1210 has finished, LOC Auth may supply **trusted, server-side**
Group/Scope hierarchy metadata to `locRolePrincipal`. It must verify the
issuer, signature, audience, expiry, revocation, subject and every delegated
scope before enabling descendant Scope management. Never use browser-provided
Group trees or role levels as an authorization source.

No additional SQL request, DB pool, DB schema rebuild or ZModel regeneration
is required when a Group's membership changes. A newly verified permission
snapshot must replace the old projected principal when its authorized
membership changes.
