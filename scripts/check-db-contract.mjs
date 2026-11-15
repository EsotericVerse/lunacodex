import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
import {scopeConfigColumns,scopeFeatureColumns,scopeFeaturePatch} from '../app/loc/scope-config-fields.mjs';
import {schema as zmodel} from '../packages/zenstack/schema.mjs';
import {ANCHOR_TYPE_GROUPS,ANCHOR_TYPE_PROJECTIONS,ANCHOR_GROUP_GALAXY_FIELDS,
  PERSISTED_ANCHOR_TYPES} from '../packages/zenstack/anchor-hierarchy.mjs';
import {GALAXY_READ_MODEL_FIELDS,galaxyReadColumns,composeGalaxyRead} from '../packages/zenstack/galaxy-read-models.mjs';
import {galaxyInterNetEdges} from '../packages/zenstack/galaxy-inter-net.mjs';
import {anchorInterNetChildren,sourceInterNetSelection} from '../packages/zenstack/anchor-inter-net.mjs';
import {sourceTaxonomyFromAnchors} from '../app/loc/source-classification.mjs';
import {isLocBlockPage,LOC_BLOCK_ANCHOR_FIELDS} from '../app/loc/loc-block-anchor.mjs';

const read=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const databaseContract='app/loc/db-contract.mjs';
const databaseClient='app/loc/db-client.mjs';

function functionsIn(source){
  return parse(source,{sourceType:'module'}).program.body
    .map(node=>node.type==='ExportNamedDeclaration'?node.declaration:node)
    .filter(node=>node?.type==='FunctionDeclaration');
}
export function checkDbContract(contractSource,clientSource){
  const creator=functionsIn(contractSource).find(node=>node.id?.name==='createDatabaseClient');
  if(!creator)throw Error('Missing createDatabaseClient declaration');
  const defined=new Set();
  for(const param of creator.params){
    if(param.type==='Identifier')defined.add(param.name);
    else if(param.type==='ObjectPattern')
      for(const prop of param.properties)
        if(prop.type==='ObjectProperty'&&prop.value.type==='Identifier')defined.add(prop.value.name);
  }
  for(const node of creator.body.body){
    if(node.type==='FunctionDeclaration'&&node.id)defined.add(node.id.name);
    if(node.type==='VariableDeclaration')
      for(const declarator of node.declarations)
        if(declarator.id.type==='Identifier')defined.add(declarator.id.name);
  }
  const returned=creator.body.body.findLast(node=>node.type==='ReturnStatement')?.argument;
  if(!returned||returned.type!=='ObjectExpression')
    throw Error('Database contract must return an object');
  const exported=returned.properties.map(prop=>{
    if(prop.type!=='ObjectProperty'||prop.computed||prop.key.type!=='Identifier'||prop.value.type!=='Identifier')
      throw Error('Database contract exports must use static identifier references');
    return {name:prop.key.name,ref:prop.value.name};
  });
  const absent=exported.filter(item=>!defined.has(item.ref)).map(item=>item.name);
  if(absent.length)throw Error('DB contract exports undeclared bindings: '+absent.join(', '));
  const clientAst=parse(clientSource,{sourceType:'module'});
  const destructured=[];
  for(const node of clientAst.program.body){
    const decl=node.type==='ExportNamedDeclaration'?node.declaration:node;
    if(decl?.type!=='VariableDeclaration')continue;
    for(const binding of decl.declarations){
      if(binding.init?.type!=='Identifier'||binding.init.name!=='client'||binding.id.type!=='ObjectPattern')continue;
      for(const prop of binding.id.properties)
        if(prop.type==='ObjectProperty'&&prop.key.type==='Identifier')destructured.push(prop.key.name);
    }
  }
  const names=new Set(exported.map(item=>item.name));
  const missing=destructured.filter(name=>!names.has(name));
  if(missing.length)throw Error('DB client expects missing contract exports: '+missing.join(', '));
  return {exported:exported.length,consumed:destructured.length};
}


export function checkLocScopeBoundary(){
  if(scopeConfigColumns('loc')!=='id,display_name,locale'||
      scopeFeatureColumns('loc')!==''||
      Object.keys(scopeFeaturePatch('loc',{search_able:false,statistics_able:false,culture_able:false})).length)
    throw Error('LOC group config must not inherit Scope theme, search, or feature switches');
  return true;
}


// Build-time hard stop: neither production nor transitive dependency graph may
// reinstall a Supabase or Clerk SDK. Native LOC Auth and Kysely remain separate.
export function checkProhibitedVendorDependencies(packageJson,lockJson){
  const pkg=JSON.parse(packageJson),lock=JSON.parse(lockJson);
  const bad=name=>/^(?:@supabase\/|@clerk\/|supabase(?:-|$)|clerk(?:-|$))/i.test(name);
  const declared=Object.entries(pkg)
    .filter(([section])=>['dependencies','devDependencies','optionalDependencies','peerDependencies'].includes(section))
    .flatMap(([,dependencies])=>Object.keys(dependencies||{})).filter(bad);
  const installed=Object.keys(lock.packages||{})
    .filter(path=>/^(?:node_modules\/)(?:@supabase\/|@clerk\/|supabase(?:-|$)|clerk(?:-|$))/i.test(path));
  if(declared.length||installed.length)
    throw Error('Forbidden vendor Auth/Data SDK dependencies: '+[...declared,...installed].join(', '));
  return {declared:0,installed:0};
}


// Validate the EXISTING five semantic ZModel groups against the frozen physical
// schema once at build time. No runtime client, database call, migration, or
// second field registry is created. Changing a semantic projection without
// updating its physical SQL carrier must fail before deployment.
export function checkZModelSemanticContract(){
  const {models,typeDefs,enums}=zmodel;
  const galaxies=[models.Lo3rwangGalaxy,models.LrunesGalaxy];
  if(galaxies.some(model=>!model?.fields))
    throw Error('Missing physical Galaxy ZModels');
  for(const [name,fields] of Object.entries(GALAXY_READ_MODEL_FIELDS)){
    const declared=typeDefs[name]?.fields;
    if(!declared||Object.keys(declared).length!==Object.keys(fields).length)
      throw Error('Missing Galaxy projection '+name);
    for(const [field,spec] of Object.entries(fields)){
      if(declared[field]?.type!==spec.type||
          Boolean(declared[field]?.array)!==Boolean(spec.array)||
          Boolean(declared[field]?.optional)!==Boolean(spec.optional))
        throw Error('Galaxy ZModel projection drift: '+name+'.'+field);
      // A nested brick is a value type, not an actual SQL column.
      if(Object.hasOwn(GALAXY_READ_MODEL_FIELDS,spec.type))continue;
      if(galaxies.some(model=>model.fields[field]?.type!==spec.type||
          Boolean(model.fields[field]?.array)!==Boolean(spec.array)))
        throw Error('Missing physical Galaxy carrier: '+name+'.'+field);
    }
    const columns=galaxyReadColumns(name);
    if(new Set(columns).size!==columns.length||
       columns.some(column=>galaxies.some(model=>!model.fields[column])))
      throw Error('Invalid composed Galaxy SQL projection: '+name);
  }
  if(typeDefs.GalaxyList.fields.attr?.type!=='GalaxyAttr'||
     typeDefs.GalaxyUidRead.fields.relation?.type!=='GalaxyUidRelation'||
     typeDefs.GalaxyUidRead.fields.anchor?.type!=='GalaxyUidAnchor')
    throw Error('Galaxy ZModel composition must remain nested');
  // End-to-end semantics of flat SQL transport -> nested Galaxy bricks:
  // importing a richer view must never duplicate its scalar SQL fields.
  const sample={
    uid:'ABCd1234',title:'sample',content:'article',site:'Suno',
    statics:true,search:false,source_id:'LINK1234',
    target_id:['NEXT1234'],ref_id:null,media_link:['MEDIA123'],
    place_id:'PLACE123',location:'Taipei',date:'2026-11-15'
  };
  const list=composeGalaxyRead('GalaxyList',sample);
  const read=composeGalaxyRead('GalaxyUidRead',sample);
  if(list.attr?.statics!==true||list.attr?.search!==false||
     Object.hasOwn(list,'statics')||Object.hasOwn(read,'media_link')||
     read.relation?.source_id!=='LINK1234'||
     read.relation?.target_id?.[0]!=='NEXT1234'||
     read.anchor?.media_link?.[0]!=='MEDIA123'||
     read.anchor?.site!=='Suno'||read.anchor?.date!=='2026-11-15'||
     Object.hasOwn(read.relation,'uid')||
     galaxyReadColumns('GalaxyList').includes('attr')||
     galaxyReadColumns('GalaxyUidRead').includes('relation')||
     galaxyReadColumns('GalaxyUidRead').includes('anchor'))
    throw Error('Galaxy ZModel nested composition regression');
  // A graph is a projection of confirmed or explicitly unresolved *existing*
  // references, never an implicit JOIN. The user opens each branch on demand.
  const sampleGraph=galaxyInterNetEdges({
    uid:'ARTICLE1',title:'Article',source_id:'SOURCE01',
    target_id:['NEXT0001','NEXT0001','ARTICLE1'],ref_id:'REF00001',
    media_link:['MEDIA001','HIDDEN01'],place_id:'PLACE001',
    date:'2026-11-15',location:'Taipei',site:'Suno'
  },{
    media:[{uid:'MEDIA001',title:'Song',type:'suno'}],
    place:{uid:'PLACE001',title:'Location'}
  });
  if(sampleGraph.branches.relation.length!==3||
     sampleGraph.branches.media.length!==2||
     sampleGraph.branches.media[0].resolved!==true||
     sampleGraph.branches.media[1].resolved!==null||
     sampleGraph.branches.space.length!==2||
     sampleGraph.branches.time[0]?.value!=='2026-11-15'||
     sampleGraph.branches.source[0]?.value!=='Suno')
    throw Error('Galaxy Inter-Net typed branch projection regression');
  const externalGraph=galaxyInterNetEdges({
    uid:'ARTICLE1',source_id:'SOURCE01',media_link:['MEDIA001'],
    place_id:'PLACE001',date:'2026-11-15',site:'Suno'
  },{federated:true});
  if(externalGraph.branches.media.length||
     externalGraph.branches.space.length||
     externalGraph.branches.time.length||
     externalGraph.branches.relation.length!==1)
    throw Error('Federated Galaxy Inter-Net linked an unqualified Anchor');
  // The second-level graph composes existing source/time/space hierarchies,
  // with no new field registry or invented relation inferred from a title.
  const eraChildren=anchorInterNetChildren({
    uid:'ABCDEFG1',type:'era',attr:{period:['ABCDEFG2']}
  },'time');
  const pathChildren=anchorInterNetChildren({
    uid:'ABCDEFG3',type:'path',attr:{point:['ABCDEFG4']}
  },'space');
  if(eraChildren.length!==1||eraChildren[0].type!=='period'||
     eraChildren[0].resolved!==false||
     pathChildren.length!==1||pathChildren[0].type!=='point')
    throw Error('Anchor Inter-Net typed hierarchy regression');
  const sourceRows=[
    {uid:'SRCROOT1',type:'universe',title:'Mutlimedia',
      invisible:false,attr:{uid:['SRCGAL01']}},
    {uid:'SRCGAL01',type:'galaxy',title:'Stream',
      invisible:false,attr:{uid:['SRCDOM01']}},
    {uid:'SRCDOM01',type:'domain',title:'Music',
      invisible:false,attr:{uid:['SRCFROM1']}},
    {uid:'SRCFROM1',type:'from',title:'Suno',invisible:false,attr:{uid:[]}}
  ];
  const taxonomy=sourceTaxonomyFromAnchors(sourceRows);
  const source=sourceInterNetSelection('Suno',taxonomy);
  const missing=sourceInterNetSelection('unknown',taxonomy);
  if(source.status!=='resolved'||source.path.length!==4||
     source.path.at(-1).uid!=='SRCFROM1'||
     source.tree.length!==4||missing.status!=='unmatched')
    throw Error('Source Inter-Net UID-only branch regression');
  const enumTypes=new Set(Object.keys(enums.LocAnchorType?.values||{}));
  const types=Object.keys(ANCHOR_TYPE_PROJECTIONS);
  if(types.length!==PERSISTED_ANCHOR_TYPES.length||
    enumTypes.size!==types.length||types.some(type=>!enumTypes.has(type)))
    throw Error('LOC Anchor discriminator enum is out of sync');
  const families=Object.keys(ANCHOR_TYPE_GROUPS);
  if(families.length!==5)throw Error('Missing LOC semantic Anchor family');
  for(const [type,projection] of Object.entries(ANCHOR_TYPE_PROJECTIONS)){
    const group=typeDefs[projection.modelName]?.fields;
    if(!group||!typeDefs[projection.payloadModelName]||
       group[projection.groupField]?.type!==projection.payloadModelName||
       !ANCHOR_TYPE_GROUPS[projection.group]?.includes(type)||
       isLocBlockPage(type))
      throw Error('Invalid semantic Anchor/LOC Block boundary: '+type);
  }
  for(const [family,columns] of Object.entries(ANCHOR_GROUP_GALAXY_FIELDS)){
    if(!ANCHOR_TYPE_GROUPS[family]||
       columns.some(column=>galaxies.some(model=>!model.fields[column])))
      throw Error('Missing Galaxy Anchor carrier: '+family);
  }
  if(LOC_BLOCK_ANCHOR_FIELDS.some(column=>!models.LocAnchor?.fields[column])||
    !typeDefs.LocBlocks?.fields||
    !isLocBlockPage('index')||!isLocBlockPage('governance'))
    throw Error('LOC Block Anchor projection is out of sync');
  const rune=typeDefs.LRunes66?.fields;
  const physicalRunes=models.Runes?.fields;
  if(!rune||!physicalRunes||
     Object.keys(rune).length!==Object.keys(physicalRunes).length||
     Object.entries(rune).some(([key,field])=>
       physicalRunes[key]?.type!==field.type||
       Boolean(physicalRunes[key]?.array)!==Boolean(field.array)))
    throw Error('LRunes66 projection differs from the physical Runes ZModel');
  return {families:families.length,anchorTypes:types.length,
    galaxyModels:Object.keys(GALAXY_READ_MODEL_FIELDS).length,
    runeColumns:Object.keys(rune).length};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  checkProhibitedVendorDependencies(read('package.json'),read('package-lock.json'));
  const semantic=checkZModelSemanticContract();
  const result=checkDbContract(read(databaseContract),read(databaseClient));
  checkLocScopeBoundary();
  console.log('DB contract OK: '+result.exported+' exports, '+result.consumed+' consumers; LOC scope boundary validated; ZModel '+semantic.families+' families / '+semantic.anchorTypes+' Anchors / '+semantic.galaxyModels+' Galaxy readers / '+semantic.runeColumns+' rune columns.');
}
