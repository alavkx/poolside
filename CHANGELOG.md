# poolside

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
