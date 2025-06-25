import fs from 'fs/promises';
import { GitHubClient } from './github-client.js';
import { JiraClient } from './jira-client.js';
import { AIProcessor } from './ai-processor.js';
import { MarkdownGenerator } from './markdown-generator.js';
import chalk from 'chalk';

export async function generateReleaseNotes(options) {
  const { repo, month, outputFile, jiraBaseUrl, verbose } = options;
  
  // Parse repository owner/name
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error('Repository must be in format "owner/repo"');
  }
  
  console.log(chalk.blue(`\n📊 Processing repository: ${repo}`));
  console.log(chalk.blue(`📅 Target month: ${month}`));
  
  // Initialize clients
  const githubClient = new GitHubClient(process.env.GITHUB_TOKEN);
  const jiraClient = await createJiraClient(jiraBaseUrl);
  const aiProcessor = new AIProcessor(process.env.OPENAI_API_KEY, verbose);
  const markdownGenerator = new MarkdownGenerator();
  
  try {
    // Step 1: Fetch GitHub PRs for the month
    console.log(chalk.cyan('\n🔍 Fetching GitHub PR metadata...'));
    const prData = await githubClient.getPRsForMonth(owner, repoName, month);
    
    if (prData.length === 0) {
      console.log(chalk.yellow('⚠️  No PRs found for the specified month'));
      return;
    }
    
    // Step 2: Extract JIRA keys and fetch JIRA ticket metadata
    console.log(chalk.cyan('\n🎫 Extracting JIRA tickets...'));
    const allJiraKeys = new Set();
    
    prData.forEach(pr => {
      const jiraKeys = githubClient.extractJiraKeys(pr);
      jiraKeys.forEach(key => allJiraKeys.add(key));
    });
    
    const jiraTickets = jiraClient 
      ? await jiraClient.getTicketsMetadata([...allJiraKeys])
      : [];
    
    if (jiraTickets.length > 0) {
      console.log(chalk.green(`✅ Found ${jiraTickets.length} JIRA tickets`));
    } else {
      console.log(chalk.yellow('⚠️  No JIRA tickets found or JIRA not configured'));
    }
    
    // Step 3: Process with AI to generate release notes
    console.log(chalk.cyan('\n🤖 Processing with AI...'));
    const releaseNotesData = await aiProcessor.generateReleaseNotes(prData, jiraTickets, month);
    
    // Step 4: Generate markdown output
    console.log(chalk.cyan('\n📝 Generating markdown...'));
    const markdown = markdownGenerator.generateMarkdown({
      month,
      repo,
      releaseNotesData,
      prData,
      jiraTickets
    });
    
    // Step 5: Write to file
    await fs.writeFile(outputFile, markdown, 'utf8');
    
    console.log(chalk.green(`\n✅ Release notes saved to: ${outputFile}`));
    console.log(chalk.blue(`📊 Summary:`));
    console.log(chalk.blue(`   • ${prData.length} PRs processed`));
    console.log(chalk.blue(`   • ${jiraTickets.length} JIRA tickets linked`));
    console.log(chalk.blue(`   • ${Object.values(releaseNotesData).flat().length} release note entries generated`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error during processing:'));
    console.error(chalk.red(error.message));
    
    if (error.message.includes('API rate limit')) {
      console.log(chalk.yellow('\n💡 Tip: You may have hit API rate limits. Try again later or increase your API limits.'));
    }
    
    throw error;
  }
}

async function createJiraClient(jiraBaseUrl) {
  const jiraHost = jiraBaseUrl || process.env.JIRA_HOST;
  const jiraUsername = process.env.JIRA_USERNAME;
  const jiraPassword = process.env.JIRA_PASSWORD;
  
  if (!jiraHost || !jiraUsername || !jiraPassword) {
    console.log(chalk.yellow('⚠️  JIRA configuration not found. Skipping JIRA ticket fetching.'));
    console.log(chalk.gray('   Set JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD environment variables to enable JIRA integration.'));
    return null;
  }
  
  try {
    const jiraClient = new JiraClient({
      host: jiraHost.replace(/^https?:\/\//, ''),
      username: jiraUsername,
      password: jiraPassword
    });
    
    // Test connection and offer PAT setup if needed
    const connectionWorks = await jiraClient.testConnection();
    if (!connectionWorks) {
      console.log(chalk.yellow('⚠️  JIRA connection test failed. Continuing without JIRA integration.'));
      return null;
    }
    
    return jiraClient;
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to initialize JIRA client. Continuing without JIRA integration.'));
    console.log(chalk.gray(`   Error: ${error.message}`));
    return null;
  }
} 
