# Changelog - Installation Guide

Automatically analyze PRs and post customer-focused change summaries to Slack using AI.

## Overview

"Changelog" is a GitHub Actions workflow that:

- Triggers on every PR (opened, updated, or marked ready for review)
- Uses AI to analyze code changes
- Generates customer-focused summaries (not developer jargon)
- Optionally posts formatted messages to Slack

## Quick Setup (2 minutes)

### Step 1: Copy the Workflow File

Create `.github/workflows/changelog.yml` in your repository:

```yaml
name: Changelog

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

concurrency:
  group: changelog-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  analyze-diff:
    name: Analyze Changes
    runs-on: ubuntu-latest
    if: github.event.pull_request.draft == false

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Analyze PR diff
        run: |
          npx poolside@latest changelog \
            --range "${{ github.event.pull_request.base.sha }}...${{ github.sha }}" \
            --format text \
            --pr-number "${{ github.event.pull_request.number }}" \
            --pr-url "${{ github.event.pull_request.html_url }}" \
            --title "${{ github.event.pull_request.title }}"
        env:
          POOLSIDE_OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      # Optional: Post to Slack
      - name: Post to Slack
        if: ${{ secrets.SLACK_WEBHOOK_URL != '' }}
        run: |
          npx poolside@latest changelog \
            --range "${{ github.event.pull_request.base.sha }}...${{ github.sha }}" \
            --format slack \
            --slack-webhook "${{ secrets.SLACK_WEBHOOK_URL }}" \
            --pr-number "${{ github.event.pull_request.number }}" \
            --pr-url "${{ github.event.pull_request.html_url }}" \
            --title "${{ github.event.pull_request.title }}"
        env:
          POOLSIDE_OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Step 2: Add Required Secret

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:

| Name             | Value               |
| ---------------- | ------------------- |
| `OPENAI_API_KEY` | Your OpenAI API key |

**Getting an OpenAI API Key:**

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy and save it securely

### Step 3: (Optional) Add Slack Integration

To post summaries to Slack:

1. **Create a Slack App:**

   - Go to [Slack API Apps](https://api.slack.com/apps)
   - Click **Create New App** → **From scratch**
   - Name it (e.g., "Changelog Bot") and select your workspace

2. **Enable Incoming Webhooks:**

   - In your app settings, go to **Incoming Webhooks**
   - Toggle **Activate Incoming Webhooks** to On
   - Click **Add New Webhook to Workspace**
   - Select the channel for PR summaries
   - Copy the webhook URL

3. **Add the Secret:**
   - Go to your repository **Settings** → **Secrets and variables** → **Actions**
   - Add a new secret:

| Name                | Value                      |
| ------------------- | -------------------------- |
| `SLACK_WEBHOOK_URL` | The webhook URL from Slack |

## What It Does

When a PR is opened or updated, the workflow:

1. **Analyzes the diff** - Examines all changed files and commits
2. **Generates AI summary** - Creates customer-focused descriptions
3. **Categorizes changes** into:
   - 🚀 **Features** - New capabilities for users
   - 🐛 **Fixes** - Resolved issues
   - ⚡ **Improvements** - Performance/UX enhancements
   - ⚠️ **Breaking Changes** - Things users need to know about
4. **Posts to Slack** (if configured) with formatted blocks

### Example Slack Message

```
*Improved Export Performance* (abc1234)

Enhanced the file export system for better reliability.

─────────────────────────────────

*Commits*
`abc1234` feat: optimize export pipeline — John Doe
`def5678` fix: handle large files gracefully — Jane Smith

─────────────────────────────────

*Features*
Export Large Files
You can now export files up to 100MB without timeout errors.
→ Try exporting a large project to see the improvement

*Fixes*
CSV Export Headers
Fixed issue where CSV exports were missing column headers.
→ Export any data as CSV and verify headers are present
```

## Customization

### Analyze Draft PRs

Remove this line to include draft PRs:

```yaml
if: github.event.pull_request.draft == false
```

### Change Output Format

Available formats for `--format`:

- `text` - Plain text (default, shown in GitHub Actions logs)
- `slack` - Slack Block Kit format
- `markdown` - Markdown format
- `json` - Raw JSON output

### Skip Slack Step

Remove or comment out the entire "Post to Slack" step if you only want console output.

### Add Custom Filtering

The AI automatically filters out:

- CI/CD changes
- Test file updates
- Internal refactoring
- Dependency updates (unless security-related)

Only customer-facing changes are included in the summary.

## Troubleshooting

### "Resource not accessible" Error

Ensure the workflow has proper permissions. Add this to your workflow if needed:

```yaml
permissions:
  contents: read
  pull-requests: read
```

### Slack Messages Not Posting

1. Verify `SLACK_WEBHOOK_URL` secret is set correctly
2. Check the webhook URL starts with `https://hooks.slack.com/services/`
3. Ensure the Slack app is still installed in your workspace

### "Invalid git range" Error

This usually means the base commit isn't available. Ensure `fetch-depth: 0` is set in the checkout step.

### Rate Limiting

If you have many PRs, you may hit OpenAI rate limits. Consider:

- Adding a delay between runs
- Using a higher-tier OpenAI plan
- Limiting the workflow to specific branches

## Environment Variables

| Variable                  | Required | Description                    |
| ------------------------- | -------- | ------------------------------ |
| `POOLSIDE_OPENAI_API_KEY` | Yes      | OpenAI API key for AI analysis |

## Advanced: Organization-Wide Setup

For organizations, you can set secrets at the organization level:

1. Go to your organization **Settings**
2. Navigate to **Secrets and variables** → **Actions**
3. Add `OPENAI_API_KEY` and optionally `SLACK_WEBHOOK_URL`
4. Set repository access policy

Then copy just the workflow file to each repository - no per-repo secret setup needed.

## Support

- [Poolside CLI Documentation](https://github.com/your-org/poolside)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
