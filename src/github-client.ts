import { Octokit } from '@octokit/rest';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import ora from 'ora';

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

  async getPRsForMonth(owner: string, repo: string, month: string): Promise<GitHubPR[]> {
    const spinner = ora('Fetching GitHub PRs...').start();

    try {
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = startOfMonth(new Date(year, monthNum - 1));
      const endDate = endOfMonth(new Date(year, monthNum - 1));

      // Get all PRs merged in the specified month
      const { data: prs } = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state: 'closed',
        base: 'main', // Adjust if your default branch is different
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });

      // Filter PRs that were merged in the target month
      const filteredPRs = prs.filter((pr) => {
        if (!pr.merged_at) return false;
        const mergedDate = parseISO(pr.merged_at);
        return mergedDate >= startDate && mergedDate <= endDate;
      });

      spinner.succeed(`Found ${filteredPRs.length} PRs merged in ${month}`);

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
            body: fullPR.body || '',
            url: fullPR.html_url,
            author: fullPR.user?.login || 'Unknown',
            mergedAt: fullPR.merged_at || '',
            labels: fullPR.labels.map((label) => label.name),
            commits: fullPR.commits,
            additions: fullPR.additions,
            deletions: fullPR.deletions,
            changedFiles: fullPR.changed_files,
          };
        })
      );

      return enhancedPRs;
    } catch (error) {
      spinner.fail('Failed to fetch GitHub PRs');
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
}
