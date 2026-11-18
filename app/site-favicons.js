import {SITE_IMAGES} from './site-images';

// Browser favicon identity is Scope-specific; the author uses the existing
// "作者的話" image, never generated artwork.
export const SCOPE_FAVICONS=Object.freeze({
  loc:'/assets/site/icons/loc-favicon.png',
  lrunes:SITE_IMAGES.lunarunes.src,
  lo3rwang:SITE_IMAGES.author.src
});

export function faviconForScope(scopeId='loc'){
  return SCOPE_FAVICONS[String(scopeId||'').trim().toLowerCase()]||SCOPE_FAVICONS.loc;
}
