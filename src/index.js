#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { generateReleaseNotes } from './release-notes-generator.js';

dotenv.config();

const program = new Command();

program
  .name('release-notes')
  .description('Generate release notes from GitHub PRs and JIRA tickets')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate release notes for the current month')
  .requiredOption('-r, --repo <repo>', 'GitHub repository (owner/repo)')
  .option('-m, --month <month>', 'Month to generate for (YYYY-MM)', getCurrentMonth())
  .option('-o, --output <file>', 'Output file', 'release-notes.md')
  .option('--jira-base-url <url>', 'JIRA base URL (overrides env var)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Starting release notes generation...'));
      console.log(chalk.gray(`Repository: ${options.repo}`));
      console.log(chalk.gray(`Month: ${options.month}`));
      console.log(chalk.gray(`Output: ${options.output}`));
      
      await generateReleaseNotes({
        repo: options.repo,
        month: options.month,
        outputFile: options.output,
        jiraBaseUrl: options.jiraBaseUrl
      });
      
      console.log(chalk.green('✅ Release notes generated successfully!'));
    } catch (error) {
      console.error(chalk.red('❌ Error generating release notes:'), error.message);
      process.exit(1);
    }
  });

program
  .command('setup-jira-pat')
  .description('Set up JIRA Personal Access Token for better security')
  .option('--jira-base-url <url>', 'JIRA base URL (overrides env var)')
  .action(async (options) => {
    try {
      const { JiraPATManager } = await import('./jira-pat-manager.js');
      
      const jiraHost = options.jiraBaseUrl || process.env.JIRA_HOST;
      const jiraUsername = process.env.JIRA_USERNAME;
      const jiraPassword = process.env.JIRA_PASSWORD;
      
      if (!jiraHost || !jiraUsername || !jiraPassword) {
        console.log(chalk.red('❌ JIRA configuration missing.'));
        console.log(chalk.gray('Please set JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD environment variables.'));
        process.exit(1);
      }
      
      const patManager = new JiraPATManager({
        host: jiraHost.replace(/^https?:\/\//, ''),
        username: jiraUsername,
        password: jiraPassword
      });
      
      await patManager.setupPATWorkflow();
      
    } catch (error) {
      console.error(chalk.red('❌ Error setting up JIRA PAT:'), error.message);
      process.exit(1);
    }
  });

program.parse();

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
} 
