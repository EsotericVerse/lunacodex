import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('article list retains compact cards while full body mounts read-only BlockNote only when opened',()=>{
  const article=read('app/modular/Article.jsx');
  const ui=read('app/modular/ui.jsx');
  const search=read('app/modular/features/Search.jsx');
  assert.ok(parse(article,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.ok(parse(ui,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(article,/className="scope-article-block-display"/);
  assert.match(article,/IntersectionObserver/);
  assert.match(article,/<BlockNoteEditor editable={false} initialContent={html}/);
  assert.match(article,/detailReading\?'scope-article-detail':''/);
  assert.match(ui,/export function WorkFullText\(/);
  assert.match(ui,/open&&!loading&&!error\?<div className="scope-article-block-display"/);
  assert.match(ui,/role="region" aria-label={copy\.work\.viewBody}/);
  assert.match(ui,/<BlockNoteEditor editable={false} initialContent={content\|\|\(emptyText\?\?copy\.work\.noBody\)}/);
  assert.doesNotMatch(ui,/scope-inline-card scope-article-block-display/);
  assert.match(search,/body=\{''\}/);
  assert.match(search,/fullTextKey===row\.key/);
});

test('article reading container has independent full-width BlockNote frame and responsive typography',()=>{
  const css=read('app/styles/scope-system.css');
  const pub=read('app/styles/public-features.css');
  assert.match(css,/\.scope-work-fulltext-row\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.scope-work-fulltext\{display:grid;gap:\.6rem;min-width:0;width:100%\}/);
  assert.match(css,/\.scope-article-block-display\{[\s\S]*?width:100%;[\s\S]*?padding:clamp/);
  assert.match(css,/\.scope-article-block-display \.scope-blocknote\.is-readonly \.bn-editor\{/);
  assert.match(css,/max-width:min\(100%,84ch\)/);
  assert.match(css,/\.scope-article-block-display \.bn-editor :is\(h1,h2,h3,h4,h5,h6\)/);
  assert.match(css,/\.scope-article-block-display \.bn-editor :is\(img,video,iframe\)/);
  assert.match(css,/@media\(max-width:680px\)\{[\s\S]*?\.scope-article-block-display/);
  assert.match(pub,/\.loc-public-article-list > \.loc-shared-work-card:not\(\.scope-article-detail\)/);
  assert.match(pub,/\.loc-public-article-list > \.loc-shared-work-card\.scope-article-detail/);
});

test('shared Culture, Statistics, Search and Trace article body entrypoints remain intact',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  const stats=read('app/modular/features/Statistics.jsx');
  const search=read('app/modular/features/Search.jsx');
  const trace=read('app/modular/features/trace/TracePlaceResults.jsx');
  for(const src of [culture,stats,search,trace]){
    assert.match(src,/WorkFullText/);
  }
  assert.match(search,/<IncrementalList/);
  assert.match(trace,/onToggle=|showToggle=\{false\}/);
});
