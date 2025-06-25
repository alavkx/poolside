import JiraApi from 'jira-client';
import axios from 'axios';
import ora from 'ora';
import chalk from 'chalk';
import { JiraPATManager } from './jira-pat-manager.js';

export class JiraClient {
  constructor(config) {
    if (!config.host) {
      throw new Error('JIRA host is required. Set JIRA_HOST environment variable or pass jiraBaseUrl option.');
    }
    if (!config.username || !config.password) {
      throw new Error('JIRA credentials are required. Set JIRA_USERNAME and JIRA_PASSWORD environment variables.');
    }

    this.config = config;
    this.patManager = new JiraPATManager(config);
    
    // Check if using PAT or traditional auth
    this.isPAT = this.patManager.isPAT(config.password);
    
    if (this.isPAT) {
      // Use axios for PAT-based requests (Bearer token)
      this.axios = axios.create({
        baseURL: `https://${config.host}`,
        headers: {
          'Authorization': `Bearer ${config.password}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
    } else {
      // Use traditional jira-client for username/password
      this.jira = new JiraApi({
        protocol: 'https',
        host: config.host,
        username: config.username,
        password: config.password,
        apiVersion: '2',
        strictSSL: true
      });
    }
  }

  async getTicketsMetadata(jiraKeys) {
    if (!jiraKeys || jiraKeys.length === 0) {
      return [];
    }

    const spinner = ora(`Fetching ${jiraKeys.length} JIRA tickets...`).start();
    
    try {
      const tickets = await Promise.allSettled(
        jiraKeys.map(async (key) => {
          try {
            let issue;
            
            if (this.isPAT) {
              // Use axios with Bearer token for PAT authentication
              const response = await this.axios.get(`/rest/api/2/issue/${key}`);
              issue = response.data;
            } else {
              // Use traditional jira-client
              issue = await this.jira.findIssue(key);
            }
            
            return {
              key: issue.key,
              summary: issue.fields.summary,
              description: issue.fields.description || '',
              status: issue.fields.status.name,
              priority: issue.fields.priority?.name || 'None',
              assignee: issue.fields.assignee?.displayName || 'Unassigned',
              reporter: issue.fields.reporter?.displayName || 'Unknown',
              created: issue.fields.created,
              updated: issue.fields.updated,
              resolved: issue.fields.resolutiondate,
              issueType: issue.fields.issuetype.name,
              labels: issue.fields.labels || [],
              components: issue.fields.components.map(c => c.name),
              fixVersions: issue.fields.fixVersions.map(v => v.name),
              url: `https://${this.config.host}/browse/${issue.key}`
            };
          } catch (error) {
            console.warn(`Failed to fetch JIRA ticket ${key}:`, error.message);
            return null;
          }
        })
      );

      const validTickets = tickets
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);

      const failedCount = tickets.length - validTickets.length;
      if (failedCount > 0) {
        spinner.warn(`Fetched ${validTickets.length} JIRA tickets (${failedCount} failed)`);
      } else {
        spinner.succeed(`Fetched ${validTickets.length} JIRA tickets`);
      }

      return validTickets;
    } catch (error) {
      spinner.fail('Failed to fetch JIRA tickets');
      throw error;
    }
  }

  // Group tickets by issue type for better organization
  groupTicketsByType(tickets) {
    return tickets.reduce((groups, ticket) => {
      const type = ticket.issueType;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(ticket);
      return groups;
    }, {});
  }

  // Setup PAT workflow if not using PAT already
  async setupPATIfNeeded() {
    if (!this.isPAT) {
      return await this.patManager.setupPATWorkflow();
    }
    return null;
  }

  // Test JIRA connection and suggest PAT setup if credentials fail
  async testConnection() {
    try {
      if (this.isPAT) {
        const response = await this.axios.get('/rest/api/2/myself');
        return response.status === 200;
      } else {
        const user = await this.jira.getCurrentUser();
        return !!user;
      }
    } catch (error) {
      // If credentials fail and not using PAT, suggest PAT setup
      if (!this.isPAT && (error.response?.status === 401 || error.response?.status === 403)) {
        console.log(chalk.yellow('\n⚠️  JIRA authentication failed with username/password.'));
        console.log(chalk.blue('💡 Consider setting up a Personal Access Token for better security and reliability.'));
        
        try {
          await this.patManager.setupPATWorkflow();
        } catch (patError) {
          console.log(chalk.gray('Continuing with existing credentials...'));
        }
      }
      return false;
    }
  }
} 
