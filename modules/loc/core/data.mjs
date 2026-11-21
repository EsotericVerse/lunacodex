import {defineModel,validateRecord} from './model.mjs';
import {compileSelect,compileCount,compileInsert,compileUpdate,compileDelete} from './sql.mjs';

// Database driver and authorization are explicit server-owned dependencies.
export function createDataSystem({execute,dialect='postgres',authorize}={}){
  if(typeof execute!=='function')throw new TypeError('LOC data requires execute()');
  if(typeof authorize!=='function')throw new TypeError('LOC data requires authorize()');
  const models=new Map();
  function requireModel(name){
    const model=models.get(name);
    if(!model)throw new Error('Unknown LOC data model: '+name);
    return model;
  }
  async function query(op,name,options={},context={}){
    const model=requireModel(name);
    const allowed=await authorize({operation:op,model,context});
    if(allowed!==true)throw new Error('LOC data access denied');
    let statement;
    if(op==='select')statement=compileSelect(model,options,dialect);
    else if(op==='count')statement=compileCount(model,options,dialect);
    else if(op==='insert')statement=compileInsert(model,validateRecord(model,options.values),dialect);
    else if(op==='update')statement=compileUpdate(model,validateRecord(model,options.values,{partial:true}),options.where,dialect);
    else if(op==='delete')statement=compileDelete(model,options.where,dialect);
    else throw new TypeError('Unknown LOC data operation');
    return execute(statement,{operation:op,model,context});
  }
  return Object.freeze({
    register(definition){
      const model=defineModel(definition);
      if(models.has(model.name))throw new Error('Duplicate LOC model: '+model.name);
      models.set(model.name,model);
      return model;
    },
    model:requireModel,
    select:(name,options={},context={})=>query('select',name,options,context),
    count:(name,options={},context={})=>query('count',name,options,context),
    insert:(name,values,context={})=>query('insert',name,{values},context),
    update:(name,values,where,context={})=>query('update',name,{values,where},context),
    delete:(name,where,context={})=>query('delete',name,{where},context),
    names(){return [...models.keys()];}
  });
}
