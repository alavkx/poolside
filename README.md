# Agent Workflow CLI

A CLI tool for automating workflows with productivity tools like JIRA and GitHub, designed specifically for coding agents and AI assistants.

## Features

- **Epic Processing**: Automatically find and claim the next available ticket from a JIRA epic
- **AI-Generated Prompts**: Create comprehensive coding prompts for development agents
- **JIRA Integration**: Full support for JIRA APIs with Personal Access Token (PAT) authentication
- **GitHub Integration**: Connect to GitHub repositories for enhanced context
- **Agent-Friendly**: Designed for automated workflows and agent interactions

## Installation

```bash
npm install -g agent-workflow-cli
```

Or run directly with npx:

```bash
npx agent-workflow-cli --help
```

## Quick Start

1. **Initialize environment configuration:**
   ```bash
   agent-workflow init-env
   ```

2. **Edit the `.env` file** with your credentials:
   ```bash
   # OpenAI Configuration (Required)
   OPENAI_API_KEY=your_openai_api_key_here
   AI_MODEL=gpt-4o
   AI_MAX_TOKENS=4000

   # JIRA Configuration (Required)
   JIRA_HOST=your-company.atlassian.net
   JIRA_USERNAME=your_jira_username
   JIRA_PASSWORD=your_jira_password_or_pat

   # GitHub Configuration (Optional)
   GITHUB_TOKEN=your_github_token_here
   ```

3. **Test your connections:**
   ```bash
   agent-workflow test-connections
   ```

4. **Process an epic:**
   ```bash
   agent-workflow process-epic PROJ-123
   ```

## Core Workflow

The main workflow (`process-epic`) performs the following steps:

1. **Find the Epic**: Searches for the specified JIRA epic
2. **Get Child Tickets**: Retrieves all tickets linked to the epic
3. **Find Available Ticket**: Identifies the first unclaimed ticket that:
   - Has no assignee
   - Is not in progress (status)
   - Has no "claimed" comments
4. **Claim the Ticket**: Adds a comment marking the ticket as claimed
5. **Generate Coding Prompt**: Uses AI to create a comprehensive coding prompt
6. **Save and Output**: Saves the prompt to a temp file and outputs to stdout

## Commands

### `process-epic <epic-id>`

Process a JIRA epic to claim the next available ticket and generate a coding prompt.

```bash
agent-workflow process-epic PROJ-123 --agent "Cursor Agent" --claimant "Developer Bot"
```

**Options:**
- `-a, --agent <name>`: Name of the agent claiming the ticket (default: "Coding Agent")
- `-c, --claimant <name>`: Name to use when claiming the ticket (defaults to agent name)
- `--verbose`: Enable verbose logging for debugging

### `list-epics <project-key>`

List all epics for a JIRA project.

```bash
agent-workflow list-epics PROJ --limit 10
```

**Options:**
- `-l, --limit <number>`: Maximum number of epics to return (default: 20)
- `--verbose`: Enable verbose logging for debugging

### `epic-status <epic-id>`

Get the status of a JIRA epic and its child tickets.

```bash
agent-workflow epic-status PROJ-123
```

**Options:**
- `--verbose`: Enable verbose logging for debugging

### `setup-jira-pat`

Set up JIRA Personal Access Token for better security.

```bash
agent-workflow setup-jira-pat
```

**Options:**
- `--jira-base-url <url>`: JIRA base URL (overrides env var)

### `init-env`

Initialize environment configuration file.

```bash
agent-workflow init-env -o .env
```

**Options:**
- `-o, --output <file>`: Output env file path (default: ".env")

### `check-config`

Check current environment configuration.

```bash
agent-workflow check-config
```

### `test-connections`

Test connections to JIRA, GitHub, and OpenAI.

```bash
agent-workflow test-connections --verbose
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for generating coding prompts |
| `JIRA_HOST` | Yes | JIRA server hostname (without https://) |
| `JIRA_USERNAME` | Yes | JIRA username |
| `JIRA_PASSWORD` | Yes | JIRA password or Personal Access Token |
| `GITHUB_TOKEN` | No | GitHub Personal Access Token for enhanced features |
| `AI_MODEL` | No | OpenAI model to use (default: gpt-4o) |
| `AI_MAX_TOKENS` | No | Maximum tokens for AI responses (default: 4000) |

### JIRA Authentication

The tool supports both username/password and Personal Access Token (PAT) authentication:

- **Username/Password**: Traditional JIRA authentication
- **Personal Access Token**: More secure, use `setup-jira-pat` command to configure

For Atlassian Cloud instances, PAT authentication is recommended for better security.

## Example Usage

### Basic Epic Processing

```bash
# Process an epic and claim the next available ticket
agent-workflow process-epic PROJ-123

# Use a custom agent name
agent-workflow process-epic PROJ-123 --agent "Claude Agent"

# Use different names for agent and claimant
agent-workflow process-epic PROJ-123 --agent "Cursor Agent" --claimant "John Doe"
```

### Epic Management

```bash
# List all epics in a project
agent-workflow list-epics PROJ

# Get detailed status of an epic
agent-workflow epic-status PROJ-123

# Check what tickets are available
agent-workflow epic-status PROJ-123 --verbose
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
- **Verbose Logging**: Detailed logging for troubleshooting agent workflows

### Agent Integration Example

```javascript
// Example agent integration
const { execSync } = require('child_process');

try {
  const result = execSync('agent-workflow process-epic PROJ-123 --agent "My Agent"', 
    { encoding: 'utf8' });
  
  // Parse the output to extract the prompt
  const promptMatch = result.match(/📝 Generated Coding Prompt:\n={60}\n([\s\S]*?)\n={60}/);
  const prompt = promptMatch ? promptMatch[1] : null;
  
  if (prompt) {
    // Use the prompt for coding tasks
    console.log('Generated prompt:', prompt);
  }
} catch (error) {
  console.error('Workflow failed:', error.message);
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

3. **No Available Tickets**
   - All tickets may be assigned or in progress
   - Use `epic-status` command to check ticket statuses
   - Verify the epic has child tickets

4. **AI Generation Failures**
   - Check OpenAI API key and billing
   - Verify AI model availability
   - Reduce `AI_MAX_TOKENS` if hitting limits

### Debug Mode

Use `--verbose` flag on any command for detailed debugging information:

```bash
agent-workflow process-epic PROJ-123 --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- Create an issue on GitHub
- Check the troubleshooting section
- Use `--verbose` flag for detailed error information
