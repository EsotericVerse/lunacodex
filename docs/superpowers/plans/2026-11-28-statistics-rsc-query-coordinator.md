# Statistics RSC Query Coordinator Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prefetch each Statistics page's initial aggregate through the existing Next.js Server Action and hand it to the client chart without a duplicate first read.

**Architecture:** A server-only page bootstrap helper computes the current Taiwan calendar-year range and calls the existing fixed `queryStaticsContent` Server Action once. App Router pages pass the result through `LocApp` to Statistics; client chart components adopt it only when Scope and date range match, and keep existing Server Actions for subsequent filters and ranges.

**Tech Stack:** Next.js App Router / React Server Components, existing Server Actions, Kysely, Node test runner.

**Spec:** User-confirmed LOC routing table dated 2026-11-23; prior LOC decision to retain Next.js and deepen RSC/SSR/Server Actions rather than remove Next.js.

## Global Constraints
- Group `/manage/` remains the existing Group people/works management route.
- Scope order is Time, Space, Keywords, Articles; User order is Culture, Trace, Statistics, Search.
- Keep the existing feature-owned Server Actions and Kysely → SQL boundary.
- Preserve LOC's cross-Scope aggregate query and existing React/Recharts/Motion presentation.
- Do not replace the LAS/LOC Native Bridge or add a parallel RPC/HTTP query route.

## Review Focus
- Taiwan calendar-year boundary and UTC-to-Taipei date conversion.
- Unpublished, invalid, or non-statistics Scopes must not receive initial data.
- A URL-selected chart dimension must not consume a mismatched total-only bootstrap.
- A changed Scope or date range must not display a stale server snapshot.
- LOC aggregate and individual Scope statistics retain their distinct response shapes.

---

### Task 1: Lock the routing order

**Files:**
- Modify: `app/modular/routing/management-route-table.mjs`
- Test: `tests/loc-management-hero-contract.test.mjs`

- [x] Update the expected Scope and User key order in the contract test.
- [x] Run the focused test and confirm it fails against the current route-table property order.
- [x] Reorder only the existing route-table keys; keep all route values unchanged.
- [x] Run the focused test.

### Task 2: Add the server page bootstrap

**Files:**
- Create: `app/loc/statistics/page-bootstrap.mjs`
- Test: `tests/loc-statistics-page-bootstrap.test.mjs`
- Modify: `package.json`

**Interface:** `loadStatisticsPageInitialData(scopeId, {now, query})` returns `{scopeId,startDate,endDate,data}` or `null` for an invalid/non-public Scope. `query` defaults to the existing `queryStaticsContent` Server Action and is injectable for deterministic unit tests.

- [x] Write tests for LOC `kind=loc`, individual Scope `kind=daily_total`, Taiwan date boundary, and invalid Scope rejection.
- [x] Run the tests and confirm the expected failure.
- [x] Implement the minimal loader using `calendarYearWindow` and the existing Server Action.
- [x] Add the test to `test:core` and run it.

### Task 3: Prefetch from App Router pages

**Files:**
- Modify: `app/statics/page.jsx`
- Modify: `app/lo3rwang/statics/page.jsx`
- Modify: `app/lrunes/statics/page.jsx`
- Modify: `app/scope-shell/statics/page.jsx`

- [x] Convert these page functions to async server components and load the correct published Scope's initial Statistics data.
- [x] For `scope-shell`, use only the explicit `scopeid` search parameter; leave the bootstrap absent when it is not supplied.
- [x] Pass the snapshot as `initialData` to `LocApp`.

### Task 4: Hand off and adopt the snapshot

**Files:**
- Modify: `app/loc/LocApp.jsx`
- Modify: `app/modular/features/Statistics.jsx`
- Modify: `app/modular/modules/statistics/ScopeGroupStatistics.jsx`

- [x] Pass `initialData` through the existing feature route to Statistics.
- [x] Adopt LOC aggregate data in `ScopeGroupStatistics` only when Scope and observed date range match.
- [x] Adopt individual Scope `daily_total` data in `ScopeStatisticsResults` only when Scope and observed date range match.
- [x] Keep later period, category, keyword, zoom, and filter reads on their existing feature-owned Server Actions.
- [x] Ensure the matched initial snapshot does not trigger a duplicate browser read.

### Task 5: Verify integration

- [x] Run the focused tests and `pnpm test:core`.
- [x] Run syntax checks and the existing production/Worker build path when available.
- [x] Review the complete diff for authorization, stale-data, and hydration regressions.
- [x] Report any verification that cannot be run in the current environment as unverified; do not infer success.

**Verified on final Cloudflare Preview head `585377e`:** `pnpm run test:core` 159/159 passed; syntax check 492 files / 0 errors; Next.js Production Build and OpenNext Worker Build succeeded; Cloudflare Preview deployment succeeded. App Router reports all four Statistics pages as request-dynamic (`ƒ`). The Preview was deployed, but interactive browser navigation could not be performed in this session.
