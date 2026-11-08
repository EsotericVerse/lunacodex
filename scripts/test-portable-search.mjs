import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {portableContainsSpec,portableContainsTerm,parsePortableOrExpression} from '../app/loc/providers/portable-search.mjs';
import {runInNewContext} from 'node:vm';
import {isTextSearchQuery} from '../app/loc/providers/search-qos.mjs';

test('CJK literal search does not introduce LOWER on Galaxy.content',()=>{
  assert.deepEqual(portableContainsSpec('混沌'),{fold:false,pattern:'%混沌%'});
  assert.deepEqual(portableContainsSpec('符文 66'),{fold:false,pattern:'%符文 66%'});
});
test('case-aware queries preserve portable case-insensitive matching',()=>{
  assert.deepEqual(portableContainsSpec('Dark Jazz'),{fold:true,pattern:'%dark jazz%'});
  assert.deepEqual(portableContainsSpec('LP13'),{fold:true,pattern:'%lp13%'});
});
test('LIKE punctuation is literal, not user-controlled wildcards',()=>{
  assert.deepEqual(portableContainsSpec('黑刃%_!'),{fold:false,pattern:'%黑刃!%!_!!%'});
  assert.equal(portableContainsTerm('a"b\\c'),'a\\"b\\\\c');
  assert.equal(portableContainsTerm('a\nb'),'a b');
});
test('Native Kysely contains uses parameterized cross-dialect LIKE with explicit ESCAPE',()=>{
  const sql=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.match(sql,/contains:'contains'/);
  assert.match(sql,/containsPredicate\(column,term\)/);
  assert.match(sql,/sql\`lower\(\$\{sql\.ref\(column\)\}\) like \$\{pattern\} escape '!'/);
  assert.match(sql,/sql\`\$\{sql\.ref\(column\)\} like \$\{pattern\} escape '!'/);
  assert.match(sql,/if\(node\.operator==='contains'\)/);
  assert.match(sql,/else if\(filter\.operator==='contains'\)/);
});
test('article search routes advanced AND OR excludes through contains',()=>{
  const search=readFileSync(new URL('../app/loc/galaxy-query.js',import.meta.url),'utf8');
  const transport=readFileSync(new URL('../app/loc/providers/direct-data-api.mjs',import.meta.url),'utf8');
  assert.match(search,/\.contains\./);
  assert.match(search,/query\.not\(field,'contains',term\)/);
  assert.match(transport,/contains\(c,v\)/);
  const qos=readFileSync(new URL('../app/loc/providers/search-qos.mjs',import.meta.url),'utf8');
  assert.match(qos,/contains/);
  assert.doesNotMatch(search,/field\+'\.ilike/);
});

test('text search remains rate-limited and literal values are not coerced',()=>{
  const base={kind:'query',operation:'select',table:'lo3rwang_galaxy'};
  assert.ok(isTextSearchQuery({...base,or:['content.contains."混沌"']}));
  assert.ok(isTextSearchQuery({...base,filters:[{column:'content',operator:'contains',value:'混沌'}]}));
  assert.equal(isTextSearchQuery({...base,filters:[{column:'date',operator:'gte',value:'2026-01-01'}]}),false);
  for(const value of ['null','true','0001']){
    assert.equal(portableContainsSpec(value).pattern,'%'+value+'%');
  }
  const runtime=readFileSync(new URL('../app/loc/providers/kysely-runtime.mjs',import.meta.url),'utf8');
  assert.match(runtime,/operator==='contains'\?String\(rawValue\)/);
});


test('shared OR parsing preserves punctuation, nested precedence, and text values',()=>{
  const expr='and(or(content.contains."黑刃",content.contains."混沌"),date.gte.2026-01-01)';
  const parsed=parsePortableOrExpression(expr);
  assert.equal(parsed.items[0].type,'and');
  assert.equal(parsed.items[0].items[0].type,'or');
  assert.equal(parsed.items[0].items[0].items[0].value,'黑刃');
  assert.equal(parsePortableOrExpression('content.contains."null"').items[0].value,'null');
  assert.equal(parsePortableOrExpression('content.contains."0001"').items[0].value,'0001');
  assert.equal(parsePortableOrExpression('content.contains."你好,(混沌)!"').items[0].value,'你好,(混沌)!');
  assert.throws(()=>parsePortableOrExpression('content.contains."unfinished'),/Malformed OR filter/);
  assert.throws(()=>parsePortableOrExpression('content;drop.contains."x"'),/Unsupported OR filter/);
});

test('local SQLite compiles the same parameterized contains and nested OR logic',()=>{
  const source=readFileSync(new URL('../app/loc/providers/local-sqlite.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const IDENT=/');
  const end=source.indexOf('// -- Chainable query builder',start);
  assert.ok(start>=0&&end>start);
  const api=runInNewContext(source.slice(start,end)+'\n({compileFilter,compileLocalOr})',
    {portableContainsSpec,parsePortableOrExpression});
  const simple=api.compileFilter('content','contains','黑刃%_!');
  assert.equal(simple.sql,'"content" LIKE ? ESCAPE \'!\'');
  assert.deepEqual([...simple.params],['%黑刃!%!_!!%']);
  const english=api.compileFilter('content','contains','Dark Jazz');
  assert.equal(english.sql,'lower("content") LIKE ? ESCAPE \'!\'');
  assert.deepEqual([...english.params],['%dark jazz%']);
  const compound=api.compileLocalOr(parsePortableOrExpression(
    'and(or(content.contains."黑刃",content.contains."混沌"),date.gte.2026-01-01)'
  ));
  assert.equal(compound.sql,'((("content" LIKE ? ESCAPE \'!\' OR "content" LIKE ? ESCAPE \'!\') AND "date">=?))');
  assert.deepEqual([...compound.params],['%黑刃%','%混沌%','2026-01-01']);
  assert.throws(()=>api.compileFilter('content;drop','contains','x'),/Invalid column/);
  assert.match(source,/or\(expr\)\{state\.orFilters\.push\(parsePortableOrExpression\(expr\)\)/);
});
