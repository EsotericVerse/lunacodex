import {SITE_IMAGES} from './site-images';
import {runeAssetHref} from './lrunes/rune-asset-origin.mjs';

// Browser favicon identity is Scope-specific; the author uses the existing
// "作者的話" image, never generated artwork.
export const SCOPE_FAVICONS=Object.freeze({
  loc:'/assets/site/icons/loc-favicon.png',
  lrunes:runeAssetHref('/assets/site/icons/lrunes-favicon.png'),
  lo3rwang:SITE_IMAGES.author.src
});

export function faviconForScope(scopeId='loc'){
  return SCOPE_FAVICONS[String(scopeId||'').trim().toLowerCase()]||SCOPE_FAVICONS.loc;
}
