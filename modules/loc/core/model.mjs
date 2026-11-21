// LOC owns the model contract. Adapters translate definitions to physical storage.
const ID=/^[a-z_][a-z0-9_]*$/i;
const TABLE=/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i;
const TYPES=new Set(['text','integer','number','boolean','date','json']);
function assertModel(model){
  if(!model||typeof model!=='object'||!model.fields||!model.table)
    throw new TypeError('A LOC model definition is required');
}
export function defineModel({name,table,fields}){
  if(typeof table!=='string'||!TABLE.test(table))throw new TypeError('Invalid LOC table');
  if(typeof name!=='string'||!ID.test(name))throw new TypeError('Invalid LOC model name');
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length)
    throw new TypeError('LOC model requires fields');
  let primaryKey='';
  const columns={};
  for(const [field,spec] of Object.entries(fields)){
    if(!ID.test(field)||!spec||!TYPES.has(spec.type))
      throw new TypeError('Invalid LOC model field: '+field);
    if(spec.primary){
      if(primaryKey)throw new TypeError('LOC model has multiple primary keys');
      primaryKey=field;
    }
    columns[field]=Object.freeze({
      type:spec.type,required:Boolean(spec.required||spec.primary),
      primary:Boolean(spec.primary),nullable:Boolean(spec.nullable)
    });
  }
  if(!primaryKey)throw new TypeError('LOC model requires a primary key');
  return Object.freeze({name,table,fields:Object.freeze(columns),primaryKey});
}
export function assertField(model,field){
  assertModel(model);
  if(!Object.hasOwn(model.fields,field))
    throw new TypeError('Unknown LOC model field: '+field);
  return field;
}
function valid(type,value){
  if(type==='text'||type==='date')return typeof value==='string';
  if(type==='integer')return Number.isSafeInteger(value);
  if(type==='number')return typeof value==='number'&&Number.isFinite(value);
  if(type==='boolean')return typeof value==='boolean';
  if(type==='json')return value!==undefined&&typeof value==='object';
  return false;
}
export function validateRecord(model,input,{partial=false}={}){
  assertModel(model);
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new TypeError('LOC record must be an object');
  const record=Object.create(null);
  for(const [key,value] of Object.entries(input)){
    const field=model.fields[assertField(model,key)];
    if(value===null){
      if(!field.nullable)throw new TypeError('LOC field cannot be null: '+key);
    }else if(!valid(field.type,value)){
      throw new TypeError('Invalid LOC field value: '+key);
    }
    record[key]=value;
  }
  if(!partial)for(const [key,spec] of Object.entries(model.fields)){
    if(spec.required&&!Object.hasOwn(record,key))
      throw new TypeError('Missing required LOC field: '+key);
  }
  return record;
}
