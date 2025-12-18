---
"poolside": minor
---

Add `init changelog` command for easy project scaffolding

**New Features:**

- `poolside init changelog` - scaffolds GitHub Actions workflow for PR changelog summaries
- Interactive Slack integration setup (or `--no-slack` to skip)
- `--dry-run` mode to preview without writing files
- `--force` to overwrite existing workflow

**Improvements:**

- Workflow triggers on merge to main/master (not PR open)
- Extracted init logic into testable module
- Added 13 tests for init-changelog functionality
