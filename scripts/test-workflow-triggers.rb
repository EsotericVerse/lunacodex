require 'minitest/autorun'
require 'tmpdir'
require 'open3'

class WorkflowTriggerTest < Minitest::Test
  GUARD = File.expand_path('check-workflow-triggers.rb', __dir__)
  def check(source, filename: 'test.yml')
    Dir.mktmpdir do |folder|
      path = File.join(folder, filename)
      File.write(path, "name: test\n#{source}\njobs: {}\n")
      _out, _err, status = Open3.capture3('ruby', GUARD, path)
      return status.success?
    end
  end

  def test_allowed_manual_triggers
    assert check("on: workflow_dispatch\n")
    assert check("on: [workflow_dispatch]\n")
    assert check("\"on\": {workflow_dispatch: {}}\n")
    assert check("on:\n  workflow_dispatch:\n")
  end

  def test_every_automatic_event_syntax_is_rejected
    refute check("on: [push]\n")
    refute check("on: push\n")
    refute check("on: {push: {}}\n")
    refute check("on:\n  workflow_dispatch:\n  pull_request:\n")
    refute check("'on': [workflow_dispatch, push]\n")
  end

  def test_only_main_push_is_allowed_for_pages
    approved = "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n"
    assert check(approved, filename: 'deploy-pages.yml')
    refute check(approved)
    refute check(approved, filename: 'publish-loc-rc.yml')
    refute check("on: [push, workflow_dispatch]\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: ['*']\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: [main, dev]\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: [main]\n    tags: ['*']\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: '0 0 * * *'\n", filename: 'deploy-pages.yml')
    # Owner-approved: optional paths-ignore so docs/skill/hook-only pushes skip the deploy.
    assert check("on:\n  push:\n    branches: [main]\n    paths-ignore: ['**/*.md', '.claude/**']\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: [main]\n    paths-ignore: ['**/*.md']\n  workflow_dispatch:\n")
    refute check("on:\n  push:\n    paths-ignore: ['**/*.md']\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
    refute check("on:\n  push:\n    branches: [main]\n    paths: ['app/**']\n  workflow_dispatch:\n", filename: 'deploy-pages.yml')
  end

  def test_ambiguous_documents_are_rejected
    refute check("on: [workflow_dispatch]\non: [push]\n")
    refute check("on: &events [workflow_dispatch]\non: *events\n")
    refute check("jobs: {}\n")
  end
end
