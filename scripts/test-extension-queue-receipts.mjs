// Regression: run the actual MV3 background script without Chrome or a DB.
// No mocked server acknowledgements are allowed to erase pending Queue rows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../extensions/loc-galaxy-link/background.js',import.meta.url),'utf8');
const listener={addListener(){}};
const chrome={
 runtime:{onInstalled:listener,onStartup:listener,onMessage:listener},
 contextMenus:{onShown:listener,onClicked:listener},
 action:{onClicked:listener},alarms:{onAlarm:listener}
};
const sandbox={chrome,TextEncoder,URL,console};
runInNewContext(source+'\nglobalThis.verifyReceipt=validateArticleReceipts;',sandbox,
 {timeout:3000});
const verify=sandbox.verifyReceipt;
assert.equal(typeof verify,'function');
const a='https://chatgpt.com/c/a',b='https://chatgpt.com/c/b';
const records=[{source_key:a},{source_key:a},{source_key:b}];
const first={source_key:a,uid:'Abc12345',appended:2,duplicate:false};
const second={source_key:b,uid:'Def67890',appended:0,duplicate:true};
assert.doesNotThrow(()=>verify([first,second],records));
assert.doesNotThrow(()=>verify([{...first,appended:0,duplicate:true},second],records));
for(const bad of [
 [first],
 [first,first],
 [first,{...second,source_key:'https://chatgpt.com/c/unknown'}],
 [{...first,uid:'invalid'},second],
 [{...first,appended:3},second],
 [{...first,appended:-1},second],
 [{...first,appended:0},second],
 [{...first,duplicate:true},second],
 [{...first,appended:'2'},second]
])assert.throws(()=>verify(bad,records),/LOC/);
assert.throws(()=>verify([first,second],[{source_key:''}]),/LOC/);
console.log('PASS Extension real background UID receipt contract: exact sources, valid UID, append count, retries');
