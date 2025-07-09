import { IntegrationUtils } from './integration-utils.js';
import chalk from 'chalk';
import ora from 'ora';
import os from 'os';

interface EpicWorkflowConfig {
  jira: {
    host?: string;
    username?: string;
    password?: string;
  };
  github: {
    token?: string;
  };
  ai: {
    apiKey?: string;
    model: string;
    maxTokens: number;
  };
  verbose: boolean;
}

interface Epic {
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  url: string;
}

interface Ticket {
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string | null;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  priority: string;
  issueType: string;
  comments: Array<{ body: string }>;
  url: string;
}

interface ProcessEpicOptions {
  agentName?: string;
  claimantName?: string;
}

interface ProcessEpicResult {
  epic: Epic;
  ticket: Ticket;
  prompt: string;
  tempFile: string;
}

interface ListEpicsOptions {
  maxResults?: number;
}

interface EpicStatusResult {
  epic: Epic;
  childTickets: Ticket[];
  statusSummary: Record<string, number>;
  availableCount: number;
  inProgressCount: number;
}

export class EpicWorkflow {
  private config: EpicWorkflowConfig;
  private utils: IntegrationUtils;
  private verbose: boolean;

  constructor(config: EpicWorkflowConfig) {
    this.config = config;
    this.utils = new IntegrationUtils(config);
    this.verbose = config.verbose || false;
  }

  async processEpic(
    epicId: string,
    options: ProcessEpicOptions = {}
  ): Promise<ProcessEpicResult | null> {
    const agentName = options.agentName || 'Coding Agent';
    const claimantName = options.claimantName || agentName;

    console.log(chalk.blue(`🚀 Processing Epic: ${epicId}`));

    if (this.verbose) {
      console.log(chalk.gray(`Agent: ${agentName}`));
      console.log(chalk.gray(`Claimant: ${claimantName}`));
    }

    try {
      // Step 1: Validate connections
      await this.validateConnections();

      // Step 2: Search for the epic
      const epic = await this.findEpic(epicId);

      if (!epic) {
        throw new Error(`Epic ${epicId} not found`);
      }

      console.log(chalk.green(`✅ Found epic: ${epic.summary}`));

      // Step 3: Get epic children
      const childTickets = await this.utils.getEpicChildren(epicId);

      if (childTickets.length === 0) {
        console.log(chalk.yellow('⚠️  No child tickets found for this epic'));
        return null;
      }

      // Step 4: Find available ticket
      const availableTicket = this.utils.findAvailableTicket(childTickets);

      if (!availableTicket) {
        console.log(
          chalk.yellow('⚠️  No available tickets found (all tickets are in progress or assigned)')
        );
        return null;
      }

      console.log(
        chalk.green(
          `✅ Found available ticket: ${availableTicket.key} - ${availableTicket.summary}`
        )
      );

      // Step 5: Claim the ticket
      const claimMessage = `Ticket claimed by ${claimantName}`;
      await this.utils.addCommentToTicket(availableTicket.key, claimMessage);

      console.log(chalk.green(`✅ Ticket ${availableTicket.key} has been claimed`));

      // Step 6: Generate coding prompt
      const prompt = await this.utils.generateCodingPrompt(availableTicket, epic);

      // Step 7: Save to temp file and output
      const tempFile = await this.utils.writeToTempFile(prompt, `${availableTicket.key}-prompt.md`);

      console.log(chalk.green(`✅ Coding prompt saved to: ${tempFile}`));

      // Step 8: Output to stdout
      console.log(chalk.blue('\n📝 Generated Coding Prompt:'));
      console.log(chalk.gray('='.repeat(60)));
      console.log(prompt);
      console.log(chalk.gray('='.repeat(60)));

      return {
        epic,
        ticket: availableTicket,
        prompt,
        tempFile,
      };
    } catch (error: any) {
      console.error(chalk.red('❌ Epic workflow failed:'), error.message);
      if (this.verbose) {
        console.error(chalk.red('Stack trace:'), error.stack);
      }
      throw error;
    }
  }

  async validateConnections(): Promise<void> {
    const spinner = ora('Validating connections...').start();

    try {
      const connections = await this.utils.validateConnections();

      if (!connections.jira) {
        throw new Error('JIRA connection failed. Check your JIRA configuration.');
      }

      if (!connections.ai) {
        throw new Error('AI processor not available. Check your OpenAI configuration.');
      }

      spinner.succeed('All connections validated');

      if (this.verbose) {
        console.log(chalk.gray(`  • JIRA: ${connections.jira ? '✅' : '❌'}`));
        console.log(chalk.gray(`  • GitHub: ${connections.github ? '✅' : '❌'}`));
        console.log(chalk.gray(`  • AI: ${connections.ai ? '✅' : '❌'}`));
      }
    } catch (error: any) {
      spinner.fail('Connection validation failed');
      throw error;
    }
  }

  async findEpic(epicId: string): Promise<Epic | null> {
    // First try to get the epic directly by key
    try {
      const directEpic = await this.getEpicByKey(epicId);
      if (directEpic) {
        return directEpic;
      }
    } catch (error: any) {
      if (this.verbose) {
        console.log(chalk.gray(`Direct epic lookup failed, trying search: ${error.message}`));
      }
    }

    // If direct lookup fails, try searching by project
    try {
      const epics = await this.utils.searchJiraEpics(epicId);
      return epics.find((epic) => epic.key === epicId) || epics[0] || null;
    } catch (error: any) {
      if (this.verbose) {
        console.log(chalk.gray(`Epic search failed: ${error.message}`));
      }
      return null;
    }
  }

  async getEpicByKey(epicKey: string): Promise<Epic> {
    if (!this.utils.jiraClient) {
      throw new Error('JIRA client not initialized');
    }

    const jiraClient = this.utils.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora(`Fetching epic ${epicKey}...`).start();

    try {
      let issue: any;

      if (jiraClient.isPAT) {
        const response = await jiraClient.axios!.get(`/rest/api/2/issue/${epicKey}`);
        issue = response.data;
      } else {
        issue = await jiraClient.jira!.findIssue(epicKey);
      }

      // Verify it's an epic
      if (issue.fields.issuetype.name !== 'Epic') {
        throw new Error(`${epicKey} is not an Epic (it's a ${issue.fields.issuetype.name})`);
      }

      const epic: Epic = {
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || '',
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        reporter: issue.fields.reporter?.displayName || 'Unknown',
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
        components: issue.fields.components.map((c: any) => c.name),
        url: `https://${this.config.jira.host || 'localhost'}/browse/${issue.key}`,
      };

      spinner.succeed(`Epic ${epicKey} retrieved`);
      return epic;
    } catch (error: any) {
      spinner.fail(`Failed to fetch epic ${epicKey}`);
      throw error;
    }
  }

  async listEpics(projectKey: string, options: ListEpicsOptions = {}): Promise<Epic[]> {
    console.log(chalk.blue(`🔍 Listing epics for project: ${projectKey}`));

    try {
      const epics = await this.utils.searchJiraEpics(projectKey, options);

      if (epics.length === 0) {
        console.log(chalk.yellow('No epics found'));
        return [];
      }

      console.log(chalk.green(`\n📋 Found ${epics.length} epic(s):`));

      epics.forEach((epic, index) => {
        console.log(`\n${index + 1}. ${chalk.cyan(epic.key)} - ${epic.summary}`);
        console.log(`   Status: ${epic.status}`);
        console.log(`   Assignee: ${epic.assignee}`);
        console.log(`   Created: ${new Date(epic.created).toDateString()}`);
        console.log(`   URL: ${epic.url}`);

        if (epic.description && epic.description.length > 0) {
          const shortDesc = epic.description.substring(0, 100);
          console.log(`   Description: ${shortDesc}${epic.description.length > 100 ? '...' : ''}`);
        }
      });

      return epics;
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to list epics:'), error.message);
      throw error;
    }
  }

  async getEpicStatus(epicId: string): Promise<EpicStatusResult | null> {
    console.log(chalk.blue(`📊 Getting status for epic: ${epicId}`));

    try {
      const epic = await this.findEpic(epicId);

      if (!epic) {
        console.log(chalk.yellow(`Epic ${epicId} not found`));
        return null;
      }

      const childTickets = await this.utils.getEpicChildren(epicId);

      // Analyze ticket statuses
      const statusSummary = childTickets.reduce(
        (acc, ticket) => {
          const status = ticket.status;
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const availableTickets = childTickets.filter(
        (ticket) => this.utils.findAvailableTicket([ticket]) !== null
      );

      const inProgressTickets = childTickets.filter(
        (ticket) => ticket.assignee || ticket.status.toLowerCase().includes('progress')
      );

      console.log(chalk.green(`\n📈 Epic Status: ${epic.key} - ${epic.summary}`));
      console.log(`Epic Status: ${epic.status}`);
      console.log(`Total Child Tickets: ${childTickets.length}`);
      console.log(`Available Tickets: ${availableTickets.length}`);
      console.log(`In Progress Tickets: ${inProgressTickets.length}`);

      console.log('\n📊 Status Breakdown:');
      Object.entries(statusSummary).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });

      if (availableTickets.length > 0) {
        console.log(chalk.green('\n🎯 Next Available Ticket:'));
        const nextTicket = this.utils.findAvailableTicket(childTickets);
        if (nextTicket) {
          console.log(`  ${nextTicket.key} - ${nextTicket.summary}`);
          console.log(`  Priority: ${nextTicket.priority}`);
          console.log(`  Type: ${nextTicket.issueType}`);
        }
      }

      return {
        epic,
        childTickets,
        statusSummary,
        availableCount: availableTickets.length,
        inProgressCount: inProgressTickets.length,
      };
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get epic status:'), error.message);
      throw error;
    }
  }
}
