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
    # The owner explicitly approved GitHub Pages auto-deploys on main.
    # No other workflow may gain an automatic trigger.
    approved_main_push = false
    if File.basename(file) == 'deploy-pages.yml' && events.sort == ['push', 'workflow_dispatch']
      on_node = triggers.first
      if on_node.is_a?(Psych::Nodes::Mapping)
        on_entries = on_node.children.each_slice(2).to_a
        push_node = on_entries.find { |key, _| key.is_a?(Psych::Nodes::Scalar) && key.value == 'push' }&.last
        if push_node.is_a?(Psych::Nodes::Mapping)
          push_entries = push_node.children.each_slice(2).to_a
          # push may carry branches: [main] and, optionally, paths-ignore
          # (owner-approved: skip the deploy build when a push changes only
          # docs/skill/hook paths, matching the Cloudflare Pages ignore list).
          # Any other key is rejected, so no new automatic trigger can slip in.
          has_main_branches = false
          only_allowed_keys = !push_entries.empty?
          push_entries.each do |key, value|
            unless key.is_a?(Psych::Nodes::Scalar)
              only_allowed_keys = false
              next
            end
            case key.value
            when 'branches'
              has_main_branches = value.is_a?(Psych::Nodes::Sequence) &&
                value.children.size == 1 &&
                value.children.first.is_a?(Psych::Nodes::Scalar) &&
                value.children.first.value == 'main'
            when 'paths-ignore'
              only_allowed_keys &&= value.is_a?(Psych::Nodes::Sequence) &&
                !value.children.empty? &&
                value.children.all? { |child| child.is_a?(Psych::Nodes::Scalar) }
            else
              only_allowed_keys = false
            end
          end
          approved_main_push = has_main_branches && only_allowed_keys
        end
      end
    end
    raise 'only workflow_dispatch is permitted (except deploy-pages.yml push to main)' unless events == ['workflow_dispatch'] || approved_main_push
  rescue Psych::Exception, StandardError => e
    errors << "#{file}: #{e.message}"
  end
end
if errors.any?
  errors.each { |error| warn "::error::#{error}" }
  exit 1
end
puts "Workflow guard: #{files.length} workflows verified (only deploy-pages.yml may auto-run on main)."
