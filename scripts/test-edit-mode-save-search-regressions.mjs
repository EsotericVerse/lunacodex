import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Edit Dock provides one explicit Save and never saves an unchanged editor',()=>{
  const dock=read('app/modular/edit-dock.jsx');
  const shell=read('app/AppShell.jsx');
  assert.match(dock,/const editors=dirty;/);
  assert.match(dock,/if\(!editors\.length\)\{\s*setNotice\('目前沒有待儲存的變更。'\)/);
  assert.doesNotMatch(dock,/saveAndSwitch|stayInEditMode|已暫存|儲存並切換/);
  assert.match(shell,/editDock\.save\(\)/);
  assert.doesNotMatch(shell,/editDock\.save\(\{stayInEditMode/);
});

test('Homepage real Save avoids repeated SELECT and a forced page navigation',()=>{
  const drafts=read('app/loc/ScopeBlockDraftList.jsx');
  const blocks=read('app/loc/ScopeEditableBlocks.jsx');
  assert.match(drafts,/async function publishSavedBlocks\(rows\)/);
  assert.match(drafts,/mutate\(appBootstrapKey\(scopeId,pageName\)/);
  assert.match(drafts,/\{revalidate:false\}/);
  assert.doesNotMatch(drafts,/refreshBlockQueries|await mutate\(bootstrapKey\)|await mutate\(displayKey\)/);
  assert.match(blocks,/if\(editDock\?\.active&&editDock\.scopeId===scopeId\)\{[\s\S]*?return;/);
});

test('Inline block, classification, route and time editors reuse fixed Dock Save',()=>{
  const single=read('app/loc/ScopeBlockEditorSession.jsx');
  const classes=read('app/loc/FlatClassificationEditor.jsx');
  const trace=read('app/loc/TraceRouteManager.jsx');
  const culture=read('app/modular/features/CultureTimelineEditor.jsx');
  assert.match(single,/useEditDockForm\(\{save,isDirty:/);
  assert.match(single,/\.\.\.\(inDock\?\[\]:\[\{key:'save'/);
  assert.match(classes,/!inDock\?<button className="loc-button primary"/);
  assert.match(trace,/!inDock\?<button className="loc-button primary"/);
  assert.match(culture,/onSubmit=\{event=>event\.preventDefault\(\)\}/);
});

test('Culture refreshes active source-window keys, not retired v2/v6 keys',()=>{
  const culture=read('app/modular/features/Culture.jsx');
  assert.match(culture,/resourceCache\.invalidate\(\{queryKey:\['culture-period-roots'\]\}\)/);
  assert.match(culture,/resourceCache\.invalidate\(\{queryKey:\['culture-period-source-snapshot'\]\}\)/);
});

test('Search shows Galaxy date and updates same-page URL without a route remount',()=>{
  const search=read('app/modular/features/Search.jsx');
  const providers=read('app/loc/galaxy-query.js');
  assert.match(search,/date=\{row\.date\}/);
  assert.match(search,/window\.history\.pushState\(null,'',url\)/);
  assert.match(providers,/\.\.\.\(!localArticle\(current\)\?\['date'\]:\[\]\)/);
});
