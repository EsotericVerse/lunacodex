import {keywordScanText} from './content-filter.mjs';

// Suggestion-only projection. Punctuation and symbols become boundaries,
// rather than being concatenated into new words. The shared content filter
// remains untouched for literal keyword matching and NOR/AND/TO/NAME parsing.
const PUNCTUATION_AND_SYMBOLS=/[\p{P}\p{S}]+/gu;

export function keywordDiscoveryText(row={}){
  return keywordScanText(row)
    .replace(PUNCTUATION_AND_SYMBOLS,' ')
    .replace(/\s+/gu,' ')
    .trim();
}
