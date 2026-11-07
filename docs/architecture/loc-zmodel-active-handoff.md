# LOC ZModel completion — active handoff (2026-11-07)

> Work in progress: **this document records a handoff checkpoint, NOT a finished feature or deployable release.** It can be read after a conversation reset. Continue development on this branch. Do not open a PR until implementation and focused regressions have been validated.

## User's latest assignment and hard boundaries

- Finish **ZModel comprehensively** first, then discuss other work. The separate agent owns **FlexSearch / website Search speed**. Do not edit its search files, attempt a parallel implementation, or claim that ZModel accelerates full-text search.
- Draft PR **#1210** owns **LOC Auth / Authority Worker / native OAuth / signed delegation / Gateway / MCP / Extension**. Do not modify those modules while #1210 is unfinished; avoid overlapping with its changed files, especially `scripts/test-fixed-zmodel.mjs`.
- Keep the database hard freeze: no DDL, schema, table/column, migration, RLS, policy, GRANT, RPC or physical index changes; do not introduce automatic migrations.
- Existing app structure, page design, Kysely bounded queries, public anonymous SELECT and current authorization behavior must be retained. No new physical Group/User table.
- Role is `Guest (anonymous) / User < Scope < Virtual Group <= Admin`. Group is a **virtual hierarchical Scope management role**, not a group-user record; only an explicitly issued LOC global grant can become Admin. Group may itself contain nested virtual groups and Scopes.

## Verified state before this branch

- PR **#1214** merged to main at commit `8b4c032d3f87548ea57809d30cabac2b497932e5`. It added virtual role principal `roleLevel / scopeIds / groupIds` in `zenstack/schema.zmodel`, `zenstack/schema.mjs`, `zenstack/role-hierarchy.mjs`, `zenstack/policy-runtime.mjs`, and tests.
- Physical schema snapshot is `zenstack/schema-contract.json`: 17 existing models, compiled by `zenstack/schema.mjs`. This is intentionally fixed, no schema generation/migrations in the runtime.
- In `zenstack/policy-runtime.mjs`, ZenStack PolicyPlugin is used for only the four designated public fixed-model reads and global registry writes. Dynamic Galaxy/Anchor and portable SQL (PG/MySQL/MSSQL/SQLite) still use Kysely; do **not** claim they are automatically ZModel-policy-enforced.
- `zenstack/role-hierarchy.mjs` can project a trusted nested Group tree from verified LOC delegations into an ORM-only principal. It does **not** itself issue Auth grants or extend Gateway SQL permissions. Live Group-delegated SQL write access waits for LOC Auth #1210.
- Existing independent hierarchical processors include `app/loc/keyword-tree.mjs` (keyword `category → class → group → item`, source `universe → galaxy → domain → from`), time `era → period → date`, and spatial `trace → path → point`. Investigate the actual code and established `attr` semantics before refactoring; do not infer model relations from a conceptual diagram.
- Existing code/test reference: `scripts/test-fixed-zmodel.mjs`, `scripts/test-zenstack-policy-runtime.mjs`, `scripts/test-zenstack-policy-runtime.real.mjs`; `.github/workflows/test-zenstack-policy.yml` is manual-only.
- Focused V8 checks (15 checks) and a mocked 17-table SchemaDef policy runtime check were run during #1214 work. They **do not** constitute an executed complete Node / real PolicyPlugin / deployed authorization test.

## Next work for this branch

1. Audit existing schema contract / ZModel `@@auth`, fixed model mapping and the actual keyword/source/time/space hierarchy modules. Specify which features belong to a **nonphysical, pure hierarchy projection**, which remain Kysely SQL, and what ZenStack supports without DB changes.
2. Implement the ZModel-side integration in isolated `zenstack/**` modules, preserving the proven existing hierarchy semantics. Avoid duplicating working logic or crossing into #1210 ownership.
3. Ensure policy runtime uses an already-verified principal; distinguish **effective hierarchy/visibility** from **issued write grants**. Test guest, user, Scope, nested Group, Admin and revoked/inactive/grant-less cases.
4. Regress static ZModel ↔ SchemaDef ↔ frozen SQL contract; run relevant real Node/ZenStack tests if an execution environment is available. Run targeted regex searches of stale runtime references and historical migrations separately; history is not proof of active reliance.
5. Recheck latest `main` and draft #1210 overlap before creating **one finished PR** (avoid editing #1210-owned files). Merge only after function-level verification and no conflicts; verify deploy separately. If runtime verification is impossible, report it accurately.

## Handoff status

**Current changes on branch at initial checkpoint:** this handoff file only. No ZModel implementation changes made on this branch yet. Existing #1214 changes are already on main.

**Source of truth:** GitHub branch `feat/loc-zmodel-completion-20261107`, this file, latest `AGENTS.md`, current main, and draft #1210. Do not search Galaxy conversation history for this GitHub implementation task.
