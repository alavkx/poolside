import { JiraClient } from './jira-client.js';
import { GitHubClient } from './github-client.js';
import { AIProcessor } from './ai-processor.js';
import chalk from 'chalk';
import ora from 'ora';

export class IntegrationUtils {
  constructor(config) {
    this.config = config;
    this.jiraClient = null;
    this.githubClient = null;
    this.aiProcessor = null;
    
    this.initializeClients();
  }

  initializeClients() {
    // Initialize JIRA client if credentials are available
    if (this.config.jira?.host && this.config.jira?.username && this.config.jira?.password) {
      this.jiraClient = new JiraClient(this.config.jira);
    }
    
    // Initialize GitHub client if token is available
    if (this.config.github?.token) {
      this.githubClient = new GitHubClient(this.config.github.token);
    }
    
    // Initialize AI processor if API key is available
    if (this.config.ai?.apiKey) {
      this.aiProcessor = new AIProcessor(this.config.ai.apiKey, this.config.verbose, this.config.ai);
    }
  }

  async validateConnections() {
    const results = {
      jira: false,
      github: false,
      ai: false
    };

    if (this.jiraClient) {
      try {
        results.jira = await this.jiraClient.testConnection();
      } catch (error) {
        console.warn(chalk.yellow('JIRA connection test failed:', error.message));
      }
    }

    if (this.githubClient) {
      try {
        // Test GitHub connection by getting user info
        await this.githubClient.octokit.rest.user.getAuthenticated();
        results.github = true;
      } catch (error) {
        console.warn(chalk.yellow('GitHub connection test failed:', error.message));
      }
    }

    if (this.aiProcessor) {
      results.ai = true; // AI processor validation happens during use
    }

    return results;
  }

  async searchJiraEpics(query, options = {}) {
    if (!this.jiraClient) {
      throw new Error('JIRA client not initialized. Check your JIRA configuration.');
    }

    const spinner = ora('Searching for JIRA epics...').start();
    
    try {
      const jql = `project = "${query}" AND type = Epic ORDER BY created DESC`;
      
      let searchResults;
      if (this.jiraClient.isPAT) {
        const response = await this.jiraClient.axios.get('/rest/api/2/search', {
          params: {
            jql,
            fields: 'summary,description,status,assignee,reporter,created,updated,labels,components',
            maxResults: options.maxResults || 50
          }
        });
        searchResults = response.data;
      } else {
        searchResults = await this.jiraClient.jira.searchJira(jql, {
          fields: ['summary', 'description', 'status', 'assignee', 'reporter', 'created', 'updated', 'labels', 'components'],
          maxResults: options.maxResults || 50
        });
      }

      const epics = searchResults.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || '',
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        reporter: issue.fields.reporter?.displayName || 'Unknown',
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
        components: issue.fields.components.map(c => c.name),
        url: `https://${this.config.jira.host}/browse/${issue.key}`
      }));

      spinner.succeed(`Found ${epics.length} epic(s)`);
      return epics;
    } catch (error) {
      spinner.fail('Failed to search JIRA epics');
      throw error;
    }
  }

  async getEpicChildren(epicKey) {
    if (!this.jiraClient) {
      throw new Error('JIRA client not initialized. Check your JIRA configuration.');
    }

    const spinner = ora(`Fetching children of epic ${epicKey}...`).start();
    
    try {
      const jql = `"Epic Link" = "${epicKey}" ORDER BY created ASC`;
      
      let searchResults;
      if (this.jiraClient.isPAT) {
        const response = await this.jiraClient.axios.get('/rest/api/2/search', {
          params: {
            jql,
            fields: 'summary,description,status,assignee,reporter,created,updated,labels,components,comment,priority,issuetype',
            maxResults: 100
          }
        });
        searchResults = response.data;
      } else {
        searchResults = await this.jiraClient.jira.searchJira(jql, {
          fields: ['summary', 'description', 'status', 'assignee', 'reporter', 'created', 'updated', 'labels', 'components', 'comment', 'priority', 'issuetype'],
          maxResults: 100
        });
      }

      const children = searchResults.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || '',
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName || null,
        reporter: issue.fields.reporter?.displayName || 'Unknown',
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
        components: issue.fields.components.map(c => c.name),
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        comments: issue.fields.comment?.comments || [],
        url: `https://${this.config.jira.host}/browse/${issue.key}`
      }));

      spinner.succeed(`Found ${children.length} child ticket(s)`);
      return children;
    } catch (error) {
      spinner.fail('Failed to fetch epic children');
      throw error;
    }
  }

  findAvailableTicket(childTickets) {
    // Find the first ticket that doesn't have "in progress" indicators
    const inProgressStatuses = ['In Progress', 'In Development', 'In Review', 'Testing', 'Review', 'Code Review'];
    const inProgressKeywords = ['claimed', 'working on', 'in progress', 'started', 'assigned'];
    
    for (const ticket of childTickets) {
      // Check if status indicates in progress
      if (inProgressStatuses.some(status => 
        ticket.status.toLowerCase().includes(status.toLowerCase())
      )) {
        continue;
      }
      
      // Check if assignee exists
      if (ticket.assignee) {
        continue;
      }
      
      // Check comments for in-progress keywords
      const hasInProgressComment = ticket.comments.some(comment => 
        inProgressKeywords.some(keyword => 
          comment.body.toLowerCase().includes(keyword)
        )
      );
      
      if (hasInProgressComment) {
        continue;
      }
      
      // This ticket appears to be available
      return ticket;
    }
    
    return null;
  }

  async addCommentToTicket(ticketKey, comment) {
    if (!this.jiraClient) {
      throw new Error('JIRA client not initialized. Check your JIRA configuration.');
    }

    const spinner = ora(`Adding comment to ${ticketKey}...`).start();
    
    try {
      const commentData = {
        body: comment
      };

      if (this.jiraClient.isPAT) {
        await this.jiraClient.axios.post(`/rest/api/2/issue/${ticketKey}/comment`, commentData);
      } else {
        await this.jiraClient.jira.addComment(ticketKey, comment);
      }

      spinner.succeed(`Comment added to ${ticketKey}`);
      return true;
    } catch (error) {
      spinner.fail(`Failed to add comment to ${ticketKey}`);
      throw error;
    }
  }

  async generateCodingPrompt(ticket, epicContext = null) {
    if (!this.aiProcessor) {
      throw new Error('AI processor not initialized. Check your OpenAI configuration.');
    }

    const spinner = ora('Generating coding prompt...').start();
    
    try {
      const epicContextText = epicContext 
        ? `\n\nEpic Context:\n${epicContext.summary}\n${epicContext.description}`
        : '';

      const prompt = `You are creating a detailed coding prompt for a development agent. Based on the following JIRA ticket, create a comprehensive prompt that will help a coding agent implement the described feature or fix.

Ticket: ${ticket.key}
Title: ${ticket.summary}
Description: ${ticket.description}
Priority: ${ticket.priority}
Issue Type: ${ticket.issueType}
Labels: ${ticket.labels.join(', ')}
Components: ${ticket.components.join(', ')}${epicContextText}

Generate a detailed coding prompt that includes:
1. Clear objective and requirements
2. Technical considerations and constraints
3. Implementation guidelines
4. Testing requirements
5. Definition of done

Make it actionable for a coding agent to implement.`;

      const { generateText } = await import('ai');
      const { text } = await generateText({
        model: this.aiProcessor.model,
        prompt,
        temperature: 0.3,
        maxTokens: 2000
      });

      spinner.succeed('Coding prompt generated');
      return text;
    } catch (error) {
      spinner.fail('Failed to generate coding prompt');
      throw error;
    }
  }

  async writeToTempFile(content, filename = null) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = os.tmpdir();
    const tempFile = filename || `coding-prompt-${Date.now()}.md`;
    const tempPath = path.join(tempDir, tempFile);
    
    await fs.writeFile(tempPath, content, 'utf8');
    
    return tempPath;
  }
}