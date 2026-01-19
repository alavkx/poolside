# Poolside CLI

A CLI tool for automating workflows with productivity tools like JIRA and GitHub, designed specifically for coding agents and AI assistants.

## Features

- **Epic Processing**: Automatically find and claim the next available ticket from a JIRA epic
- **AI-Generated Prompts**: Create comprehensive coding prompts for development agents
- **JIRA Integration**: Full support for JIRA APIs with Personal Access Token (PAT) authentication
- **GitHub Integration**: Connect to GitHub repositories for enhanced context
- **Agent-Friendly**: Designed for automated workflows and agent interactions

## Installation

```bash
npm install -g poolside@latest
```

Or run directly with npx:

```bash
npx poolside@latest --help
```

## Quick Start

1. **Run the interactive setup wizard:**

   ```bash
   poolside setup
   ```

   This will prompt you for your credentials and store them in `~/.poolside/config.json`.

2. **Or set credentials directly:**

   ```bash
   poolside config set openaiApiKey sk-your-api-key
   poolside config set jiraHost your-company.atlassian.net
   poolside config set jiraUsername your_username
   poolside config set jiraPassword your_password_or_pat
   poolside config set githubToken ghp_your_github_token
   ```

3. **Test your connections:**

   ```bash
   poolside config test
   ```

4. **Process an epic:**
   ```bash
   poolside process-epic PROJ-123
   ```

## Configuration

Poolside uses a unified configuration system with the following resolution order:

1. **Environment variables** (`POOLSIDE_*`) - Highest priority, for CI/CD
2. **Config file** (`~/.poolside/config.json`) - Primary user config
3. **Default values** - Fallback defaults

### Managing Credentials

```bash
poolside setup              # Interactive setup wizard
poolside config             # View all stored credentials and presets
poolside config show        # Same as 'config' (alias)
poolside config set <k> <v> # Set a credential
poolside config get <key>   # Get a credential value
poolside config test        # Test all connections
```

### Environment Variables (for CI/CD)

If you need to use environment variables (e.g., in CI/CD pipelines), set these:

```bash
export POOLSIDE_OPENAI_API_KEY=sk-your-api-key
export POOLSIDE_JIRA_HOST=your-company.atlassian.net
export POOLSIDE_JIRA_USERNAME=your_username
export POOLSIDE_JIRA_PASSWORD=your_password_or_pat
export POOLSIDE_GITHUB_TOKEN=ghp_your_github_token
```

## Core Workflow

The main workflow (`process-epic`) performs the following steps:

1. **Find the Epic**: Searches for the specified JIRA epic
2. **Get Child Tickets**: Retrieves all tickets linked to the epic
3. **Find Ready Ticket**: Identifies the first ticket with "ready" status (exclusively)
4. **Claim the Ticket**: Adds a comment marking the ticket as claimed
5. **Generate Coding Prompt**: Uses AI to create a comprehensive coding prompt
6. **Save and Output**: Saves the prompt to a temp file and outputs to stdout

## Workflow Types

### Epic Workflow vs Issue Workflow

- **`process-epic`**: Processes an entire epic by finding the next available "ready" ticket within the epic and claiming it. Best for organized epic-based development workflows.

- **`process-issue`**: Processes a specific individual JIRA issue directly. Best for working on specific tickets or when you want to claim a particular issue regardless of epic structure.

## Commands

### Epic and Issue Automation

#### `process-epic <epic-id>`

Process a JIRA epic to claim the next available ticket and generate a coding prompt.

```bash
poolside process-epic PROJ-123 --agent "Cursor Agent" --claimant "Developer Bot"
```

**Options:**

- `-a, --agent <name>`: Name of the agent claiming the ticket (default: "Coding Agent")
- `-c, --claimant <name>`: Name to use when claiming the ticket (defaults to agent name)
- `--dry-run`: Preview changes without actually claiming the ticket
- `--verbose`: Enable verbose logging for debugging

#### `process-issue <issue-id>`

Process a JIRA issue to claim it and generate a coding prompt.

```bash
poolside process-issue PROJ-456 --agent "Cursor Agent" --claimant "Developer Bot"
```

**Options:**

- `-a, --agent <name>`: Name of the agent claiming the issue (default: "Coding Agent")
- `-c, --claimant <name>`: Name to use when claiming the issue (defaults to agent name)
- `--dry-run`: Preview changes without actually claiming the issue
- `--verbose`: Enable verbose logging for debugging

#### `list-epics <project-key>`

List all epics for a JIRA project.

```bash
poolside list-epics PROJ --limit 10
```

**Options:**

- `-l, --limit <number>`: Maximum number of epics to return (default: 20)
- `--verbose`: Enable verbose logging for debugging

#### `epic-status <epic-id>`

Get the status of a JIRA epic and its child tickets.

```bash
poolside epic-status PROJ-123
```

**Options:**

- `--verbose`: Enable verbose logging for debugging

#### `cursor-prompt <epic-id>`

Generate a prompt template for Cursor agents to run the epic workflow.

```bash
poolside cursor-prompt PROJ-123
```

This command outputs a ready-to-use prompt that you can copy and paste into Cursor or other AI agents. The prompt includes:

- Clear instructions on how to run the poolside CLI
- Explanation of what the workflow does
- Step-by-step guidance for implementing tickets
- Important notes about the automation

**Use Cases:**

- Human-in-the-loop workflows with Cursor agents
- Onboarding new team members to the poolside workflow
- Creating consistent instructions for AI assistants

**Note:** This command doesn't connect to JIRA - it's just a template generator.

### Release Notes Generation

#### `generate-release-notes`

Generate release notes for multiple repositories using a configuration file.

```bash
poolside generate-release-notes --config release-config.json
```

**Options:**

- `-c, --config <file>`: Configuration file path (JSON) - **Required**
- `-m, --month <month>`: Override month from config (YYYY-MM format)
- `-o, --output <file>`: Override output file from config
- `--verbose`: Enable verbose logging for debugging

#### `generate-single-repo` (Legacy)

Generate release notes for a single repository (legacy command).

```bash
poolside generate-single-repo --repo owner/repo --month 2024-01
```

**Options:**

- `-r, --repo <repo>`: GitHub repository (owner/repo) - **Required**
- `-m, --month <month>`: Month to generate for (YYYY-MM, default: current month)
- `-o, --output <file>`: Output file (default: "release-notes.md")
- `--jira-base-url <url>`: JIRA base URL (overrides env var)
- `--verbose`: Enable verbose logging for debugging

### Setup and Configuration

#### `setup`

Interactive setup wizard to configure poolside CLI.

```bash
poolside setup
```

This command provides a guided setup experience that:

- Analyzes your current configuration in `~/.poolside/config.json`
- Prompts for missing credentials
- Stores credentials securely in the config file
- Tests connections to verify setup

#### `setup jira-pat`

Set up JIRA Personal Access Token for better security.

```bash
poolside setup jira-pat
```

**Options:**

- `--jira-base-url <url>`: JIRA base URL (overrides env var)

#### `setup release`

Initialize a release notes configuration file.

```bash
poolside setup release
```

**Options:**

- `-o, --output <file>`: Output config file path (default: "release-config.json")

#### `setup changelog`

Add GitHub Actions workflow for AI-powered PR changelog summaries.

```bash
poolside setup changelog
```

**Options:**

- `--no-slack`: Skip Slack integration setup
- `--force`: Overwrite existing workflow file
- `--dry-run`: Preview what would be created without writing files

### Configuration Management

#### `config` / `config show`

Display all credentials and AI presets.

```bash
poolside config
poolside config show  # Same as above
```

#### `config test`

Test connections to JIRA, GitHub, and AI providers.

```bash
poolside config test --verbose
```

**Options:**

- `--verbose`: Enable verbose logging for debugging

#### `config preset list`

List all available AI presets.

```bash
poolside config preset list
```

#### `config preset use <name>`

Switch the active AI preset.

```bash
poolside config preset use fast
```

#### `config preset add <name>`

Add a custom AI preset.

```bash
poolside config preset add my-preset --provider openai --model gpt-4-turbo
```

#### `config preset remove <name>`

Remove a custom AI preset.

```bash
poolside config preset remove my-preset
```

### Credential Keys

Credentials can be set via `poolside config set <key> <value>` or as environment variables:

| Config Key       | Environment Variable          | Required | Description                                     |
| ---------------- | ----------------------------- | -------- | ----------------------------------------------- |
| `openaiApiKey`   | `POOLSIDE_OPENAI_API_KEY`     | Yes†     | OpenAI API key for generating coding prompts    |
| `anthropicApiKey`| `POOLSIDE_ANTHROPIC_API_KEY`  | Yes†     | Anthropic API key (alternative to OpenAI)       |
| `jiraHost`       | `POOLSIDE_JIRA_HOST`          | Yes\*    | JIRA server hostname (without https://)         |
| `jiraUsername`   | `POOLSIDE_JIRA_USERNAME`      | Yes\*    | JIRA username                                   |
| `jiraPassword`   | `POOLSIDE_JIRA_PASSWORD`      | Yes\*    | JIRA password or Personal Access Token          |
| `githubToken`    | `POOLSIDE_GITHUB_TOKEN`       | No\*\*   | GitHub Personal Access Token for release notes  |
| `aiModel`        | `POOLSIDE_AI_MODEL`           | No       | AI model to use (default: gpt-5.2)              |
| `aiMaxTokens`    | `POOLSIDE_AI_MAX_TOKENS`      | No       | Maximum tokens for AI responses (default: 4000) |
| `aiProvider`     | `POOLSIDE_AI_PROVIDER`        | No       | AI provider: "openai" or "anthropic"            |

†At least one AI provider API key is required (OpenAI or Anthropic)
\*Required for epic automation workflows
\*\*Required for release notes generation

## Example Usage

### Basic Epic Processing

```bash
# Process an epic and claim the next available ticket
poolside process-epic PROJ-123

# Use a custom agent name
poolside process-epic PROJ-123 --agent "Claude Agent"

# Use different names for agent and claimant
poolside process-epic PROJ-123 --agent "Cursor Agent" --claimant "John Doe"
```

### Basic Issue Processing

```bash
# Process a single JIRA issue
poolside process-issue PROJ-456

# Use a custom agent name
poolside process-issue PROJ-456 --agent "Claude Agent"

# Use different names for agent and claimant
poolside process-issue PROJ-456 --agent "Cursor Agent" --claimant "John Doe"

# Dry run to preview changes without claiming
poolside process-issue PROJ-456 --dry-run

# Dry run for epic processing (also available)
poolside process-epic PROJ-123 --dry-run
```

### Epic Management

```bash
# List all epics in a project
poolside list-epics PROJ

# Get detailed status of an epic
poolside epic-status PROJ-123

# Generate a prompt template for Cursor agents
poolside cursor-prompt PROJ-123

# Check what tickets are available
poolside epic-status PROJ-123 --verbose
```

### Release Notes Generation

```bash
# Generate release notes for multiple repositories
poolside generate-release-notes --config release-config.json

# Override month and output file
poolside generate-release-notes --config release-config.json --month 2024-01 --output january-release.md

# Legacy single-repo mode
poolside generate-single-repo --repo owner/repository --month 2024-01
```

### Setup and Configuration

```bash
# Interactive setup wizard (recommended)
poolside setup

# Set credentials directly
poolside config set openaiApiKey sk-your-api-key
poolside config set jiraHost your-company.atlassian.net
poolside config set jiraUsername your_username
poolside config set jiraPassword your_password

# View all credentials and presets
poolside config

# Set up JIRA Personal Access Token
poolside setup jira-pat

# Initialize release notes config
poolside setup release

# Add PR changelog workflow
poolside setup changelog

# Test all connections
poolside config test
```

### Output

The `process-epic` command generates:

1. **Console Output**: Progress updates and final prompt
2. **Temp File**: A markdown file with the coding prompt saved to system temp directory
3. **Return Data**: Structured data about the epic, ticket, and generated prompt

Example output:

```
🚀 Processing Epic: PROJ-123
✅ Found epic: Implement user authentication system
✅ Found available ticket: PROJ-124 - Create login form component
✅ Ticket PROJ-124 has been claimed
✅ Coding prompt saved to: /tmp/PROJ-124-prompt.md

📝 Generated Coding Prompt:
============================================================
# Coding Task: Create Login Form Component

## Objective
Create a reusable login form component for the user authentication system...

## Requirements
- Implement form validation
- Handle login errors gracefully
- Support "Remember Me" functionality
- Responsive design for mobile and desktop

## Implementation Guidelines
...
============================================================
```

## Integration with Agents

This tool is specifically designed for integration with coding agents like Cursor AI, GitHub Copilot, or custom AI assistants. The workflow is optimized for:

- **Automated Execution**: All commands can be run without user interaction
- **Structured Output**: Consistent output format for parsing by agents
- **Error Handling**: Comprehensive error reporting for debugging
- **Verbose Logging**: Detailed logging for troubleshooting automated workflows

### Agent Integration Example

```javascript
// Example agent integration
const { execSync } = require("child_process");

try {
  const result = execSync('poolside process-epic PROJ-123 --agent "My Agent"', {
    encoding: "utf8",
  });

  // Parse the output to extract the prompt
  const promptMatch = result.match(
    /📝 Generated Coding Prompt:\n={60}\n([\s\S]*?)\n={60}/
  );
  const prompt = promptMatch ? promptMatch[1] : null;

  if (prompt) {
    // Use the prompt for coding tasks
    console.log("Generated prompt:", prompt);
  }
} catch (error) {
  console.error("Workflow failed:", error.message);
}
```

## Troubleshooting

### Common Issues

1. **JIRA Authentication Failures**

   - Use `poolside setup jira-pat` for more secure authentication
   - Verify JIRA_HOST doesn't include `https://`
   - Check if your JIRA instance requires special permissions

2. **Epic Not Found**

   - Verify the epic key is correct
   - Ensure you have access to the project
   - Check if the issue type is actually "Epic"

3. **No Ready Tickets**

   - No tickets with "ready" status found
   - Use `epic-status` command to check ticket statuses
   - Verify the epic has child tickets with "ready" status

4. **AI Generation Failures**
   - Check OpenAI API key and billing
   - Verify AI model availability
   - Reduce `AI_MAX_TOKENS` if hitting limits

### Debug Mode

Use `--verbose` flag on any command for detailed debugging information:

```bash
poolside process-epic PROJ-123 --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Publishing with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for automated versioning and publishing. The workflow ensures consistent changelogs and proper semantic versioning.

> **For AI Agents/Cursor**: See [`.cursorrules`](./.cursorrules) for the complete step-by-step release process optimized for automated workflows.

### Creating Changes

When you make changes to the codebase, create a changeset to document them:

```bash
npm run changeset
```

This will:

- Ask which type of change you made (patch, minor, major)
- Prompt for a description of the change
- Create a changeset file in `.changeset/`

### Types of Changes

- **Patch** (`0.0.X`): Bug fixes, small improvements
- **Minor** (`0.X.0`): New features, non-breaking changes
- **Major** (`X.0.0`): Breaking changes

### Release Process

Releases are automated via GitHub Actions when changes are merged to `master`:

1. **Automatic PR Creation**: When changesets are detected, a "Version Packages" PR is automatically created
2. **Review and Merge**: Review the generated changelog and version bumps, then merge the PR
3. **Automatic Publishing**: Upon merging, the package is automatically published to npm

### Manual Release (if needed)

If you need to publish manually:

```bash
# 1. Generate version and changelog
npm run version-packages

# 2. Commit the version changes
git add .
git commit -m "Release v0.2.2"

# 3. Publish to npm
npm run release
```

**Note**: Always commit the version changes before publishing. The `version-packages` command updates `package.json`, `CHANGELOG.md`, and removes changeset files - these changes must be committed to maintain a clean git history.

The `npm run release` script will build, test, and use `changeset publish` (not `npm publish`) to safely publish only packages with properly bumped versions.

### Publishing Requirements

- Must have `NPM_TOKEN` configured in GitHub repository secrets
- All tests must pass via CI
- Changes must be documented with changesets

## License

MIT License - see LICENSE file for details.

## GitHub Token Setup

For **release notes generation**, you need a GitHub Personal Access Token with specific permissions. GitHub offers two types of tokens:

### Option 1: Fine-grained Personal Access Tokens (Recommended)

**Fine-grained tokens** provide better security with repository-specific permissions.

#### Setup Steps:

1. **Go to GitHub Settings**: https://github.com/settings/tokens?type=beta
2. **Click "Generate new token"**
3. **Configure the token**:
   - **Expiration**: Set appropriate expiration (90 days recommended)
   - **Resource owner**: Select your organization (e.g., `Istari-digital`)
   - **Repository access**:
     - Select "All repositories" OR choose specific repositories
4. **Set Repository permissions**:
   ```
   ✅ Contents: Read           - Access repository files and metadata
   ✅ Metadata: Read           - Access repository metadata (mandatory)
   ✅ Pull requests: Read      - List and read pull requests (required!)
   ```
5. **Save the token**: `poolside config set githubToken ghp_your_token_here`
6. **Test the token**: `poolside config test`

> **Important**: The "Pull requests: Read" permission is essential for accessing PR data. Without it, you'll get "Resource not accessible by personal access token" errors.

### Option 2: Classic Personal Access Tokens

**Classic tokens** have broader permissions and simpler setup.

#### Required Scopes:

**For Private Repositories:**

```
✅ repo              - Full control of private repositories
✅ read:org          - Read organization membership
```

**For Public Repositories:**

```
✅ public_repo       - Access public repositories
✅ read:org          - Read organization membership
```

#### Setup Steps:

1. **Go to GitHub Settings**: https://github.com/settings/tokens
2. **Click "Generate new token (classic)"**
3. **Set expiration**: 90 days maximum (for security)
4. **Select scopes**:
   - For maximum compatibility: `repo` + `read:org`
   - For public repos only: `public_repo` + `read:org`
5. **Save the token**: `poolside config set githubToken ghp_your_token_here`
6. **Test the token**: `poolside config test`

### Common Token Issues

| Error                                              | Token Type   | Cause                                     | Solution                                      |
| -------------------------------------------------- | ------------ | ----------------------------------------- | --------------------------------------------- |
| `Repository not found`                             | Both         | Missing permissions or wrong repo name    | Add required permissions, verify repository   |
| `Resource not accessible by personal access token` | Fine-grained | Missing "Pull requests: Read" permission  | Add "Pull requests: Read" to repository perms |
| `Access denied`                                    | Classic      | Missing `read:org` for organization repos | Add `read:org` scope                          |
| `Not Found` on public repos                        | Classic      | Token has no repository access            | Add `public_repo` scope minimum               |

### Testing Your Token

After setup, verify your token works:

```bash
poolside config test
```

This will validate:

- ✅ GitHub API connectivity
- ✅ Repository access permissions
- ✅ Pull request read permissions
- ✅ Organization access (if applicable)

## Support

For issues and questions:

- Create an issue on GitHub
- Check the troubleshooting section
- Use `--verbose` flag for detailed error information
