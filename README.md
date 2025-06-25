# Release Notes Generator

An intelligent tool that automatically generates release notes by analyzing GitHub pull requests and associated JIRA tickets using AI. Perfect for monthly release cycles and maintaining clear project documentation.

## ✨ Features

- **GitHub Integration**: Fetches PR metadata for any specified month
- **JIRA Integration**: Automatically extracts and links JIRA tickets from PR descriptions
- **AI-Powered Generation**: Uses Vercel AI SDK with OpenAI to create human-readable release notes
- **Smart Categorization**: Automatically groups changes into Features, Bug Fixes, Improvements, and Other
- **Comprehensive Output**: Generates detailed markdown with statistics, contributor info, and references
- **Flexible Configuration**: Works with or without JIRA integration

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- GitHub Personal Access Token
- OpenAI API Key
- JIRA credentials (optional)

### Installation

```bash
# Clone or create project
npm install

# Copy environment template
cp env.example .env

# Edit .env with your credentials
```

### Configuration

**Easy Setup:**

```bash
# Copy the example configuration
cp env.example .env

# Check your configuration status
npm start check-config

# Edit .env with your credentials
```

**Required Variables:**

```bash
# Required
GITHUB_TOKEN=ghp_your_github_token_here
OPENAI_API_KEY=sk-your_openai_key_here

# Optional (for JIRA integration)
JIRA_HOST=your-company.atlassian.net
JIRA_USERNAME=your_username
JIRA_PASSWORD=your_api_token
```

The tool will automatically guide you through configuration if any required variables are missing.

### Usage

Generate release notes for the current month:

```bash
npm start generate -r owner/repo-name
```

Generate for a specific month:

```bash
npm start generate -r owner/repo-name -m 2024-01
```

Custom output file:

```bash
npm start generate -r owner/repo-name -o january-2024-release.md
```

Set up JIRA Personal Access Token (recommended for better security):

```bash
npm start setup-jira-pat
```

Check your environment configuration:

```bash
npm start check-config
```

## 🔧 Advanced Configuration

### GitHub Token Setup

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with these scopes:
   - `repo` (for private repos) or `public_repo` (for public repos)
   - `read:user` (to fetch user information)

### JIRA Setup

**🔐 Personal Access Tokens (Recommended)**

For JIRA Server/Data Center (version 8.14+), use Personal Access Tokens for better security:

1. **Automatic Setup**: Run `npm start setup-jira-pat` to create a PAT interactively
2. **Manual Setup**:
   - Go to JIRA → Profile → Personal Access Tokens
   - Create token with desired expiration
   - Update `.env` with `JIRA_PASSWORD=your_pat_token`

**📋 Alternative Authentication Methods**

1. **JIRA Cloud**: Use your email and API token from Atlassian Account Settings
2. **JIRA Server (older versions)**: Use your username and password
3. **Format**: Extract JIRA keys like `PROJ-123` from PR titles/descriptions

**🔧 PAT Benefits** (per [Atlassian documentation](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)):

- Enhanced security (no password exposure)
- Easy revocation if compromised
- Configurable expiration dates
- Bearer token authentication

### OpenAI Configuration

The tool uses GPT-4 Turbo for optimal results. Ensure your OpenAI account has sufficient credits and API access.

## 📊 Output Format

The generated markdown includes:

### Summary Section

- Total PRs, contributors, and code statistics
- Top contributors list
- JIRA tickets linked count

### Categorized Release Notes

- ✨ **New Features**: User-facing feature additions
- 🔧 **Improvements**: Enhancements and optimizations
- 🐛 **Bug Fixes**: Problem resolutions
- 📝 **Other Changes**: Miscellaneous updates

### Detailed Reference

- Complete PR list with links and descriptions
- JIRA tickets reference (when available)
- Contributor and change statistics

## 🛠️ How It Works

1. **Fetch PRs**: Retrieves all merged PRs for the specified month using GitHub API
2. **Extract JIRA Keys**: Scans PR titles and descriptions for JIRA ticket references (e.g., `PROJ-123`)
3. **Fetch JIRA Data**: Retrieves detailed ticket information including summary, type, and status
4. **AI Processing**: Uses GPT-4 to analyze PR and JIRA data, generating user-friendly release notes
5. **Generate Markdown**: Creates a comprehensive markdown document with all information

## 📝 Example Output

```markdown
# Release Notes - January 2024

**Repository:** myorg/awesome-app  
**Generated on:** February 1st, 2024

## 📊 Summary

This release includes **23 pull requests** merged during this period.

### Statistics

- **Total PRs:** 23
- **Contributors:** 8
- **JIRA tickets linked:** 15

## ✨ New Features

- Added user authentication with OAuth2 support
- Implemented dark mode toggle functionality
- Added export functionality for user data

## 🐛 Bug Fixes

- Fixed memory leak in data processing pipeline
- Resolved login redirect issues on mobile devices
```

## 🔍 Troubleshooting

**GitHub API Rate Limits**: The tool respects rate limits. If you hit limits, wait or use a token with higher limits.

**JIRA Connection Issues**:

- Verify JIRA_HOST doesn't include `https://`
- Ensure API token has proper permissions
- Check firewall/VPN restrictions

**AI Generation Errors**:

- Verify OpenAI API key is valid and has credits
- Check internet connectivity
- Large PR sets may take longer to process

**No PRs Found**:

- Verify repository name format (`owner/repo`)
- Check if PRs were merged (not just closed)
- Ensure target month has merged PRs

## 🤝 Contributing

1. Follow functional programming patterns where reasonable
2. Keep code dense but readable - meaningful newlines
3. Comment only exceptional code that needs explanation
4. Test with different repository types and PR patterns

## 📄 License

MIT License - feel free to use and modify for your projects.
