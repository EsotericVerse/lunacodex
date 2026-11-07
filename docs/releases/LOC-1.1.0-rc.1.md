# LOC 1.1 RC1 — Release Candidate

**Pre-release for observation, not LOC 1.1 stable.**

This RC captures the current main source and keeps all existing functionality. Priorities: reduced loading waterfalls, shared browser reads with SWR, 14-day public metadata ISR with explicit authorized revalidation, and a public-image-only Service Worker cache. Original image resolution and composition remain unchanged; image bytes are referenced by URL, not stored in SQL.

## Deployment and usage

- Historical primary ISR worker configuration was retired on 2026-11-08; the current website deployment uses GitHub Pages static export.
- Manual alternate ISR: Vercel. The public `loc.lo3rwang.cc` DNS currently points to the independent GitHub Pages static site. Do not assume these domains host identical builds.
- Supabase is the authoritative database; Neon remains a manually selected backup. Local SQLite is the on-device data provider for imported data.
- Media keeps source URLs and the public-image browser cache. **No lossy image compression or original artwork changes** in this RC.
- Search, Culture, Statistics, Keywords, timeline, media and rune/3D functionality are included as implemented in the tagged commit. Further refinements and favorites are not promised as completed by this RC.

## Validation and known RC constraints

- GitHub Actions gates: `npm ci`, `npm audit --audit-level=moderate`, game and cache/bootstrap regression tests, Next.js build and 14-day ISR route verification. Native-shell IPA builds also validate the 16 static Guest/Admin route outputs.
- Cloudflare cache invalidation, authenticated Admin editing and native iPhone interactions still benefit from real-world observation; a green CI run is not proof these flows were exercised.
- The iOS asset `LOC-1.1.0-rc.1-device-unsigned.ipa` is **unsigned**. It requires Apple provisioning/signing before installation on a physical device. No signed/App Store IPA is claimed.
- Track practical bugs and error/latency trends during the RC period. Fix substantive defects before a separate decision about 1.1 stable.
