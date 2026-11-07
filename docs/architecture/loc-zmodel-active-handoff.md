# LOC ZModel completion — active handoff (2026-11-07)

> Current code checkpoint. **Code is implemented on this branch, not yet declared deployed.** All changes are bounded to the frozen model, a pure hierarchy projector, stable global identity, and portable schema validation. Review CI and integration results before claiming production behavior.

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

**Implemented on this branch (2026-11-07):**

- `zenstack/anchor-hierarchy.mjs`: pure four-family Anchor hierarchy projection: Keyword `category→class→group→item`, Source `universe→galaxy→domain→from`, Time `era→period→date`, Space `trace→path→point` (Trace may also link directly to Point). Missing linked UIDs are explicitly reported when only a partial data window is loaded.
- `app/loc/keyword-tree.mjs`: native 8-character Keyword and Source tree parsing **now invokes the shared ZModel hierarchy logic**. Four-character legacy Keyword import behavior is preserved. This is a real production consumer, not a detached model file.
- `zenstack/global-identity.mjs`: public, stable, non-secret `databaseId:scopeId:uid` reference. It does not alter physical UID keys, derive permission, or expose credentials. Distinguishes identical local UIDs across databases and Scopes.
- `app/loc/providers/kysely-schema.mjs`: portable Galaxy/Anchor required-column lists now derive from the existing fixed ZenStack runtime model; Lo3rwang and Lrunes variants must have identical column sets. Kysely remains responsible for live SQL dialects, data and authorization.
- New focused tests: `scripts/test-zmodel-anchor-hierarchy.mjs`, `scripts/test-zmodel-global-identity.mjs`, `scripts/test-zmodel-portable-schema.mjs`.

**Validation evidence:** 10 direct V8 executions of existing Keyword/Source regression tests, global identity tests, and portable column scenarios passed; 9 additional V8 executions of the new Anchor hierarchy tests passed. The V8 harness evaluated the source functions with imports replaced by already-fetched dependencies; this is **not** the same as an executed Node/Next build, real ZenStack PolicyPlugin test, live DB integration or Cloudflare deployment. Those remain unverified here.

**Non-goals maintained:** no modification of FlexSearch, KV, LOC Auth #1210, SQL Gateway request execution, RLS, permissions, physical Schema, SQL migrations, database synchronization, or frontend Search.

**Important integration invariant:** ZModel virtual hierarchy is computed over rows already scoped to a single permitted (databaseId, ScopeID). Do not mix raw eight-character UIDs across databases into one hierarchy map. Use the global identity key for any multi-source index or result reference. Group-derived model relationships never create SQL write grants.

**Source of truth:** GitHub branch `feat/loc-zmodel-completion-20261107`, this document, AGENTS.md, current main, PR #1210 and the independently owned FlexSearch work. Do not search Galaxy conversation history for this GitHub implementation task.

**Source of truth:** GitHub branch `feat/loc-zmodel-completion-20261107`, this file, latest `AGENTS.md`, current main, and draft #1210. Do not search Galaxy conversation history for this GitHub implementation task.
