import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLISHED_SCOPE_TABLE_SETTINGS} from '../packages/zenstack/published-scope-table-settings.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../app/modular/published-site-bootstrap.js';
import {scopeTableDescriptor,scopeTableName,scopeTableSettingsFromRows}
  from '../packages/zenstack/scope-table-names.mjs';
import {scopeTableSettingsMatch} from '../packages/zenstack/scope-table-names.mjs';

test('published LOC settings resolve Galaxy and Lucus relations without SQL lookups',()=>{
  for(const scope of ['admin','loc','lo3rwang','lrunes']){
    assert.equal(scopeTableName(scope,'galaxy'),scope+'_galaxy');
    assert.equal(scopeTableName(scope,'lucus'),scope+'_lucus');
  }
  assert.deepEqual(PUBLISHED_SITE_BOOTSTRAP.scope_tables,
    PUBLISHED_SCOPE_TABLE_SETTINGS);
});

test('table descriptors identify configured relations and reject unrelated tables',()=>{
  assert.deepEqual(scopeTableDescriptor('loc_galaxy'),{scope:'loc',kind:'galaxy'});
  assert.deepEqual(scopeTableDescriptor('lo3rwang_lucus'),{scope:'lo3rwang',kind:'lucus'});
  assert.equal(scopeTableDescriptor('loc_anchor'),null);
  assert.equal(scopeTableDescriptor('public.loc_lucus'),null);
});

test('published api.manage rows select custom table suffixes as a static snapshot',()=>{
  const settings=scopeTableSettingsFromRows([
    {id:'customscope',galaxy_table:'archive_galaxy',lucus_table:'chronicle'}
  ]);
  assert.equal(scopeTableName('customscope','galaxy',settings.customscope),
    'customscope_archive_galaxy');
  assert.equal(scopeTableName('customscope','lucus',settings.customscope),
    'customscope_chronicle');
  assert.deepEqual(scopeTableDescriptor('customscope_chronicle',settings),
    {scope:'customscope',kind:'lucus'});
  assert.equal(scopeTableSettingsMatch('lo3rwang','lucus',
    PUBLISHED_SCOPE_TABLE_SETTINGS.lo3rwang),true);
  assert.equal(scopeTableSettingsMatch('customscope','lucus',settings.customscope),false);
  assert.equal(scopeTableSettingsMatch('customscope','lucus',
    {lucus_table:'different'}),false);
  assert.throws(()=>scopeTableSettingsFromRows([
    {id:'customscope',lucus_table:'x; drop table silver.loc'}
  ]),/Invalid LOC lucus table suffix/);
});
