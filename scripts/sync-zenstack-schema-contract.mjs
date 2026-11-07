// Mirror the fixed JSON physical-schema snapshot into a Pages/Node-safe ESM
// module. The JSON is the source of truth; no database operation is performed.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const input=new URL('../zenstack/schema-contract.json',import.meta.url);
const output=new URL('../zenstack/schema-contract.mjs',import.meta.url);
const metadata=JSON.parse(readFileSync(input,'utf8'));
const generated="// Generated from schema-contract.json for Cloudflare Pages / Node ESM compatibility.\n"+
 "// Regenerate with: node scripts/sync-zenstack-schema-contract.mjs\n"+
 "// The JSON file remains the single source of truth; no SQL DDL is generated.\n"+
 "export default "+JSON.stringify(metadata)+";\n";
const existing=existsSync(output)?readFileSync(output,'utf8'):'';
if(process.argv.includes('--check')){
 if(existing!==generated)throw Error('Generated ZenStack schema-contract.mjs is stale');
}else if(existing!==generated){
 writeFileSync(output,generated,'utf8');
 console.log('ZenStack schema ESM snapshot refreshed from fixed JSON contract.');
}
