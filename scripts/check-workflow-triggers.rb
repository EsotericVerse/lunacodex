#!/usr/bin/env ruby
# Inspect parsed YAML structure; grep misses flow-style events such as on: [push].
# Psych comes with Ruby on the Ubuntu runner; no gems or npm dependencies.
require 'psych'

files = ARGV.empty? ? Dir.glob('.github/workflows/*.{yml,yaml}') : ARGV
abort 'No workflow files found' if files.empty?

errors = []
files.sort.each do |file|
  begin
    document = Psych.parse_file(file)
    root = document&.root
    raise 'workflow document must be a mapping' unless root.is_a?(Psych::Nodes::Mapping)

    triggers = root.children.each_slice(2).filter_map do |key, value|
      value if key.is_a?(Psych::Nodes::Scalar) && key.value == 'on'
    end
    raise 'expected exactly one top-level on key' unless triggers.size == 1
    events = case (node = triggers.first)
    when Psych::Nodes::Scalar
      [node.value]
    when Psych::Nodes::Sequence
      node.children.map { |entry| entry.is_a?(Psych::Nodes::Scalar) ? entry.value : nil }
    when Psych::Nodes::Mapping
      raise 'malformed on mapping' if node.children.size.odd?
      node.children.each_slice(2).map { |key, _| key.is_a?(Psych::Nodes::Scalar) ? key.value : nil }
    else
      []
    end
    # GitHub Pages is the sole GitHub Actions workflow allowed to deploy
    # automatically, and ONLY when main receives a push (including PR merge).
    # Branch pushes must never start a deployment. PR Preview is handled
    # separately and must not be mistaken for production.
    if File.basename(file) == 'deploy-pages.yml'
      raise 'GitHub Pages must trigger only on main push' unless events == ['push']
      push_node = triggers.first.children.each_slice(2).find do |key, _|
        key.is_a?(Psych::Nodes::Scalar) && key.value == 'push'
      end&.last
      raise 'GitHub Pages push config must be a mapping' unless push_node.is_a?(Psych::Nodes::Mapping)
      branches = push_node.children.each_slice(2).find do |key, _|
        key.is_a?(Psych::Nodes::Scalar) && key.value == 'branches'
      end&.last
      main_only = branches.is_a?(Psych::Nodes::Sequence) &&
        branches.children.map { |entry| entry.is_a?(Psych::Nodes::Scalar) ? entry.value : nil } == ['main']
      raise 'GitHub Pages must deploy main only (not feature branches)' unless main_only
    else
      raise 'only workflow_dispatch is permitted for this workflow' unless events == ['workflow_dispatch']
    end

  rescue Psych::Exception, StandardError => e
    errors << "#{file}: #{e.message}"
  end
end
if errors.any?
  errors.each { |error| warn "::error::#{error}" }
  exit 1
end
puts "Workflow guard: #{files.length} workflow YAML files valid; GitHub Pages main push + manual-only other workflows verified."
