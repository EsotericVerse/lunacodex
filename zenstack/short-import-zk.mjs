// Extension Queue short-import: ZenStack V3 ZModel query contract + Zod
// payload validation + Kysely's existing portable, transactional SQL writer.
// No ORM side connection, DDL, dynamic grants, extra Queue or migrations.
import {createQuerySchemaFactory} from '@zenstackhq/orm';
import {z} from 'zod';
import {scopedZModelSchema} from './scoped-schema.mjs';
import {galaxyReadColumns} from './galaxy-read-models.mjs';

const UID=/^[0-9A-Za-z]{8}$/;
const SITE_ID=/^gl:[a-f0-9]{64}$/;
const SOURCE=/^https?:\/\//i;
const FLAGS=galaxyReadColumns('GalaxyAttr');
const REQUIRED_FIELDS=['uid','title','content','site','site_id','url','createtime','UpdateTime',...FLAGS];
const LOOKUP_FIELDS=['uid','content','site_id'];
const cache=new Map();

// Validate the exact INSERT shape sent to Kysely, not the public-facing
// full Galaxy model. Existing nullable/generated columns remain untouched.
const shortInsertRow=z.strictObject({
  uid:z.string().regex(UID),
  title:z.string().max(350),
  content:z.string().min(1),
  site:z.enum(['web','mcp']),
  site_id:z.string().regex(SITE_ID),
  url:z.string().max(2048).refine(v=>SOURCE.test(v)),
  createtime:z.string().refine(v=>Number.isFinite(Date.parse(v))),
  UpdateTime:z.string().refine(v=>Number.isFinite(Date.parse(v))),
  ...Object.fromEntries(FLAGS.map(key=>[key,z.boolean()]))
});
const shortInsertBatch=z.array(shortInsertRow).min(1).max(50);
const sources=z.array(z.string().regex(SITE_ID)).min(1).max(50);

function modelContract(scope,engine,namespace){
  // ZenStack V3 cannot target MSSQL. Its ZModel metadata/validation is
  // dialect-independent here; SQL execution stays exclusively with Kysely.
  // Empty MySQL namespace only affects physical table qualification.
  const modelEngine=engine==='mssql'?'postgres':engine;
  const modelNamespace=namespace||'silver';
  const cacheKey=scope+'\u0000'+modelEngine+'\u0000'+modelNamespace;
  let contract=cache.get(cacheKey);
  if(contract)return contract;
  const declared=scopedZModelSchema({
    scopeId:scope,engine:modelEngine,namespace:modelNamespace
  });
  const model=declared.models.Galaxy;
  if(!model)throw new Error('Missing scoped Galaxy ZModel');
  for(const column of [...REQUIRED_FIELDS,...LOOKUP_FIELDS])
    if(!Object.hasOwn(model.fields,column))
      throw new Error('Missing short-import ZModel field: '+column);
  const schema=createQuerySchemaFactory(declared).makeFindManySchema('Galaxy');
  contract={schema,fields:model.fields};
  if(cache.size>=64)cache.delete(cache.keys().next().value);
  cache.set(cacheKey,contract);
  return contract;
}

/** Confirm an actual ZModel-generated findMany schema for this Scope.
 * Kysely will execute the verified plan within its current locked SQL
 * transaction. No independent ZenStack connection may bypass those locks.
 */
export function shortImportLookupPlan({scope,engine='postgres',namespace='silver',ids}){
  const list=sources.parse(ids);
  const {schema}=modelContract(scope,engine,namespace);
  const parsed=schema.safeParse({
    select:{uid:true,content:true,site_id:true},
    where:{site:{in:['web','mcp']},site_id:{in:list}},
    take:list.length*2
  });
  if(!parsed.success)throw new Error('Short-import ZModel lookup rejected');
  const args=parsed.data;
  // Return only the verified operation's required subset; callers cannot
  // add arbitrary filters, joins, columns or table names.
  if(args.where?.site?.in?.length!==2||
     args.where.site_id?.in?.length!==list.length||
     args.take!==list.length*2||
     LOOKUP_FIELDS.some(key=>args.select?.[key]!==true))
    throw new Error('Short-import ZModel lookup mismatch');
  return {
    columns:[...LOOKUP_FIELDS],
    sites:[...args.where.site.in],
    sourceIds:[...args.where.site_id.in],
    limit:args.take
  };
}

/** Check the Kysely INSERT batch against Zod + projected Galaxy ZModel. */
export function shortImportInsertRows({scope,engine='postgres',namespace='silver',rows}){
  modelContract(scope,engine,namespace); // verifies all physical columns
  return shortInsertBatch.parse(rows);
}
