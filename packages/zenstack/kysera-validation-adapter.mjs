// Adapted from the MIT-licensed Kysera repository adapter:
// kysera-dev/kysera/packages/repository/src/validation-adapter.ts
// (https://github.com/kysera-dev/kysera).  LOC keeps only the Zod safeParse
// path because ZModel already supplies the schemas; no Kysera package is
// installed or hidden behind this adapter.

function filterSymbols(path){
  return (Array.isArray(path)?path:[]).filter(value=>
    typeof value==='string'||typeof value==='number');
}

/**
 * Kysera's ValidationSchema shape, reduced to the Zod path used by LOC.
 * Keeping parse/safeParse together lets all ZModel result checks report a
 * stable field path without exposing the full database row in an error.
 */
export function zodValidationAdapter(schema){
  if(!schema||typeof schema.parse!=='function'||
    typeof schema.safeParse!=='function')
    throw new TypeError('A Zod-compatible validation schema is required');
  const adapter={
    parse(value){return schema.parse(value)},
    safeParse(value){
      const result=schema.safeParse(value);
      if(result.success)return {success:true,data:result.data};
      return {success:false,error:{
        message:result.error?.message||'Validation failed',
        issues:(result.error?.issues||[]).map(issue=>({
          code:issue.code||'custom',message:issue.message||'Invalid value',
          path:filterSymbols(issue.path)
        }))
      }};
    }
  };
  if(typeof schema.partial==='function')
    adapter.partial=()=>zodValidationAdapter(schema.partial());
  return adapter;
}
