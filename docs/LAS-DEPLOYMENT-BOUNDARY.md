# LAS → LOC deployment boundary

## Owners and order

- **LAS** (`EsotericVerse/lunarcus`) compiles and publishes its own `lunarcus` Auth Worker via existing Cloudflare Workers Builds. This release does not publish LRS or LOC code.
- **LOC** (`EsotericVerse/lunacodex`) owns its own Cloudflare Pages `loc` project on `main` (`npm run build:static`) and the single manual native IPA workflow. LOC does not compile LAS Workers.
- **LRS** (`EsotericVerse/lunarunes`) controls Rune releases/assets separately; the LAS trigger must not affect its deployments or native asset pinning.

After a successful LAS Auth release, the existing LAS `.github/workflows/notify-loc-after-auth.yml` verifies the Cloudflare check and current LAS main commit, then sends a protected HTTPS POST to a **LOC Pages production/main Deploy Hook**. This triggers LOC's existing build without modifying the LOC Git branch or adding another build pipeline.

## External configuration (not stored in either repository)

1. In Cloudflare Pages project **`loc`**, under Settings → Builds, create a Deploy Hook named `las-auth-to-loc` selecting branch **`main`**.
2. Save the generated URL in LAS repository GitHub Actions secret **`LOC_PAGES_DEPLOY_HOOK`**. Treat it as a deploy credential and never print it to logs or commit it.
3. Verify a subsequent **real LAS Auth production deployment** causes exactly one LOC Pages production/main deployment. Confirm LAS build/check success, LOC build commit and status, and no redundant LRS/MCP/IPA deployment.

The Cloudflare Pages API exposes project deployment creation but not a supported Pages Deploy Hook **management** endpoint in the currently available OpenAPI; avoid attempting undocumented API mutations or replacing this with direct uploaded files.

## Fail-closed constraints

- Missing/invalid `LOC_PAGES_DEPLOY_HOOK`: LAS notification fails without a LOC deployment.
- Stale LAS commit, non-Auth-only change, failed/preview Cloudflare check: no LOC deploy.
- LOC's `workflow-guard.yml` continues rejecting unauthorized GitHub auto-deploy workflows; `deploy-pages.yml` remains a manual GitHub Pages fallback.
- No Cloudflare DNS, Auth issuer, Access policies, Secret values, database bindings, or LRS route changes are required.
- **CI success is not SSO/OIDC acceptance.** Interactive login/session and MCP permissions require independent verification.
