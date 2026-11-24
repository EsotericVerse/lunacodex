import test from 'node:test';
import assert from 'node:assert/strict';
import {searchRelationGroups,relationGraph} from '../app/modular/search-relation-model.mjs';
test('Search graph connects authorized typed contexts and limits expanded canvas nodes',()=>{
  const row={uid:'AAAA0001',title:'本文',source_id:'AAAA0002',target_id:['AAAA0003'],site:'Facebook',date:'2026-11-24',
    extract:true,links:[{label:'網址',href:'https://example.com'},{href:'javascript:alert(1)'}],
    related_space:{place:{uid:'AAAA0004',title:'車站'},routes:[]},
    related_time:{periods:[{uid:'AAAA0005',title:'期間'}]}};
  const groups=searchRelationGroups(row,5);
  assert.equal(groups.find(g=>g.id==='relation').items.length,2);
  assert.deepEqual(groups.find(g=>g.id==='space').items[0].action.navigation,{place:'AAAA0004'});
  assert.deepEqual(groups.find(g=>g.id==='time').items[1].action.navigation,{from:'2026-11-24',to:'2026-11-24',period:'AAAA0005'});
  assert.equal(groups.find(g=>g.id==='statistics').items[0].action.navigation.statTab,'keywords');
  assert.equal(groups.find(g=>g.id==='url').items.length,1);
  const graph=relationGraph(groups,'relation',row.title);
  assert.equal(graph.nodes.filter(n=>n.kind==='leaf').length,2);
  assert.equal(graph.edges.length,graph.nodes.length-1);
  assert.equal(searchRelationGroups({...row,extract:false}).some(g=>g.id==='url'),false);
  assert.equal(searchRelationGroups({...row,inter_net_federated:true}).some(g=>g.id==='relation'),false);
});
