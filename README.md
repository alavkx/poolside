# Release Notes Generator

A powerful tool to generate customer-focused release notes from GitHub PRs and JIRA tickets across multiple repositories. Features AI-powered content generation, comprehensive progress tracking, and structured markdown output with table of contents.

## ✨ Features

- **Multi-Repository Support**: Generate consolidated release notes across multiple repositories
- **Configuration-Driven**: Use JSON config files to define repositories, categories, and settings
- **AI-Powered Content**: Transform technical changes into customer-focused release notes
- **Progress Tracking**: Real-time feedback showing processing progress across all repositories
- **JIRA Integration**: Automatically link and include JIRA ticket information
- **Structured Output**: Generate release notes with table of contents, summaries, and statistics
- **Flexible Categorization**: Customize how changes are categorized per repository
- **Enhanced Token Limits**: Support for larger models and increased processing capacity

## 🚀 Quick Start

### 1. Installation

```bash
git clone <repository-url>
cd release-notes-generator
npm install
```

### 2. Environment Setup

Copy the example environment file and configure your credentials:

```bash
cp env.example .env
```

Edit `.env` with your credentials:

```env
# Required
GITHUB_TOKEN=ghp_your_github_token_here
OPENAI_API_KEY=sk-your_openai_api_key_here

# Optional (for JIRA integration)
JIRA_HOST=your-company.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_PASSWORD=your_jira_token_or_password
```

### 3. Create Configuration

Initialize a configuration file:

```bash
npm start init-config -o my-config.json
```

Or copy the example:

```bash
cp config.example.json my-config.json
```

### 4. Configure Repositories

Edit `my-config.json` to define your repositories:

```json
{
  "releaseConfig": {
    "month": "2024-01",
    "outputFile": "release-notes.md",
    "title": "Platform Release Notes",
    "description": "Comprehensive updates across all our products",
    "includeTableOfContents": true,
    "includeSummary": true
  },
  "aiConfig": {
    "maxTokens": 8000,
    "batchSize": 3,
    "model": "gpt-4o"
  },
  "repositories": [
    {
      "name": "Core API",
      "repo": "company/core-api",
      "description": "Backend services and APIs",
      "priority": 1,
      "includeInSummary": true,
      "categories": {
        "features": "New API Endpoints & Capabilities",
        "improvements": "Performance & Reliability Updates",
        "bugs": "Critical Fixes & Stability"
      }
    }
  ]
}
```

### 5. Generate Release Notes

```bash
npm start generate -c my-config.json
```

## 📋 Configuration Reference

### Release Configuration

```json
{
  "releaseConfig": {
    "month": "2024-01", // Target month (YYYY-MM)
    "outputFile": "release-notes.md", // Output file path
    "title": "Release Notes", // Main title
    "description": "Release description", // Subtitle/description
    "includeTableOfContents": true, // Generate TOC
    "includeSummary": true // Include executive summary
  }
}
```

### AI Configuration

```json
{
  "aiConfig": {
    "maxTokens": 8000, // Token limit per request
    "batchSize": 3, // PRs processed per batch
    "model": "gpt-4o" // OpenAI model to use
  }
}
```

**Recommended Models:**

- `gpt-4o`: Best quality, higher cost
- `gpt-4o-mini`: Good balance of quality and cost
- `gpt-3.5-turbo`: Faster, lower cost

### Repository Configuration

```json
{
  "name": "Display Name", // Human-readable name
  "repo": "owner/repository", // GitHub repository
  "description": "Repository description", // Optional description
  "priority": 1, // Display order (lower = first)
  "includeInSummary": true, // Include in executive summary
  "categories": {
    // Custom category titles
    "features": "New Features",
    "improvements": "Enhancements",
    "bugs": "Bug Fixes"
  }
}
```

### JIRA Configuration

```json
{
  "jiraConfig": {
    "enabled": true, // Enable JIRA integration
    "baseUrl": "https://company.atlassian.net", // Override env var
    "priorityMapping": {
      // Priority emoji mapping
      "Critical": "🔴",
      "High": "🟠",
      "Medium": "🟡",
      "Low": "🟢"
    }
  }
}
```

## 🔧 Command Line Interface

### Primary Commands

```bash
# Generate multi-repo release notes
npm start generate -c config.json

# Override configuration options
npm start generate -c config.json -m 2024-02 -o february-notes.md

# Enable verbose logging for debugging
npm start generate -c config.json --verbose
```

### Utility Commands

```bash
# Check environment configuration
npm start check-config

# Initialize new configuration file
npm start init-config -o my-config.json

# Set up JIRA Personal Access Token
npm start setup-jira-pat

# Generate single repository (legacy mode)
npm start generate-single -r owner/repo -m 2024-01
```

## 📊 Output Structure

The generated release notes include:

1. **Header**: Title, date, and overview statistics
2. **Executive Summary**: High-level highlights across all repositories
3. **Table of Contents**: Navigation links to all sections
4. **Repository Sections**: Detailed changes organized by repository and category
5. **Statistics**: Processing metrics and breakdown tables

### Example Output Structure

```markdown
# Platform Release Notes - January 2024

**Release Date:** February 1st, 2024
**Repositories:** 4
**Total Changes:** 47 pull requests

## 🎯 This Month's Highlights

We're excited to share 12 new features and capabilities, 18 enhancements and optimizations, 8 fixes and stability improvements designed to improve your experience.

## 📚 Table of Contents

- [🎯 This Month's Highlights](#-this-months-highlights)
- [📦 Core API](#-core-api)
  - [✨ New Features](#-new-features)
  - [🚀 Improvements](#-improvements)

## 📦 Core API

Backend services and APIs • **15** pull requests processed • **8** JIRA tickets linked

### ✨ New API Endpoints & Capabilities

New functionality and capabilities:

- Enhanced user authentication with multi-factor support
- New GraphQL endpoints for real-time data queries
```

## 🔄 Migration from Single-Repo

If you're currently using the single-repository mode:

1. **Create a configuration file**:

   ```bash
   npm start init-config -o config.json
   ```

2. **Update the repositories section** with your current repo:

   ```json
   {
     "repositories": [
       {
         "name": "My Project",
         "repo": "owner/repository",
         "priority": 1,
         "includeInSummary": true
       }
     ]
   }
   ```

3. **Switch to the new command**:

   ```bash
   # Old way
   npm start generate-single -r owner/repo

   # New way
   npm start generate -c config.json
   ```

The legacy `generate-single` command will continue to work for backward compatibility.

## 🐛 Troubleshooting

### Common Issues

**"Config file not found"**

- Ensure the config file path is correct
- Use `npm start init-config` to create a template

**"Repository must be in format owner/repo"**

- Check that all repository entries use the correct format
- Example: `"microsoft/vscode"`, not `"vscode"` or `"https://github.com/microsoft/vscode"`

**API Rate Limits**

- GitHub: 5,000 requests/hour for authenticated requests
- OpenAI: Varies by plan and model
- Consider reducing `batchSize` or adding delays

**JIRA Connection Issues**

- Verify JIRA credentials in `.env`
- Use `npm start setup-jira-pat` for Personal Access Token setup
- Check that JIRA_HOST doesn't include `https://`

### Verbose Mode

Enable detailed logging for debugging:

```bash
npm start generate -c config.json --verbose
```

This provides:

- Detailed API request/response information
- Processing progress for each step
- Token usage statistics
- Error details and suggestions

## 🔐 Security

- Store credentials in `.env` file (never commit to version control)
- Use environment variables in production
- Consider using JIRA Personal Access Tokens instead of passwords
- Regularly rotate API keys and tokens

## 📈 Performance Tips

- **Optimize batch size**: Smaller batches (2-3) for better error handling, larger (5-8) for speed
- **Use appropriate models**: `gpt-4o-mini` for most use cases, `gpt-4o` for maximum quality
- **Adjust token limits**: Higher limits for complex repositories, lower for simple ones
- **Filter repositories**: Only include repos with significant changes in your config

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.
