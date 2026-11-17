import test from 'node:test';
import assert from 'node:assert/strict';
import {runeFeatureDestination,rewriteRuneFeatureAnchors} from '../app/loc/blocks/rune-feature-links.mjs';

test('only LRS card and game feature URLs replace old lrunes links',()=>{
 const cases={
  'https://lrunes.lo3rwang.cc/card/':'https://lrs.lo3rwang.cc/card/',
  'https://lrunes.lo3rwang.cc/card/duel/':'https://lrs.lo3rwang.cc/card/',
  'https://lrunes.lo3rwang.cc/card/daily/':'https://lrs.lo3rwang.cc/card/daily/',
  'https://lrunes.lo3rwang.cc/card/list/':'https://lrs.lo3rwang.cc/card/list/',
  'https://lrunes.lo3rwang.cc/game/':'https://lrs.lo3rwang.cc/game/',
  'https://loc.lo3rwang.cc/lrunes/game/':'https://lrs.lo3rwang.cc/game/',
  'https://lrunes.lo3rwang.cc/duel/one/':'https://lrs.lo3rwang.cc/card/',
  'https://lrunes.lo3rwang.cc/duel/daily/':'https://lrs.lo3rwang.cc/card/daily/',
  'https://lrunes.lo3rwang.cc/duel/ow3gs/':'https://lrs.lo3rwang.cc/card/'
 };
 for(const [a,b] of Object.entries(cases))assert.equal(runeFeatureDestination(a),b,a);
});
test('Scope home, accounts, other hosts, normal NAV and records remain unchanged',()=>{
 for(const href of [
  'https://lrunes.lo3rwang.cc/',
  'https://lrunes.lo3rwang.cc/culture/',
  'https://lrunes.lo3rwang.cc/daily/log/',
  'https://loc.lo3rwang.cc/lo3rwang/',
  'https://loc.lo3rwang.cc/card/',
  'https://example.org/game/',
  'https://lrs.lo3rwang.cc/card/'
 ])assert.equal(runeFeatureDestination(href),href);
});
test('published block links are resolved without changing text, markup or DB',()=>{
 const html='<p><a href="https://lrunes.lo3rwang.cc/card/duel/" target="_blank">抽牌</a> · <a href="https://lrunes.lo3rwang.cc/game/?foo=1&amp;bar=2">遊戲</a> · <a href="https://lrunes.lo3rwang.cc/daily/log/">紀錄</a></p>';
 const out=rewriteRuneFeatureAnchors(html);
 assert.ok(out.includes('href="https://lrs.lo3rwang.cc/card/" target="_blank"'));
 assert.ok(out.includes('href="https://lrs.lo3rwang.cc/game/?foo=1&amp;bar=2"'));
 assert.ok(out.includes('href="https://lrunes.lo3rwang.cc/daily/log/"'));
 assert.ok(out.includes('抽牌'));
});
