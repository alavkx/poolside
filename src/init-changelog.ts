import fs from "node:fs/promises";
import path from "node:path";

export interface InitChangelogOptions {
  targetDir: string;
  includeSlack: boolean;
  force?: boolean;
}

export interface InitChangelogResult {
  created: boolean;
  workflowPath: string;
  alreadyExists?: boolean;
}

/**
 * Initialize the changelog workflow in a project
 */
export async function initChangelog(
  options: InitChangelogOptions
): Promise<InitChangelogResult> {
  const workflowDir = path.join(options.targetDir, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "changelog.yml");

  // Check if workflow already exists
  try {
    await fs.access(workflowPath);
    if (!options.force) {
      return {
        created: false,
        workflowPath,
        alreadyExists: true,
      };
    }
  } catch {
    // File doesn't exist, continue
  }

  // Generate workflow content
  const workflowContent = generateChangelogWorkflow(options.includeSlack);

  // Create directories
  await fs.mkdir(workflowDir, { recursive: true });

  // Write workflow file
  await fs.writeFile(workflowPath, workflowContent);

  return {
    created: true,
    workflowPath,
  };
}

/**
 * Generate the GitHub Actions workflow content
 */
export function generateChangelogWorkflow(includeSlack: boolean): string {
  const slackStep = includeSlack
    ? `
      # Post to Slack (requires SLACK_WEBHOOK_URL secret)
      - name: Post to Slack
        if: \${{ secrets.SLACK_WEBHOOK_URL != '' }}
        run: |
          npx poolside@latest changelog \\
            --range "\${{ github.event.pull_request.base.sha }}...\${{ github.event.pull_request.head.sha }}" \\
            --format slack \\
            --slack-webhook "\${{ secrets.SLACK_WEBHOOK_URL }}" \\
            --pr-number "\${{ github.event.pull_request.number }}" \\
            --pr-url "\${{ github.event.pull_request.html_url }}" \\
            --title "\${{ github.event.pull_request.title }}"
        env:
          POOLSIDE_OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`
    : "";

  return `name: Changelog

on:
  pull_request:
    types: [closed]
    branches: [main, master]

jobs:
  announce-merge:
    name: Announce Merged Changes
    runs-on: ubuntu-latest
    if: github.event.pull_request.merged == true

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Analyze merged changes
        run: |
          npx poolside@latest changelog \\
            --range "\${{ github.event.pull_request.base.sha }}...\${{ github.event.pull_request.head.sha }}" \\
            --format text \\
            --pr-number "\${{ github.event.pull_request.number }}" \\
            --pr-url "\${{ github.event.pull_request.html_url }}" \\
            --title "\${{ github.event.pull_request.title }}"
        env:
          POOLSIDE_OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
${slackStep}`;
}
