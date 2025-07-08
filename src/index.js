#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { EpicWorkflow } from './epic-workflow.js';

dotenv.config();

// Validate environment configuration
function validateConfig() {
  const requiredVars = {
    OPENAI_API_KEY: 'OpenAI API Key',
    JIRA_HOST: 'JIRA Server Host',
    JIRA_USERNAME: 'JIRA Username',
    JIRA_PASSWORD: 'JIRA Password/Token'
  };
  
  const optionalVars = {
    GITHUB_TOKEN: 'GitHub Personal Access Token'
  };

  const missing = [];
  const optional = [];

  // Check required variables
  Object.entries(requiredVars).forEach(([key, description]) => {
    if (!process.env[key]) {
      missing.push({ key, description });
    }
  });

  // Check optional variables
  Object.entries(optionalVars).forEach(([key, description]) => {
    if (!process.env[key]) {
      optional.push({ key, description });
    }
  });

  if (missing.length > 0) {
    console.log(chalk.red('\n❌ Missing required configuration:'));
    console.log(chalk.red('══════════════════════════════════\n'));
    
    missing.forEach(({ key, description }) => {
      console.log(chalk.red(`• ${key}`));
      console.log(chalk.gray(`  Description: ${description}`));
      console.log('');
    });

    console.log(chalk.yellow('📋 Setup Instructions:'));
    console.log(chalk.yellow('═══════════════════════\n'));
    
    console.log(chalk.white('1. Copy the example environment file:'));
    console.log(chalk.gray('   cp env.example .env\n'));
    
    console.log(chalk.white('2. Edit .env and add your credentials for these variables:\n'));
    
    missing.forEach(({ key, description }) => {
      console.log(chalk.cyan(`   ${key}=your_${key.toLowerCase()}_here`));
    });
    
    console.log('\n' + chalk.white('3. Get your credentials:'));
    console.log(chalk.gray('   • OpenAI API Key: https://platform.openai.com/api-keys'));
    console.log(chalk.gray('   • JIRA Host: Your JIRA server hostname'));
    console.log(chalk.gray('   • JIRA Username: Your JIRA username'));
    console.log(chalk.gray('   • JIRA Password: Your JIRA password or Personal Access Token'));
    
    console.log('\n' + chalk.white('For detailed setup instructions, see the README.md file.'));
    
    process.exit(1);
  }

  if (optional.length > 0) {
    console.log(chalk.yellow('\n⚠️  Optional GitHub integration not configured:'));
    optional.forEach(({ key, description }) => {
      console.log(chalk.gray(`   • ${key} - ${description}`));
    });
    console.log(chalk.gray('\n   GitHub features will be skipped. To enable GitHub integration,'));
    console.log(chalk.gray('   add GITHUB_TOKEN to your .env file.\n'));
  }
}

function createWorkflowConfig() {
  return {
    jira: {
      host: process.env.JIRA_HOST?.replace(/^https?:\/\//, ''),
      username: process.env.JIRA_USERNAME,
      password: process.env.JIRA_PASSWORD
    },
    github: {
      token: process.env.GITHUB_TOKEN
    },
    ai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.AI_MODEL || 'gpt-4o',
      maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 4000
    },
    verbose: false
  };
}

const program = new Command();

program
  .name('agent-workflow')
  .description('CLI tool for automating workflows with productivity tools like JIRA and GitHub')
  .version('2.0.0');

program
  .command('process-epic <epic-id>')
  .description('Process a JIRA epic to claim the next available ticket and generate a coding prompt')
  .option('-a, --agent <name>', 'Name of the agent claiming the ticket', 'Coding Agent')
  .option('-c, --claimant <name>', 'Name to use when claiming the ticket')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (epicId, options) => {
    try {
      validateConfig();
      
      const config = createWorkflowConfig();
      config.verbose = options.verbose;
      
      const workflow = new EpicWorkflow(config);
      const result = await workflow.processEpic(epicId, {
        agentName: options.agent,
        claimantName: options.claimant || options.agent
      });
      
      if (result) {
        console.log(chalk.green('\n✅ Epic workflow completed successfully!'));
        console.log(chalk.blue(`📋 Epic: ${result.epic.key}`));
        console.log(chalk.blue(`🎫 Ticket: ${result.ticket.key}`));
        console.log(chalk.blue(`📄 Prompt file: ${result.tempFile}`));
      } else {
        console.log(chalk.yellow('\n⚠️  Epic workflow completed but no ticket was processed'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Error processing epic:'), error.message);
      process.exit(1);
    }
  });

program
  .command('list-epics <project-key>')
  .description('List all epics for a JIRA project')
  .option('-l, --limit <number>', 'Maximum number of epics to return', '20')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (projectKey, options) => {
    try {
      validateConfig();
      
      const config = createWorkflowConfig();
      config.verbose = options.verbose;
      
      const workflow = new EpicWorkflow(config);
      await workflow.listEpics(projectKey, {
        maxResults: parseInt(options.limit)
      });
      
    } catch (error) {
      console.error(chalk.red('❌ Error listing epics:'), error.message);
      process.exit(1);
    }
  });

program
  .command('epic-status <epic-id>')
  .description('Get the status of a JIRA epic and its child tickets')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (epicId, options) => {
    try {
      validateConfig();
      
      const config = createWorkflowConfig();
      config.verbose = options.verbose;
      
      const workflow = new EpicWorkflow(config);
      await workflow.getEpicStatus(epicId);
      
    } catch (error) {
      console.error(chalk.red('❌ Error getting epic status:'), error.message);
      process.exit(1);
    }
  });

program
  .command('setup-jira-pat')
  .description('Set up JIRA Personal Access Token for better security')
  .option('--jira-base-url <url>', 'JIRA base URL (overrides env var)')
  .action(async (options) => {
    try {
      validateConfig();
      
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

program
  .command('init-env')
  .description('Initialize environment configuration file')
  .option('-o, --output <file>', 'Output env file path', '.env')
  .action(async (options) => {
    try {
      const examplePath = path.join(process.cwd(), 'env.example');
      
      try {
        await fs.access(examplePath);
        await fs.copyFile(examplePath, options.output);
        console.log(chalk.green(`✅ Environment template created: ${options.output}`));
        console.log(chalk.yellow('📝 Edit the environment file to add your credentials.'));
      } catch {
        // If example doesn't exist, create a minimal env file
        const minimalEnv = `# Agent Workflow CLI Configuration
# Copy this file to .env and fill in your credentials

# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here
AI_MODEL=gpt-4o
AI_MAX_TOKENS=4000

# JIRA Configuration (Required)
JIRA_HOST=your-company.atlassian.net
JIRA_USERNAME=your_jira_username
JIRA_PASSWORD=your_jira_password_or_pat

# GitHub Configuration (Optional)
GITHUB_TOKEN=your_github_token_here
`;
        
        await fs.writeFile(options.output, minimalEnv);
        console.log(chalk.green(`✅ Environment template created: ${options.output}`));
        console.log(chalk.yellow('📝 Edit the environment file to add your credentials.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Error creating environment file:'), error.message);
      process.exit(1);
    }
  });

// Add a config check command for debugging
program
  .command('check-config')
  .description('Check current environment configuration')
  .action(() => {
    console.log(chalk.blue('🔧 Checking configuration...\n'));
    
    const vars = [
      { key: 'OPENAI_API_KEY', required: true },
      { key: 'JIRA_HOST', required: true },
      { key: 'JIRA_USERNAME', required: true },
      { key: 'JIRA_PASSWORD', required: true },
      { key: 'GITHUB_TOKEN', required: false }
    ];
    
    vars.forEach(({ key, required }) => {
      const value = process.env[key];
      const status = value ? '✅' : (required ? '❌' : '⚠️');
      const display = value ? `${value.substring(0, 8)}...` : 'Not set';
      const label = required ? 'Required' : 'Optional';
      
      console.log(`${status} ${key}: ${display} (${label})`);
    });
    
    console.log('\n' + chalk.gray('Note: Only the first 8 characters of tokens are shown for security.'));
  });

program
  .command('test-connections')
  .description('Test connections to JIRA, GitHub, and OpenAI')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (options) => {
    try {
      validateConfig();
      
      const config = createWorkflowConfig();
      config.verbose = options.verbose;
      
      const workflow = new EpicWorkflow(config);
      await workflow.validateConnections();
      
      console.log(chalk.green('✅ All connections tested successfully!'));
      
    } catch (error) {
      console.error(chalk.red('❌ Connection test failed:'), error.message);
      process.exit(1);
    }
  });

program.parse(); 
