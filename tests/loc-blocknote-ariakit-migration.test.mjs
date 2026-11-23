import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('BlockNote uses Ariakit only; the data engine and content format stay unchanged',()=>{
  const pkg=JSON.parse(source('package.json'));
  const view=source('app/loc/editor/BlockNoteEditorClient.jsx');
  const wrapper=source('app/loc/editor/BlockNoteEditor.jsx');
  const css=source('app/globals.css');
  assert.equal(pkg.dependencies['@blocknote/core'],'0.55.0');
  assert.equal(pkg.dependencies['@blocknote/react'],'0.55.0');
  assert.equal(pkg.dependencies['@blocknote/ariakit'],'0.55.0');
  assert.equal(pkg.dependencies['@blocknote/mantine'],undefined);
  assert.match(view,/import \{BlockNoteView\} from '@blocknote\/ariakit'/);
  assert.match(view,/SuggestionMenuController,useCreateBlockNote/);
  assert.match(view,/triggerCharacter="@"/);
  assert.match(view,/canonicalBlockNoteBlocks\(editor\.document\)/);
  assert.match(view,/editor\.blocksToHTMLLossy\(blocks\)/);
  assert.match(view,/editor\?\._tiptapEditor/);
  assert.match(view,/editor\.insertBlocks\(\[image\]/);
  assert.match(view,/formattingToolbar=\{plainTextOnly\?false:undefined\}/);
  assert.match(view,/slashMenu=\{plainTextOnly\?false:undefined\}/);
  assert.match(wrapper,/const BlockNoteCanvas=dynamic\(\(\)=>import\('\.\/BlockNoteEditorClient'\)/);
  assert.match(css,/@blocknote\/ariakit\/style\.css/);
  assert.doesNotMatch(css,/@blocknote\/mantine/);
  assert.match(css,/blocknote-ariakit\.css/);
});

test('Ariakit theme follows existing LOC palette without Mantine component CSS',()=>{
  const css=source('app/styles/blocknote-ariakit.css');
  const view=source('app/loc/editor/BlockNoteEditorClient.jsx');
  for(const name of ['--bn-text-color-primary','--bn-background-color-editor',
    '--bn-background-color-menu','--bn-background-color-selected',
    '--bn-focus-ring-color','--bn-font-family-default'])
    assert.ok(css.includes(name),name);
  assert.match(css,/\.bn-root\[data-color-scheme\]/);
  assert.doesNotMatch(view,/LOC_BLOCKNOTE_THEME|@blocknote\/mantine/);
  assert.doesNotMatch(css,/@mantine\/|\.mantine-/);
});

test('lockfile removes Mantine and installs the Ariakit peer-accurate package',()=>{
  const lock=JSON.parse(source('package-lock.json'));
  assert.equal(lock.packages[''].dependencies['@blocknote/ariakit'],'0.55.0');
  assert.equal(lock.packages[''].dependencies['@blocknote/mantine'],undefined);
  assert.equal(lock.packages['node_modules/@blocknote/ariakit']?.version,'0.55.0');
  assert.equal(lock.packages['node_modules/@blocknote/mantine'],undefined);
  assert.equal(lock.packages['node_modules/@mantine/core'],undefined);
  assert.equal(lock.packages['node_modules/@mantine/hooks'],undefined);
});
