import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app/loc/views/CulturePublicReader.jsx',import.meta.url),'utf8');
const ui=source.slice(source.indexOf("onGroupToggle={group=>{",source.indexOf("className='scope-culture-classification-river'")));
const reset=source.slice(source.indexOf('  const resetArticles='),source.indexOf('  const toggleFull='));

test('expanding a big category only reveals child labels, never requests articles',()=>{
  assert.match(ui,/name\.startsWith\('root:'\)/);
  assert.match(ui,/setExpandedSources\(old=>old\.includes\(id\)/);
  const parentHandler=ui.slice(ui.indexOf('onGroupToggle='),ui.indexOf('onGroupSelect='));
  assert.doesNotMatch(parentHandler,/openArticles\(|fetchArticles\(/);
  assert.doesNotMatch(ui,/densityRiver\.sites\.map\(item=><div/);
});

test('clicking a child category requests its own bounded article list',()=>{
  assert.match(ui,/name\.startsWith\('site:'\)/);
  assert.match(ui,/densityRiver\.sites\.find\(item=>'site:'\+item\.key===name\)/);
  assert.match(ui,/openArticles\(category\.site,category\.key\)/);
  assert.match(reset,/resetArticles\(site,categoryKey\);\s*setArticlesOpen\(true\);\s*fetchArticles\(\{site,offset:0\}\)/);
});

test('switching categories clears the old rows and rejects late results',()=>{
  assert.match(reset,/sequence\.current\+=1;setSelectedSite\(site\)/);
  assert.match(reset,/setArticleRows\(\[\]\);setArticleOffset\(0\)/);
  assert.match(reset,/if\(request!==sequence\.current\)return/);
  assert.match(reset,/setArticleRows\(old=>append\?\[\.\.\.old,\.\.\.page\.rows\]:page\.rows\)/);
  assert.match(reset,/if\(!articlesOpen\|\|!selectedSite\)return/);
  assert.match(source,/articlesOpen&&densityMode==='source'&&selectedSite\?<section/);
});

test('changing period or keyword display clears any prior selection',()=>{
  assert.match(reset,/\[scopeId,rangeStart,rangeEnd,densityMode,keywordClass\]/);
  assert.match(reset,/setSelectedSite\(''\);setSelectedCategoryKey\(''\)/);
  assert.match(source,/densityMode==='source'&&expandedSources\.length>0&&!articlesOpen/);
});
