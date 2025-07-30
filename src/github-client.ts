import { Octokit } from "@octokit/rest";
import { startOfMonth, endOfMonth, parseISO } from "date-fns";
import ora from "ora";

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  mergedAt: string;
  labels: string[];
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export class GitHubClient {
  public octokit: Octokit;

  constructor(token: string) {
    if (!token) {
      throw new Error(
        'GitHub token is required. Run "npm start check-config" to verify your configuration.'
      );
    }
    this.octokit = new Octokit({ auth: token });
  }

  async getPRsForMonth(
    owner: string,
    repo: string,
    month: string,
    targetBranch?: string
  ): Promise<GitHubPR[]> {
    const spinner = ora("Fetching GitHub PRs...").start();

    try {
      const [year, monthNum] = month.split("-").map(Number);
      const startDate = startOfMonth(new Date(year, monthNum - 1));
      const endDate = endOfMonth(new Date(year, monthNum - 1));

      // Use specified branch or auto-detect the repository's default branch
      let baseBranch = targetBranch;
      if (!baseBranch) {
        try {
          const { data: repoInfo } = await this.octokit.rest.repos.get({
            owner,
            repo,
          });
          baseBranch = repoInfo.default_branch;
        } catch (error) {
          // If we can't get repo info, fall back to common default branches
          baseBranch = "main";
        }
      }

      // Get all PRs merged in the specified month
      const { data: prs } = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        base: baseBranch,
        sort: "updated",
        direction: "desc",
        per_page: 100,
      });

      // Filter PRs that were merged in the target month
      const filteredPRs = prs.filter((pr) => {
        if (!pr.merged_at) return false;
        const mergedDate = parseISO(pr.merged_at);
        return mergedDate >= startDate && mergedDate <= endDate;
      });

      spinner.succeed(
        `Found ${filteredPRs.length} PRs merged in ${month} (using branch: ${baseBranch})`
      );

      // Enhance PR data with additional details
      const enhancedPRs = await Promise.all(
        filteredPRs.map(async (pr) => {
          const { data: fullPR } = await this.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pr.number,
          });

          return {
            number: fullPR.number,
            title: fullPR.title,
            body: fullPR.body || "",
            url: fullPR.html_url,
            author: fullPR.user?.login || "Unknown",
            mergedAt: fullPR.merged_at || "",
            labels: fullPR.labels.map((label) => label.name),
            commits: fullPR.commits,
            additions: fullPR.additions,
            deletions: fullPR.deletions,
            changedFiles: fullPR.changed_files,
          };
        })
      );

      return enhancedPRs;
    } catch (error: any) {
      spinner.fail("Failed to fetch GitHub PRs");

      // Provide specific guidance for common permission issues
      if (
        error.message?.includes(
          "Resource not accessible by personal access token"
        )
      ) {
        const enhancedError =
          new Error(`GitHub token lacks pull request access permissions.

For GitHub Personal Access Tokens:

Classic Tokens: 
  • Need 'repo' scope for private repositories
  • Need 'public_repo' scope for public repositories

Fine-grained Tokens:
  • Repository permissions must include 'Pull requests: Read'
  • Also need 'Contents: Read' and 'Metadata: Read'
  • For organization repositories: Configure organization access

Update your token at: https://github.com/settings/tokens

Original error: ${error.message}`);
        enhancedError.stack = error.stack;
        throw enhancedError;
      }

      throw error;
    }
  }

  // Extract JIRA ticket keys from PR body and title
  extractJiraKeys(prData: GitHubPR): string[] {
    const jiraKeyRegex = /[A-Z][A-Z0-9]+-\d+/g;
    const text = `${prData.title} ${prData.body}`;
    const matches = text.match(jiraKeyRegex);
    return matches ? [...new Set(matches)] : [];
  }

  // Validate that a repository exists and is accessible
  async validateRepository(
    owner: string,
    repo: string
  ): Promise<{ exists: boolean; defaultBranch?: string; error?: string }> {
    try {
      const { data: repoInfo } = await this.octokit.rest.repos.get({
        owner,
        repo,
      });
      return { exists: true, defaultBranch: repoInfo.default_branch };
    } catch (error: any) {
      if (error.status === 404) {
        return {
          exists: false,
          error: `Repository not found
  • Repository name is incorrect: ${owner}/${repo}
  • Repository is private and token lacks required permissions
  • Token lacks 'read:org' scope for organization repositories
  • Repository doesn't exist

For GitHub Personal Access Tokens:
  Classic Tokens: Need 'repo' and 'read:org' scopes
  Fine-grained Tokens: Need 'Contents: Read', 'Metadata: Read', 'Pull requests: Read' permissions`,
        };
      } else if (error.status === 403) {
        return {
          exists: false,
          error: `Access denied - Token permissions insufficient

For GitHub Personal Access Tokens:
  Classic Tokens: 
    • Private repos: Need 'repo' scope
    • Organization repos: Need 'read:org' scope
  
  Fine-grained Tokens:
    • Repository permissions: 'Contents: Read', 'Metadata: Read', 'Pull requests: Read'
    • Organization access: Must be configured for organization repositories
    • Check permissions at: https://github.com/settings/tokens`,
        };
      } else {
        return { exists: false, error: `GitHub API error: ${error.message}` };
      }
    }
  }
}
