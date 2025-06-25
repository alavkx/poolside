# Release Notes Generator

An intelligent tool that automatically generates customer-facing release notes by analyzing GitHub pull requests and associated JIRA tickets using AI. Perfect for SaaS products that need to communicate monthly releases and feature updates to their users in a clear, value-focused format.

## ✨ Features

- **GitHub Integration**: Fetches PR metadata for any specified month
- **JIRA Integration**: Automatically extracts and links JIRA tickets from PR descriptions
- **AI-Powered Generation**: Uses Vercel AI SDK with OpenAI to create customer-focused release notes
- **Smart Categorization**: Automatically groups changes into New Features, Enhancements, Fixes, and Other Updates
- **Customer-Focused Output**: Generates user-friendly release notes emphasizing product value and benefits
- **SaaS-Ready Format**: Perfect structure for customer communication and product marketing
- **Flexible Configuration**: Works with or without JIRA integration

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- GitHub Personal Access Token
- OpenAI API Key
- JIRA credentials (optional)

> **Note**: This tool generates customer-facing release notes designed for SaaS products. It automatically filters out internal changes and focuses on user value and benefits.

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

### Executive Summary

- Customer-focused highlights of the release
- Count of new features, improvements, and fixes
- Clear value proposition for users

### Categorized Release Notes

- ✨ **New Features & Capabilities**: User-facing feature additions with value explanation
- 🚀 **Enhancements & Improvements**: Performance and usability improvements
- 🔧 **Fixes & Stability Improvements**: Problem resolutions that improve user experience
- 📝 **Additional Updates**: Other customer-relevant changes

### Customer-Focused Benefits

- Emphasizes "what" and "why" from user perspective
- Uses clear, non-technical language
- Filters out internal/infrastructure changes
- Highlights product value and user benefits

## 🛠️ How It Works

1. **Fetch PRs**: Retrieves all merged PRs for the specified month using GitHub API
2. **Extract JIRA Keys**: Scans PR titles and descriptions for JIRA ticket references (e.g., `PROJ-123`)
3. **Fetch JIRA Data**: Retrieves detailed ticket information including summary, type, and status
4. **AI Processing**: Uses GPT-4 to analyze PR and JIRA data, filtering out internal changes and focusing on customer value
5. **Generate Customer-Focused Output**: Creates polished release notes that emphasize user benefits and product improvements
6. **Smart Filtering**: Automatically excludes infrastructure changes, build improvements, and other internal-only updates

## 📝 Example Output

```markdown
# Awesome App - January 2024 Release

**Release Date:** February 1st, 2024

---

## 🎯 This Month's Highlights

We're excited to share **3** new features and capabilities, **2** enhancements to existing functionality, **4** fixes and stability improvements designed to improve your experience and productivity.

## ✨ New Features & Capabilities

Discover what's new and how it can help you:

- Enhanced user authentication with seamless single sign-on support for faster, more secure access
- Added dark mode theme option to reduce eye strain during extended use
- Introduced data export functionality allowing you to download your information in multiple formats

## 🚀 Enhancements & Improvements

We've made these improvements based on your feedback:

- Streamlined dashboard loading times by 40% for a more responsive experience
- Improved search functionality with better filtering and instant results

## 🔧 Fixes & Stability Improvements

We've resolved these issues to ensure a smoother experience:

- Fixed login redirects that occasionally failed on mobile devices
- Resolved intermittent loading issues that could affect data synchronization
- Corrected display formatting problems on smaller screen sizes
- Improved system stability during peak usage periods
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
