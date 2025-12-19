# poolside

## 0.7.0

### Minor Changes

- Smart model auto-detection based on available API keys

  **New Features:**

  - Auto-detect which AI provider to use when no explicit model/preset is configured
  - Only Anthropic key available → automatically uses Claude (quality preset)
  - Only OpenAI key available → uses GPT-4o (balanced preset)
  - Both keys available → defaults to balanced preset (existing behavior)

  **Improvements:**

  - Prevents confusing "POOLSIDE_OPENAI_API_KEY required" errors when only Anthropic is configured
  - Better out-of-box experience for users with a single provider

  **Technical:**

  - Added comprehensive test suite for model resolution logic

## 0.6.0

### Minor Changes

- 8c2fcc1: Add `init changelog` command for easy project scaffolding

  **New Features:**

  - `poolside init changelog` - scaffolds GitHub Actions workflow for PR changelog summaries
  - Interactive Slack integration setup (or `--no-slack` to skip)
  - `--dry-run` mode to preview without writing files
  - `--force` to overwrite existing workflow

  **Improvements:**

  - Workflow triggers on merge to main/master (not PR open)
  - Extracted init logic into testable module
  - Added 13 tests for init-changelog functionality

## 0.5.1

### Patch Changes

- Rename "What's the Diff" to "Changelog"

  **Changes:**

  - Renamed CLI command from `diff` to `changelog` (with `diff` kept as alias)
  - Renamed workflow file from `whats-the-diff.yml` to `changelog.yml`
  - Added installation documentation at `docs/changelog-setup.md`

## 0.5.0

### Minor Changes

- Multi-provider AI support, model presets, diff generator, and Slack integration

  **New Features:**

  - Multi-provider support: Choose between OpenAI and Anthropic AI providers
  - Model presets: Built-in presets (fast, quality, balanced, cheap) for quick model switching
  - Custom presets: Create and manage your own presets via `poolside config add`
  - **Diff generator**: New `poolside diff` command to analyze code changes between commits/branches
  - **Slack integration**: Post diff summaries and notifications directly to Slack channels
  - Configuration management: Persistent config stored in `~/.poolside/config.json`
  - CLI config commands: `poolside config list/use/add/remove`
  - Flexible model resolution: CLI flags > env vars > config file > defaults

  **Configuration Changes:**

  - New `POOLSIDE_AI_PROVIDER` environment variable to select AI provider
  - New `POOLSIDE_ANTHROPIC_API_KEY` for Anthropic/Claude support
  - New `POOLSIDE_PRESET` environment variable for default preset

  **Technical:**

  - New `@ai-sdk/anthropic` dependency for Claude models
  - New `model-config.ts` module with `ConfigManager` class
  - New `diff-generator.ts` for code diff analysis
  - New `slack-client.ts` for Slack API integration
  - Updated AI processor with `createWithPreset()` factory method

## 0.4.0

### Minor Changes

- Add editor persona refinement for release notes

  **New Features:**

  - Add `enableEditorPersona` configuration option to enable/disable editor refinement
  - Add `editorMaxTokens` configuration to control editor AI token usage
  - Implement `refineWithEditorPersona` method for post-processing release notes
  - Add engineering-focused editor prompts with strict factual accuracy guidelines

  **Improvements:**

  - Enhanced release notes generation with AI-powered consolidation and quality improvement
  - Better handling of redundant or low-value release note entries
  - Improved clarity and technical accuracy of generated content
  - Added comprehensive verbose logging for editor persona operations

  **Technical:**

  - New `processEditorRefinement` method for category-specific refinement
  - Custom `buildEditorPrompt` with context-aware engineering guidelines
  - Temperature optimization (0.05) for maximum factual accuracy in editor mode
  - Fallback handling when editor persona fails to maintain reliability

## 0.3.0

### Minor Changes

- Add interactive setup wizard and major workflow improvements

  **New Features:**

  - Interactive setup wizard with comprehensive configuration guidance
  - Repository validation with improved error handling and branch detection
  - Enhanced release notes generation with better branch handling

  **Improvements:**

  - Removed emoji output to follow clean, professional formatting standards
  - Added targetBranch parameter for more flexible PR fetching
  - Enhanced GitHub client with repository validation capabilities
  - Improved markdown generation with cleaner output format
  - Updated CI workflow to use master branch and improved test commands

  **Developer Experience:**

  - Integrated changesets for better version management and release notes
  - Added inquirer for better interactive CLI experiences
  - Enhanced environment configuration with detailed setup instructions
  - Added comprehensive validation and checking commands

  **Technical:**

  - Added optional branch property to RepositoryConfig interface
  - Improved error handling for GitHub repository access
  - Enhanced setup wizard with status analysis and guided configuration
  - Updated dependencies and development tooling

### Patch Changes

- Adopt Changesets for automated versioning and changelog generation. Replace manual versioning scripts with Changesets workflow for better release management and automated publishing.
