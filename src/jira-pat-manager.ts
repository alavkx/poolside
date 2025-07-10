import axios from 'axios';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';

export interface JiraPATConfig {
  host: string;
  username: string;
  password: string;
}

export interface PATResult {
  token: string;
  tokenId: string;
  expiresAt: string | null;
}

export interface PATInfo {
  tokenId: string;
  name: string;
  expiresAt: string | null;
  created: string;
}

export class JiraPATManager {
  private host: string;
  private username: string;
  private password: string;
  private baseUrl: string;

  constructor(config: JiraPATConfig) {
    this.host = config.host;
    this.username = config.username;
    this.password = config.password;
    this.baseUrl = `https://${this.host}`;
  }

  // Check if the current password is likely a PAT (starts with specific patterns)
  isPAT(password: string): boolean {
    // PATs are typically longer and have specific patterns
    return !!(
      (
        password &&
        (password.length > 20 ||
          password.match(/^[A-Za-z0-9]{20,}$/) !== null ||
          password.startsWith('ATATT'))
      ) // Atlassian Cloud PAT prefix
    );
  }

  // Test if current credentials work
  async testCredentials(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/rest/api/2/myself`, {
        auth: {
          username: this.username,
          password: this.password,
        },
        timeout: 10000,
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  // Create a new PAT using existing username/password
  async createPAT(
    tokenName = 'Release Notes Generator',
    expirationDays = 365
  ): Promise<PATResult> {
    const spinner = ora('Creating JIRA Personal Access Token...').start();

    try {
      const response = await axios.post(
        `${this.baseUrl}/rest/pat/latest/tokens`,
        {
          name: tokenName,
          expirationDuration: expirationDays,
        },
        {
          auth: {
            username: this.username,
            password: this.password,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.rawToken) {
        spinner.succeed('Personal Access Token created successfully');
        return {
          token: response.data.rawToken,
          tokenId: response.data.tokenId,
          expiresAt: response.data.expiresAt,
        };
      } else {
        throw new Error('Invalid response format from JIRA PAT API');
      }
    } catch (error: any) {
      spinner.fail('Failed to create Personal Access Token');

      if (error.response?.status === 401) {
        throw new Error('Authentication failed. Please check your JIRA username and password.');
      } else if (error.response?.status === 403) {
        throw new Error(
          'Permission denied. You may not have permission to create PATs, or PATs may be disabled.'
        );
      } else if (error.response?.status === 404) {
        throw new Error(
          'PAT endpoint not found. Your JIRA instance may not support PATs or may be an older version.'
        );
      } else {
        throw new Error(`Failed to create PAT: ${error.message}`);
      }
    }
  }

  // Interactive PAT setup workflow
  async setupPATWorkflow(): Promise<PATResult | null> {
    console.log(chalk.cyan('\n🔐 JIRA Personal Access Token Setup'));
    console.log(
      chalk.gray(
        'For better security, we recommend using Personal Access Tokens instead of passwords.'
      )
    );

    // Test current credentials first
    const spinner = ora('Testing current JIRA credentials...').start();
    const credentialsWork = await this.testCredentials();

    if (!credentialsWork) {
      spinner.fail('Current JIRA credentials are invalid');
      console.log(chalk.red('❌ Unable to authenticate with JIRA using current credentials.'));
      console.log(
        chalk.yellow('Please check your JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD settings.')
      );
      return null;
    }

    spinner.succeed('Current JIRA credentials are valid');

    // Check if already using PAT
    if (this.isPAT(this.password)) {
      console.log(chalk.green('✅ You are already using a Personal Access Token.'));
      return null;
    }

    // Offer to create PAT
    const { createPAT } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createPAT',
        message: 'Would you like to create a Personal Access Token for better security?',
        default: true,
      },
    ]);

    if (!createPAT) {
      console.log(chalk.yellow('⚠️  Continuing with password authentication (less secure).'));
      return null;
    }

    // Get PAT configuration
    const { tokenName, expirationDays } = await inquirer.prompt([
      {
        type: 'input',
        name: 'tokenName',
        message: 'Token name:',
        default: 'Release Notes Generator',
      },
      {
        type: 'list',
        name: 'expirationDays',
        message: 'Token expiration:',
        choices: [
          { name: '90 days (recommended)', value: 90 },
          { name: '180 days', value: 180 },
          { name: '365 days', value: 365 },
          { name: 'Never expires (not recommended)', value: null },
        ],
        default: 90,
      },
    ]);

    try {
      const patResult = await this.createPAT(tokenName, expirationDays);

      console.log(chalk.green('\n✅ Personal Access Token created successfully!'));
      console.log(chalk.blue('\n📋 Important: Save this information securely'));
      console.log(chalk.gray('Token ID:'), patResult.tokenId);
      console.log(
        chalk.gray('Expires:'),
        patResult.expiresAt ? new Date(patResult.expiresAt).toLocaleDateString() : 'Never'
      );
      console.log(chalk.yellow('\n🔑 Your new Personal Access Token:'));
      console.log(chalk.cyan(patResult.token));

      console.log(chalk.blue('\n📝 Next steps:'));
      console.log(chalk.gray('1. Copy the token above'));
      console.log(chalk.gray('2. Update your .env file: JIRA_PASSWORD=' + patResult.token));
      console.log(chalk.gray('3. Remove your old password from the .env file'));

      const { updateEnv } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'updateEnv',
          message: 'Would you like to automatically update your .env file?',
          default: true,
        },
      ]);

      if (updateEnv) {
        await this.updateEnvFile(patResult.token);
      }

      return patResult;
    } catch (error: any) {
      console.log(chalk.red('\n❌ Failed to create Personal Access Token:'));
      console.log(chalk.red(error.message));

      if (error.message.includes('PAT endpoint not found')) {
        console.log(
          chalk.yellow('\n💡 Your JIRA instance may not support PATs. This usually means:')
        );
        console.log(chalk.gray('• JIRA version is older than 8.14 (for Server/Data Center)'));
        console.log(chalk.gray('• PATs are disabled by administrator'));
        console.log(chalk.gray('• You are using JIRA Cloud (use API tokens instead)'));
      }

      return null;
    }
  }

  // Update .env file with new PAT
  async updateEnvFile(newToken: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = '.env';

      let envContent = '';
      try {
        envContent = await fs.readFile(path, 'utf8');
      } catch (error) {
        // .env doesn't exist, create it
        envContent = '';
      }

      // Replace or add JIRA_PASSWORD
      if (envContent.includes('JIRA_PASSWORD=')) {
        envContent = envContent.replace(/JIRA_PASSWORD=.*$/m, `JIRA_PASSWORD=${newToken}`);
      } else {
        envContent += `\nJIRA_PASSWORD=${newToken}`;
      }

      await fs.writeFile(path, envContent);
      console.log(chalk.green('✅ .env file updated with new Personal Access Token'));
    } catch (error: any) {
      console.log(chalk.yellow('⚠️  Could not automatically update .env file:'), error.message);
      console.log(chalk.gray('Please manually update JIRA_PASSWORD in your .env file'));
    }
  }

  // List existing PATs for the user
  async listPATs(): Promise<PATInfo[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/rest/pat/latest/tokens`, {
        auth: {
          username: this.username,
          password: this.password,
        },
        timeout: 10000,
      });

      return response.data || [];
    } catch (error: any) {
      console.warn('Could not fetch existing PATs:', error.message);
      return [];
    }
  }

  // Revoke a specific PAT
  async revokePAT(tokenId: string): Promise<boolean> {
    try {
      await axios.delete(`${this.baseUrl}/rest/pat/latest/tokens/${tokenId}`, {
        auth: {
          username: this.username,
          password: this.password,
        },
        timeout: 10000,
      });
      return true;
    } catch (error: any) {
      console.error('Failed to revoke PAT:', error.message);
      return false;
    }
  }
}
