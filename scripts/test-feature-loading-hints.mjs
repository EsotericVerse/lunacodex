import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('culture shows article loading status only while selected category is fetching',()=>{
  const s=read('app/loc/views/CulturePublicReader.jsx');
  assert.match(s,/articlesLoading\?<p className='scope-status' role='status' aria-live='polite'>載入中請稍後<\/p>:null/);
  assert.match(s,/resetArticles\(site,categoryKey\)/);
  assert.match(s,/finally\{if\(request===sequence\.current\)setArticlesLoading\(false\)/);
});

test('search begins with searching message and keeps results/error updates',()=>{
  const s=read('app/modular/features/Search.jsx');
  assert.match(s,/setStatus\('搜尋中請稍後'\)/);
  assert.match(s,/<p className="scope-status" role="status" aria-live="polite">\{status\}<\/p>/);
  assert.match(s,/setStatus\(''\)/);
});

test('statistics shows one localized pending status for overview and article lists',()=>{
  const s=read('app/modular/features/Statistics.jsx');
  assert.match(s,/worksQuery\.isPending\?<p className="scope-status" role="status">統計中請稍後<\/p>:null/);
  assert.match(s,/sourceChart&&!sourceRows\.error/);
  assert.match(s,/<p className="scope-status" role="status">統計中請稍後<\/p>/);
});

test('trace displays a single status for route index or points and retains error display',()=>{
  const s=read('app/modular/features/Trace.jsx');
  assert.match(s,/traceIndex\.isPending\|\|\(isLoc\?locPointsQuery\.isPending:anchorsQuery\.isPending\)/);
  assert.match(s,/找尋痕跡中請稍後/);
  assert.doesNotMatch(s,/>\{t\("loadingAnchors"\)\}<\/p>/);
  assert.match(s,/t\("anchorsError"\)/);
});
