import fs from 'fs/promises';
import { GitHubClient, GitHubPR } from './github-client.js';
import { JiraClient, JiraTicket } from './jira-client.js';
import { AIProcessor, AIConfig, ReleaseNotesData } from './ai-processor.js';
import { MarkdownGenerator } from './markdown-generator.js';
import chalk from 'chalk';
import ora from 'ora';

export interface ReleaseConfig {
  month?: string;
  outputFile?: string;
  title?: string;
  description?: string;
  includeTableOfContents: boolean;
  includeSummary: boolean;
}

export interface RepositoryConfig {
  name: string;
  repo: string;
  description?: string;
  priority?: number;
  includeInSummary?: boolean;
}

export interface JiraConfig {
  enabled?: boolean;
  baseUrl?: string;
}

export interface MultiRepoConfig {
  releaseConfig: ReleaseConfig;
  aiConfig: AIConfig;
  repositories: RepositoryConfig[];
  jiraConfig: JiraConfig;
  verbose?: boolean;
}

export interface RepoData {
  repoConfig: RepositoryConfig;
  prData: GitHubPR[];
  jiraTickets: JiraTicket[];
  releaseNotesData: Record<string, string[]>;
  error?: string;
}

export interface TotalStats {
  totalPRs: number;
  totalJiraTickets: number;
  successfulRepos: number;
  totalRepos: number;
}

export interface ProcessRepositoryParams {
  repo: RepositoryConfig;
  targetMonth: string;
  githubClient: GitHubClient;
  jiraClient: JiraClient | null;
  aiProcessor: AIProcessor;
  verbose: boolean;
  progress: string;
}

export interface LegacyReleaseNotesOptions {
  repo: string;
  month: string;
  outputFile: string;
  jiraBaseUrl?: string;
  verbose?: boolean;
}

export async function generateMultiRepoReleaseNotes(config: MultiRepoConfig): Promise<void> {
  const { releaseConfig, aiConfig, repositories, jiraConfig, verbose = false } = config;

  const targetMonth = releaseConfig.month || getCurrentMonth();
  const outputFile = releaseConfig.outputFile || 'release-notes.md';

  console.log(chalk.blue(`\n🎯 Multi-Repository Release Notes Generation`));
  console.log(chalk.blue(`══════════════════════════════════════════════`));
  console.log(chalk.gray(`Target Month: ${targetMonth}`));
  console.log(chalk.gray(`Output File: ${outputFile}`));
  console.log(chalk.gray(`Repositories: ${repositories.length}`));
  console.log(chalk.gray(`AI Model: ${aiConfig.model}`));

  const overallSpinner = ora('Initializing multi-repo processing...').start();

  try {
    // Initialize clients
    const githubClient = new GitHubClient(process.env.GITHUB_TOKEN!);
    const jiraClient = await createJiraClient(jiraConfig, verbose);
    const aiProcessor = new AIProcessor(process.env.OPENAI_API_KEY!, verbose, aiConfig);
    const markdownGenerator = new MarkdownGenerator();

    overallSpinner.succeed('Clients initialized successfully');

    // Sort repositories by priority
    const sortedRepos = [...repositories].sort((a, b) => (a.priority || 999) - (b.priority || 999));

    const allRepoData: RepoData[] = [];
    let totalPRs = 0;
    let totalJiraTickets = 0;

    // Process each repository
    console.log(chalk.cyan(`\n📦 Processing ${sortedRepos.length} repositories...`));

    for (let i = 0; i < sortedRepos.length; i++) {
      const repo = sortedRepos[i];
      const progress = `[${i + 1}/${sortedRepos.length}]`;

      console.log(chalk.blue(`\n${progress} ${repo.name} (${repo.repo})`));
      console.log(
        chalk.gray(
          `    Priority: ${repo.priority || 'unset'} | Include in summary: ${
            repo.includeInSummary ? 'yes' : 'no'
          }`
        )
      );

      try {
        const repoData = await processRepository({
          repo,
          targetMonth,
          githubClient,
          jiraClient,
          aiProcessor,
          verbose,
          progress,
        });

        allRepoData.push(repoData);
        totalPRs += repoData.prData.length;
        totalJiraTickets += repoData.jiraTickets.length;

        console.log(
          chalk.green(
            `    ✅ Completed: ${repoData.prData.length} PRs, ${repoData.jiraTickets.length} JIRA tickets`
          )
        );
      } catch (error: any) {
        console.log(chalk.red(`    ❌ Failed: ${error.message}`));

        // Add empty data to maintain structure but mark as failed
        allRepoData.push({
          repoConfig: repo,
          prData: [],
          jiraTickets: [],
          releaseNotesData: {
            features: [],
            bugs: [],
            improvements: [],
            other: [],
          } as Record<string, string[]>,
          error: error.message,
        });
      }
    }

    console.log(chalk.cyan(`\n📊 Processing Summary:`));
    console.log(chalk.gray(`   • Total PRs: ${totalPRs}`));
    console.log(chalk.gray(`   • Total JIRA tickets: ${totalJiraTickets}`));
    console.log(
      chalk.gray(
        `   • Successful repos: ${allRepoData.filter((r) => !r.error).length}/${allRepoData.length}`
      )
    );

    // Generate consolidated markdown
    console.log(chalk.cyan(`\n📝 Generating consolidated release notes...`));
    const consolidatedSpinner = ora('Creating markdown output...').start();

    const totalStats: TotalStats = {
      totalPRs,
      totalJiraTickets,
      successfulRepos: allRepoData.filter((r) => !r.error).length,
      totalRepos: allRepoData.length,
    };

    const markdown = markdownGenerator.generateMultiRepoMarkdown({
      releaseConfig,
      targetMonth,
      allRepoData,
      totalStats,
    });

    consolidatedSpinner.succeed('Markdown generated successfully');

    // Write to file
    const writeSpinner = ora(`Writing to ${outputFile}...`).start();
    await fs.writeFile(outputFile, markdown, 'utf8');
    writeSpinner.succeed(`Release notes saved to ${outputFile}`);

    // Show final summary
    console.log(chalk.green(`\n🎉 Multi-Repository Release Notes Complete!`));
    console.log(chalk.green(`══════════════════════════════════════════════`));
    console.log(chalk.blue(`📁 Output: ${outputFile}`));
    console.log(chalk.blue(`📈 Statistics:`));
    console.log(chalk.blue(`   • Repositories processed: ${allRepoData.length}`));
    console.log(chalk.blue(`   • Total pull requests: ${totalPRs}`));
    console.log(chalk.blue(`   • Total JIRA tickets: ${totalJiraTickets}`));
    console.log(
      chalk.blue(
        `   • AI-generated entries: ${allRepoData.reduce(
          (sum, repo) => sum + Object.values(repo.releaseNotesData || {}).flat().length,
          0
        )}`
      )
    );

    const failedRepos = allRepoData.filter((r) => r.error);
    if (failedRepos.length > 0) {
      console.log(chalk.yellow(`\n⚠️  ${failedRepos.length} repositories had issues:`));
      failedRepos.forEach((repo) => {
        console.log(chalk.yellow(`   • ${repo.repoConfig.name}: ${repo.error}`));
      });
    }
  } catch (error: any) {
    overallSpinner.fail('Multi-repo processing failed');
    console.error(chalk.red('\n❌ Critical error during processing:'));
    console.error(chalk.red(error.message));

    if (verbose) {
      console.error(chalk.red('\nStack trace:'));
      console.error(chalk.red(error.stack));
    }

    throw error;
  }
}

async function processRepository({
  repo,
  targetMonth,
  githubClient,
  jiraClient,
  aiProcessor,
  verbose,
  progress,
}: ProcessRepositoryParams): Promise<RepoData> {
  const [owner, repoName] = repo.repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Repository must be in format "owner/repo", got: ${repo.repo}`);
  }

  // Step 1: Fetch GitHub PRs
  const prSpinner = ora(`${progress} Fetching GitHub PRs...`).start();
  let prData: GitHubPR[] = [];

  try {
    prData = await githubClient.getPRsForMonth(owner, repoName, targetMonth);

    if (prData.length === 0) {
      prSpinner.info(`${progress} No PRs found for ${targetMonth}`);
    } else {
      prSpinner.succeed(`${progress} Found ${prData.length} PRs`);
    }
  } catch (error: any) {
    prSpinner.fail(`${progress} Failed to fetch PRs: ${error.message}`);
    throw new Error(`GitHub API error: ${error.message}`);
  }

  // Step 2: Extract and fetch JIRA tickets
  const jiraSpinner = ora(`${progress} Processing JIRA tickets...`).start();
  let jiraTickets: JiraTicket[] = [];

  try {
    if (jiraClient && prData.length > 0) {
      const allJiraKeys = new Set<string>();

      prData.forEach((pr) => {
        const jiraKeys = githubClient.extractJiraKeys(pr);
        jiraKeys.forEach((key) => allJiraKeys.add(key));
      });

      if (allJiraKeys.size > 0) {
        jiraTickets = await jiraClient.getTicketsMetadata([...allJiraKeys]);
        jiraSpinner.succeed(
          `${progress} Found ${jiraTickets.length}/${allJiraKeys.size} JIRA tickets`
        );
      } else {
        jiraSpinner.info(`${progress} No JIRA keys found in PRs`);
      }
    } else {
      jiraSpinner.info(`${progress} JIRA processing skipped`);
    }
  } catch (error: any) {
    jiraSpinner.warn(`${progress} JIRA processing failed: ${error.message}`);
    // Continue without JIRA data
  }

  // Step 3: AI Processing
  const aiSpinner = ora(`${progress} Processing with AI...`).start();
  let releaseNotesData: ReleaseNotesData = {
    features: [],
    bugs: [],
    improvements: [],
    other: [],
  };

  try {
    if (prData.length > 0) {
      releaseNotesData = await aiProcessor.generateReleaseNotes(
        prData,
        jiraTickets,
        targetMonth,
        repo
      );

      const totalEntries = Object.values(releaseNotesData).flat().length;
      aiSpinner.succeed(`${progress} Generated ${totalEntries} release note entries`);
    } else {
      aiSpinner.info(`${progress} No PRs to process with AI`);
    }
  } catch (error: any) {
    aiSpinner.fail(`${progress} AI processing failed: ${error.message}`);
    throw new Error(`AI processing error: ${error.message}`);
  }

  return {
    repoConfig: repo,
    prData,
    jiraTickets,
    releaseNotesData: releaseNotesData as unknown as Record<string, string[]>,
  };
}

async function createJiraClient(
  jiraConfig: JiraConfig,
  verbose: boolean
): Promise<JiraClient | null> {
  if (!jiraConfig?.enabled) {
    if (verbose) {
      console.log(chalk.gray('🎫 JIRA integration disabled by configuration'));
    }
    return null;
  }

  const jiraHost = jiraConfig.baseUrl || process.env.JIRA_HOST;
  const jiraUsername = process.env.JIRA_USERNAME;
  const jiraPassword = process.env.JIRA_PASSWORD;

  if (!jiraHost || !jiraUsername || !jiraPassword) {
    console.log(chalk.yellow('⚠️  JIRA configuration not found. Skipping JIRA ticket fetching.'));
    console.log(
      chalk.gray(
        '   Set JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD environment variables to enable JIRA integration.'
      )
    );
    return null;
  }

  try {
    const jiraClient = new JiraClient({
      host: jiraHost.replace(/^https?:\/\//, ''),
      username: jiraUsername,
      password: jiraPassword,
    });

    // Test connection
    const connectionWorks = await jiraClient.testConnection();
    if (!connectionWorks) {
      console.log(
        chalk.yellow('⚠️  JIRA connection test failed. Continuing without JIRA integration.')
      );
      return null;
    }

    if (verbose) {
      console.log(chalk.green('✅ JIRA client initialized and tested successfully'));
    }

    return jiraClient;
  } catch (error: any) {
    console.log(
      chalk.yellow('⚠️  Failed to initialize JIRA client. Continuing without JIRA integration.')
    );
    console.log(chalk.gray(`   Error: ${error.message}`));
    return null;
  }
}

// Legacy single-repo function for backward compatibility
export async function generateReleaseNotes(options: LegacyReleaseNotesOptions): Promise<void> {
  const { repo, month, outputFile, jiraBaseUrl, verbose } = options;

  // Convert to new multi-repo format
  const config: MultiRepoConfig = {
    releaseConfig: {
      month,
      outputFile,
      title: 'Release Notes',
      description: 'Generated release notes',
      includeTableOfContents: false,
      includeSummary: true,
    },
    aiConfig: {
      maxTokens: 4000,
      batchSize: 5,
      model: 'gpt-4o-mini',
    },
    repositories: [
      {
        name: repo.split('/')[1],
        repo: repo,
        description: '',
        priority: 1,
        includeInSummary: true,
      },
    ],
    jiraConfig: {
      enabled: true,
      baseUrl: jiraBaseUrl,
    },
    verbose,
  };

  return generateMultiRepoReleaseNotes(config);
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
