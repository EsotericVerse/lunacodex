import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateLocKyselyTypes} from '../app/loc/providers/kysely-codegen.mjs';

const root=dirname(fileURLToPath(import.meta.url));

const outDir=join(root,'../app/loc/generated/kysely');
await mkdir(outDir,{recursive:true});
for(const name of ['postgres','mysql','mssql']){
  const output=generateLocKyselyTypes(name);
  await writeFile(join(outDir,`${name}.d.ts`),
    `// LOC physical contract → kysely-codegen 0.20.0 (${name})\n${output}`);
}
