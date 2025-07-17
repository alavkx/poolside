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

1. **Initialize environment configuration:**

   ```bash
   poolside init-env
   ```

2. **Edit the `.env` file** with your credentials:

   ```bash
   # OpenAI Configuration (Required)
   POOLSIDE_OPENAI_API_KEY=your_openai_api_key_here
   POOLSIDE_AI_MODEL=gpt-4o
   POOLSIDE_AI_MAX_TOKENS=4000

   # JIRA Configuration (Required for epic automation)
   POOLSIDE_JIRA_HOST=your-company.atlassian.net
   POOLSIDE_JIRA_USERNAME=your_jira_username
   POOLSIDE_JIRA_PASSWORD=your_jira_password_or_pat

   # GitHub Configuration (Optional)
   POOLSIDE_GITHUB_TOKEN=your_github_token_here
   ```

3. **Test your connections:**

   ```bash
   poolside test-connections
   ```

4. **Process an epic:**
   ```bash
   poolside process-epic PROJ-123
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

### `process-epic <epic-id>`

Process a JIRA epic to claim the next available ticket and generate a coding prompt.

```bash
poolside process-epic PROJ-123 --agent "Cursor Agent" --claimant "Developer Bot"
```

**Options:**

- `-a, --agent <name>`: Name of the agent claiming the ticket (default: "Coding Agent")
- `-c, --claimant <name>`: Name to use when claiming the ticket (defaults to agent name)
- `--verbose`: Enable verbose logging for debugging

### `process-issue <issue-id>`

Process a JIRA issue to claim it and generate a coding prompt.

```bash
poolside process-issue PROJ-456 --agent "Cursor Agent" --claimant "Developer Bot"
```

**Options:**

- `-a, --agent <name>`: Name of the agent claiming the issue (default: "Coding Agent")
- `-c, --claimant <name>`: Name to use when claiming the issue (defaults to agent name)
- `--dry-run`: Preview changes without actually claiming the issue
- `--verbose`: Enable verbose logging for debugging

### `list-epics <project-key>`

List all epics for a JIRA project.

```bash
poolside list-epics PROJ --limit 10
```

**Options:**

- `-l, --limit <number>`: Maximum number of epics to return (default: 20)
- `--verbose`: Enable verbose logging for debugging

### `epic-status <epic-id>`

Get the status of a JIRA epic and its child tickets.

```bash
poolside epic-status PROJ-123
```

**Options:**

- `--verbose`: Enable verbose logging for debugging

### `cursor-prompt <epic-id>`

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

### `setup-jira-pat`

Set up JIRA Personal Access Token for better security.

```bash
poolside setup-jira-pat
```

**Options:**

- `--jira-base-url <url>`: JIRA base URL (overrides env var)

### `init-env`

Initialize environment configuration file.

```bash
poolside init-env -o .env
```

**Options:**

- `-o, --output <file>`: Output env file path (default: ".env")

### `check-config`

Check current environment configuration.

```bash
poolside check-config
```

### `test-connections`

Test connections to JIRA, GitHub, and OpenAI.

```bash
poolside test-connections --verbose
```

### Environment Variables

| Variable                  | Required | Description                                        |
| ------------------------- | -------- | -------------------------------------------------- |
| `POOLSIDE_OPENAI_API_KEY` | Yes      | OpenAI API key for generating coding prompts       |
| `POOLSIDE_JIRA_HOST`      | Yes\*    | JIRA server hostname (without https://)            |
| `POOLSIDE_JIRA_USERNAME`  | Yes\*    | JIRA username                                      |
| `POOLSIDE_JIRA_PASSWORD`  | Yes\*    | JIRA password or Personal Access Token             |
| `POOLSIDE_GITHUB_TOKEN`   | No       | GitHub Personal Access Token for enhanced features |
| `POOLSIDE_AI_MODEL`       | No       | OpenAI model to use (default: gpt-4o)              |
| `POOLSIDE_AI_MAX_TOKENS`  | No       | Maximum tokens for AI responses (default: 4000)    |

\*Required for epic automation workflows

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

   - Use `setup-jira-pat` for more secure authentication
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

## Publishing (Maintainers Only)

The package includes several publishing scripts for different scenarios:

### Quick Release (Patch)

For bug fixes and small improvements:

```bash
npm run release
```

This will:

- Build the project
- Run tests
- Run linting
- Bump patch version
- Publish to npm

### Manual Version Control

For more control over versioning:

```bash
# Patch version (2.1.0 → 2.1.1)
npm run publish:patch

# Minor version (2.1.0 → 2.2.0)
npm run publish:minor

# Major version (2.1.0 → 3.0.0)
npm run publish:major

# Beta release (2.1.0 → 2.1.1-beta.0)
npm run publish:beta
```

### Pre-publish Checks

To verify everything is ready for publishing:

```bash
npm run prepublishOnly
```

This runs build, tests, and linting without publishing.

### Publishing Requirements

- Must be authenticated with npm (`npm login`)
- Must have publish permissions for the `poolside` package
- All tests must pass
- Code must pass linting

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

- Create an issue on GitHub
- Check the troubleshooting section
- Use `--verbose` flag for detailed error information
