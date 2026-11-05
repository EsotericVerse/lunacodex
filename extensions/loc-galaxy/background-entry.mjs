// Preserve the existing LOC Galaxy service worker and add the website-origin
// callback for Chrome builds that omit sender.tab on external web messages.
import './background.mjs';
import './website-grant-fallback.mjs';
