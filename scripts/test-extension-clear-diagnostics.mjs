// Diagnostic cleanup must not mutate the IndexedDB Queue, OAuth credentials
// or retry controls. No Chrome installation, database or network needed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../extensions/loc-galaxy-link/',import.meta.url);
const background=readFileSync(new URL('background.js',root),'utf8');
const options=readFileSync(new URL('options.js',root),'utf8');
const html=readFileSync(new URL('options.html',root),'utf8');
const css=readFileSync(new URL('options.css',root),'utf8');

const caseBody=/case 'loc-clear-diagnostics':\{([\s\S]*?)\n   \}\n   case 'loc-diagnostics':/.exec(background)?.[1];
assert.ok(caseBody,'dedicated Extension diagnostic cleanup action exists');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const clear=new AsyncFunction('sender','chrome','DIAGNOSTIC_KEY',caseBody);
function storage(){
 const rows=new Map([
  ['locDiagnostics',[{at:'2026-11-14T11:50:00Z',event:'import.response'}]],
  ['locLastAction',{message:'HTTP 500'}],
  ['locOAuth',{access_token:'must-survive'}],
  ['locQueueRetryAfter',123456],
  ['locQueueFailures',3],
  ['locImportPaused',true],
  ['locTargetScope','lo3rwang']
 ]);
 const removed=[];
 const chrome={runtime:{id:'extension-test',getURL:p=>'chrome-extension://extension-test/'+p},
  storage:{local:{remove:async keys=>{
    removed.push(...keys);for(const key of keys)rows.delete(key);
  }}}};
 return {chrome,rows,removed};
}
const s=storage();
const sender={id:'extension-test',url:'chrome-extension://extension-test/options.html#activity'};
assert.deepEqual(await clear(sender,s.chrome,'locDiagnostics'),{cleared:true});
assert.deepEqual(s.removed,['locDiagnostics','locLastAction']);
assert.equal(s.rows.has('locDiagnostics'),false);
assert.equal(s.rows.has('locLastAction'),false);
assert.equal(s.rows.get('locOAuth').access_token,'must-survive');
assert.equal(s.rows.get('locQueueRetryAfter'),123456);
assert.equal(s.rows.get('locQueueFailures'),3);
assert.equal(s.rows.get('locImportPaused'),true);
assert.equal(s.rows.get('locTargetScope'),'lo3rwang');
await assert.rejects(clear({id:'extension-test',
 url:'chrome-extension://extension-test/content.html'},s.chrome,'locDiagnostics'),
 /Only Extension settings/);
await assert.rejects(clear({id:'wrong-extension',
 url:'chrome-extension://extension-test/options.html'},s.chrome,'locDiagnostics'),
 /Only Extension settings/);
assert.equal(s.removed.length,2,'untrusted callers cannot clear logs');
assert.match(html,/id="clearDiagnostics"/);
assert.match(options,/\$\('clearDiagnostics'\)\.addEventListener\('click'/);
assert.match(options,/call\('loc-clear-diagnostics'\)/);
assert.match(css,/\.diagnostics-actions/);
assert.match(background,/if\(!response\.ok\|\|method!=='GET'/);
assert.match(background,/MAX_DIAGNOSTICS=120/);
console.log('PASS Extension diagnostics only: cleanup action, trusted sender, unchanged Queue/auth/retry controls and UI');
