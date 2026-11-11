#!/usr/bin/env ruby
# Inspect parsed YAML structure; grep misses flow-style events such as on: [push].
# Psych comes with Ruby on the Ubuntu runner; no gems or npm dependencies.
require 'psych'

files = ARGV.empty? ? Dir.glob('.github/workflows/*.{yml,yaml}') : ARGV
abort 'No workflow files found' if files.empty?

errors = []
files.sort.each do |file|
  next if File.basename(file) == 'workflow-guard.yml'
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
    # No deployment job may start on branch push, PR merge, or schedule.
    # Cloudflare Pages owns the one automatic main deployment; GitHub
    # Actions workflows remain explicit owner-invoked actions only.
    raise 'only workflow_dispatch is permitted' unless events == ['workflow_dispatch']

  rescue Psych::Exception, StandardError => e
    errors << "#{file}: #{e.message}"
  end
end
if errors.any?
  errors.each { |error| warn "::error::#{error}" }
  exit 1
end
puts "Workflow guard: #{files.length} workflows verified (all deployment workflows manual only)."
