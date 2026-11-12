// Explicit OpenNext configuration for the optional loc-isr Worker.
// The Cloudflare Builds command passes --openNextConfigPath to this file.
// This does not add an adapter dependency to the LOC static website.
import {defineCloudflareConfig} from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
