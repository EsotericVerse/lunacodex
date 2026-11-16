# LAS → LOC deployment boundary (current)

## Independent runtime ownership

- **LAS:** The existing Cloudflare Worker `lunarcus` serves both `auth.lo3rwang.cc` and `mcp.lo3rwang.cc`. Cloudflare Workers Builds publishes this worker from `EsotericVerse/lunarcus` for relevant Auth or MCP source changes. No second MCP Worker is created.
- **LOC:** `EsotericVerse/lunacodex` owns `loc.lo3rwang.cc` (Cloudflare Pages), SQL Portable, Galaxy and Scope business policies, native data APIs, and the single IPA workflow. LOC does **not** compile or serve LAS's public MCP or OAuth protocol server.
- **LRS:** `EsotericVerse/lunarunes` owns rune code/media and its separately authorized Worker release. Neither LAS nor LOC routine deployments publish LRS.
- **ISR:** Existing `loc-isr` remains unchanged, default-disabled, pending safe migration to LAS ownership. It is never an Auth/MCP build dependency.

## LOC Pages MCP gateway retired

The old LOC Pages entrypoints for `/`, `/mcp` and the two OAuth protected-resource metadata paths are removed. LOC `public/_routes.json` does not list them.

Keep `/api/las-native`, `/api/loc-native`, `/api/loc-public-*` and LOC's own database/business authorization modules: LAS calls these fixed business operations over HTTPS, not by sharing the LAS auth secret or LOC SQL credentials.

**Legacy upstream Provider Manager exception:** LOC Pages still has `/api/mcp-provider*` and `/.well-known/loc-mcp-client`. They are separate website-authenticated upstream provider controls, **not** the public inbound MCP server. They require a verified state/secret migration and end-to-end permission tests before removing them. Do not silently delete their stored credentials or browser flows.

## Optional LAS → LOC deployment notification

After LAS completes its **own** production deployment, it classifies LOC impact. A Plugins/CMS mapping change or an internal Auth/MCP change reports `skip` and makes **no** LOC request. A verified, published LOC-facing contract change may be `notify` or `review`; only `notify` should signal LOC's **GitHub Workflow**, and only once per relevant published contract version. LOC retains control of its own deployment. LAS should **not** unconditionally call LOC Pages Deploy Hook on every LAS deployment.

The authenticated Cloudflare → LOC GitHub signaling/idempotency workflow requires independent live verification. This document does not claim that cross-repo triggering is already functional. Do not expose or rotate `LOC_WORKFLOW_KEY`, LOC `CLOUDFLARE_API_TOKEN`, or LRS `LOC_EMERGENCY_KEY` as part of retiring the Pages MCP routes.

CI pass is not proof of SSO/OIDC, authorized MCP calls, or business API continuity; verify each live endpoint separately.
