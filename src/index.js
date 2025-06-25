#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { generateMultiRepoReleaseNotes } from './release-notes-generator.js';

dotenv.config();

// Validate environment configuration
function validateConfig() {
  const requiredVars = {
    GITHUB_TOKEN: 'GitHub Personal Access Token',
    OPENAI_API_KEY: 'OpenAI API Key'
  };
  
  const optionalVars = {
    JIRA_HOST: 'JIRA Server Host',
    JIRA_USERNAME: 'JIRA Username',
    JIRA_PASSWORD: 'JIRA Password/Token'
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
    console.log(chalk.gray('   • GitHub Token: https://github.com/settings/tokens'));
    console.log(chalk.gray('   • OpenAI API Key: https://platform.openai.com/api-keys'));
    
    console.log('\n' + chalk.white('For detailed setup instructions, see the README.md file.'));
    
    process.exit(1);
  }

  if (optional.length > 0) {
    console.log(chalk.yellow('\n⚠️  Optional JIRA integration not configured:'));
    optional.forEach(({ key, description }) => {
      console.log(chalk.gray(`   • ${key} - ${description}`));
    });
    console.log(chalk.gray('\n   JIRA tickets will be skipped. To enable JIRA integration,'));
    console.log(chalk.gray('   add JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD to your .env file.\n'));
  }
}

async function loadConfig(configPath) {
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // Validate required config structure
    if (!config.repositories || !Array.isArray(config.repositories)) {
      throw new Error('Config must contain a "repositories" array');
    }
    
    if (config.repositories.length === 0) {
      throw new Error('At least one repository must be configured');
    }
    
    // Validate each repository config
    config.repositories.forEach((repo, index) => {
      if (!repo.name || !repo.repo) {
        throw new Error(`Repository at index ${index} missing required fields: name, repo`);
      }
      
      if (!repo.repo.includes('/')) {
        throw new Error(`Repository "${repo.repo}" must be in format "owner/repo"`);
      }
    });
    
    // Set defaults
    config.releaseConfig = {
      includeTableOfContents: true,
      includeSummary: true,
      ...config.releaseConfig
    };
    
    config.aiConfig = {
      maxTokens: 8000,
      batchSize: 3,
      model: 'gpt-4o',
      ...config.aiConfig
    };
    
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}. Create one using config.example.json as a template.`);
    }
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

const program = new Command();

program
  .name('release-notes')
  .description('Generate multi-repository release notes from GitHub PRs and JIRA tickets')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate release notes for multiple repositories')
  .requiredOption('-c, --config <file>', 'Configuration file path (JSON)')
  .option('-m, --month <month>', 'Override month from config (YYYY-MM)')
  .option('-o, --output <file>', 'Override output file from config')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (options) => {
    try {
      validateConfig();
      
      console.log(chalk.blue('🚀 Starting multi-repository release notes generation...'));
      console.log(chalk.gray(`Config file: ${options.config}`));
      
      const config = await loadConfig(options.config);
      
      // Override config with CLI options if provided
      if (options.month) {
        config.releaseConfig.month = options.month;
      }
      if (options.output) {
        config.releaseConfig.outputFile = options.output;
      }
      
      console.log(chalk.blue(`\n📊 Configuration loaded successfully:`));
      console.log(chalk.gray(`   • Repositories: ${config.repositories.length}`));
      console.log(chalk.gray(`   • Target month: ${config.releaseConfig.month || getCurrentMonth()}`));
      console.log(chalk.gray(`   • Output file: ${config.releaseConfig.outputFile || 'release-notes.md'}`));
      console.log(chalk.gray(`   • AI Model: ${config.aiConfig.model}`));
      
      await generateMultiRepoReleaseNotes({
        ...config,
        verbose: options.verbose
      });
      
      console.log(chalk.green('\n✅ Multi-repository release notes generated successfully!'));
    } catch (error) {
      console.error(chalk.red('❌ Error generating release notes:'), error.message);
      process.exit(1);
    }
  });

// Legacy single-repo command for backward compatibility
program
  .command('generate-single')
  .description('Generate release notes for a single repository (legacy)')
  .requiredOption('-r, --repo <repo>', 'GitHub repository (owner/repo)')
  .option('-m, --month <month>', 'Month to generate for (YYYY-MM)', getCurrentMonth())
  .option('-o, --output <file>', 'Output file', 'release-notes.md')
  .option('--jira-base-url <url>', 'JIRA base URL (overrides env var)')
  .option('--verbose', 'Enable verbose logging for debugging')
  .action(async (options) => {
    try {
      validateConfig();
      
      console.log(chalk.yellow('⚠️  Using legacy single-repo mode. Consider switching to config-driven multi-repo mode.'));
      console.log(chalk.blue('🚀 Starting release notes generation...'));
      console.log(chalk.gray(`Repository: ${options.repo}`));
      console.log(chalk.gray(`Month: ${options.month}`));
      console.log(chalk.gray(`Output: ${options.output}`));
      
      // Create a minimal config for backward compatibility
      const legacyConfig = {
        releaseConfig: {
          month: options.month,
          outputFile: options.output,
          title: 'Release Notes',
          description: 'Generated release notes',
          includeTableOfContents: false,
          includeSummary: true
        },
        aiConfig: {
          maxTokens: 4000,
          batchSize: 5,
          model: 'gpt-4o-mini'
        },
        repositories: [{
          name: options.repo.split('/')[1],
          repo: options.repo,
          description: '',
          priority: 1,
          includeInSummary: true
        }],
        jiraConfig: {
          enabled: true,
          baseUrl: options.jiraBaseUrl
        }
      };
      
      await generateMultiRepoReleaseNotes({
        ...legacyConfig,
        verbose: options.verbose
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
  .command('init-config')
  .description('Initialize a new configuration file')
  .option('-o, --output <file>', 'Output config file path', 'config.json')
  .action(async (options) => {
    try {
      const examplePath = path.join(process.cwd(), 'config.example.json');
      
      try {
        await fs.access(examplePath);
        await fs.copyFile(examplePath, options.output);
        console.log(chalk.green(`✅ Configuration template created: ${options.output}`));
        console.log(chalk.yellow('📝 Edit the configuration file to match your repositories and requirements.'));
      } catch {
        // If example doesn't exist, create a minimal config
        const minimalConfig = {
          releaseConfig: {
            month: getCurrentMonth(),
            outputFile: "release-notes.md",
            title: "Release Notes",
            description: "Generated release notes",
            includeTableOfContents: true,
            includeSummary: true
          },
          aiConfig: {
            maxTokens: 8000,
            batchSize: 3,
            model: "gpt-4o"
          },
          repositories: [
            {
              name: "Example Repo",
              repo: "owner/repository",
              description: "Description of the repository",
              priority: 1,
              includeInSummary: true
            }
          ],
          jiraConfig: {
            enabled: true
          }
        };
        
        await fs.writeFile(options.output, JSON.stringify(minimalConfig, null, 2));
        console.log(chalk.green(`✅ Basic configuration created: ${options.output}`));
        console.log(chalk.yellow('📝 Update the configuration with your actual repository details.'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Error creating config file:'), error.message);
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
      { key: 'GITHUB_TOKEN', required: true },
      { key: 'OPENAI_API_KEY', required: true },
      { key: 'JIRA_HOST', required: false },
      { key: 'JIRA_USERNAME', required: false },
      { key: 'JIRA_PASSWORD', required: false }
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

program.parse();

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
} 
