import { JiraClient } from "./jira-client.js";
import { GitHubClient } from "./github-client.js";
import { AIProcessor } from "./ai-processor.js";
import chalk from "chalk";
import ora from "ora";

interface IntegrationConfig {
  jira?: {
    host?: string;
    username?: string;
    password?: string;
  };
  github?: {
    token?: string;
  };
  ai?: {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
  };
  verbose?: boolean;
}

interface ConnectionResults {
  jira: boolean;
  github: boolean;
  ai: boolean;
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

interface SearchOptions {
  maxResults?: number;
}

export class IntegrationUtils {
  private config: IntegrationConfig;
  public jiraClient: JiraClient | null = null;
  public githubClient: GitHubClient | null = null;
  public aiProcessor: AIProcessor | null = null;

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.initializeClients();
  }

  private initializeClients(): void {
    // Initialize JIRA client if credentials are available
    if (
      this.config.jira?.host &&
      this.config.jira?.username &&
      this.config.jira?.password
    ) {
      this.jiraClient = new JiraClient({
        host: this.config.jira.host,
        username: this.config.jira.username,
        password: this.config.jira.password,
      });
    }

    // Initialize GitHub client if token is available
    if (this.config.github?.token) {
      this.githubClient = new GitHubClient(this.config.github.token);
    }

    // Initialize AI processor if API key is available
    if (this.config.ai?.apiKey) {
      this.aiProcessor = new AIProcessor(
        this.config.ai.apiKey,
        this.config.verbose,
        this.config.ai
      );
    }
  }

  async validateConnections(): Promise<ConnectionResults> {
    const results: ConnectionResults = {
      jira: false,
      github: false,
      ai: false,
    };

    if (this.jiraClient) {
      try {
        results.jira = await this.jiraClient.testConnection();
      } catch (error: any) {
        console.warn(
          chalk.yellow("JIRA connection test failed:", error.message)
        );
      }
    }

    if (this.githubClient) {
      try {
        // Test GitHub connection by getting user info
        await this.githubClient.octokit.rest.users.getAuthenticated();
        results.github = true;
      } catch (error: any) {
        console.warn(
          chalk.yellow("GitHub connection test failed:", error.message)
        );
      }
    }

    if (this.aiProcessor) {
      results.ai = true; // AI processor validation happens during use
    }

    return results;
  }

  async searchJiraEpics(
    query: string,
    options: SearchOptions = {}
  ): Promise<Epic[]> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora("Searching for JIRA epics...").start();

    try {
      const jql = `project = "${query}" AND type = Epic ORDER BY created DESC`;

      let searchResults: any;
      if (jiraClient.isPAT) {
        const response = await jiraClient.axios!.get("/rest/api/2/search", {
          params: {
            jql,
            fields:
              "summary,description,status,assignee,reporter,created,updated,labels,components",
            maxResults: options.maxResults || 50,
          },
        });
        searchResults = response.data;
      } else {
        searchResults = await jiraClient.jira!.searchJira(jql, {
          fields: [
            "summary",
            "description",
            "status",
            "assignee",
            "reporter",
            "created",
            "updated",
            "labels",
            "components",
          ],
          maxResults: options.maxResults || 50,
        });
      }

      const epics: Epic[] = searchResults.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || "",
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName || "Unassigned",
        reporter: issue.fields.reporter?.displayName || "Unknown",
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
        components: issue.fields.components.map((c: any) => c.name),
        url: `https://${this.config.jira?.host || "localhost"}/browse/${
          issue.key
        }`,
      }));

      spinner.succeed(`Found ${epics.length} epic(s)`);
      return epics;
    } catch (error: any) {
      spinner.fail("Failed to search JIRA epics");
      throw error;
    }
  }

  async getEpicChildren(epicKey: string): Promise<Ticket[]> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora(`Fetching children of epic ${epicKey}...`).start();

    try {
      const jql = `"Epic Link" = "${epicKey}" ORDER BY created ASC`;

      let searchResults: any;
      if (jiraClient.isPAT) {
        const response = await jiraClient.axios!.get("/rest/api/2/search", {
          params: {
            jql,
            fields:
              "summary,description,status,assignee,reporter,created,updated,labels,components,comment,priority,issuetype",
            maxResults: 100,
          },
        });
        searchResults = response.data;
      } else {
        searchResults = await jiraClient.jira!.searchJira(jql, {
          fields: [
            "summary",
            "description",
            "status",
            "assignee",
            "reporter",
            "created",
            "updated",
            "labels",
            "components",
            "comment",
            "priority",
            "issuetype",
          ],
          maxResults: 100,
        });
      }

      const children: Ticket[] = searchResults.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description || "",
        status: issue.fields.status.name,
        assignee: issue.fields.assignee?.displayName || null,
        reporter: issue.fields.reporter?.displayName || "Unknown",
        created: issue.fields.created,
        updated: issue.fields.updated,
        labels: issue.fields.labels || [],
        components: issue.fields.components.map((c: any) => c.name),
        priority: issue.fields.priority?.name || "None",
        issueType: issue.fields.issuetype.name,
        comments: issue.fields.comment?.comments || [],
        url: `https://${this.config.jira?.host || "localhost"}/browse/${
          issue.key
        }`,
      }));

      spinner.succeed(`Found ${children.length} child ticket(s)`);
      return children;
    } catch (error: any) {
      spinner.fail("Failed to fetch epic children");
      throw error;
    }
  }

  findAvailableTicket(childTickets: Ticket[]): Ticket | null {
    // Find the first ticket that doesn't have "in progress" indicators or closed status
    const inProgressStatuses = [
      "In Progress",
      "In Development",
      "In Review",
      "Testing",
      "Review",
      "Code Review",
    ];
    const closedStatuses = [
      "Closed",
      "Done",
      "Resolved",
      "Complete",
      "Completed",
      "Cancelled",
      "Rejected",
    ];
    const inProgressKeywords = [
      "claimed",
      "working on",
      "in progress",
      "started",
      "assigned",
    ];

    for (const ticket of childTickets) {
      // Check if status indicates closed/resolved
      if (
        closedStatuses.some((status) =>
          ticket.status.toLowerCase().includes(status.toLowerCase())
        )
      ) {
        continue;
      }

      // Check if status indicates in progress
      if (
        inProgressStatuses.some((status) =>
          ticket.status.toLowerCase().includes(status.toLowerCase())
        )
      ) {
        continue;
      }

      // Check if assignee exists
      if (ticket.assignee) {
        continue;
      }

      // Check comments for in-progress keywords
      const hasInProgressComment = ticket.comments.some((comment) =>
        inProgressKeywords.some((keyword) =>
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

  async addCommentToTicket(
    ticketKey: string,
    comment: string
  ): Promise<boolean> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora(`Adding comment to ${ticketKey}...`).start();

    try {
      const commentData = {
        body: comment,
      };

      if (jiraClient.isPAT) {
        await jiraClient.axios!.post(
          `/rest/api/2/issue/${ticketKey}/comment`,
          commentData
        );
      } else {
        await jiraClient.jira!.addComment(ticketKey, comment);
      }

      spinner.succeed(`Comment added to ${ticketKey}`);
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to add comment to ${ticketKey}`);
      throw error;
    }
  }

  async updateTicketStatus(
    ticketKey: string,
    statusName: string
  ): Promise<boolean> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora(
      `Updating ${ticketKey} status to ${statusName}...`
    ).start();

    try {
      // First, get available transitions for the ticket
      let transitions: any;
      if (jiraClient.isPAT) {
        const response = await jiraClient.axios!.get(
          `/rest/api/2/issue/${ticketKey}/transitions`
        );
        transitions = response.data.transitions;
      } else {
        // Create axios instance for basic auth
        const axios = await import("axios");
        const basicAuthAxios = axios.default.create({
          baseURL: `https://${this.config.jira?.host}`,
          auth: {
            username: this.config.jira?.username || "",
            password: this.config.jira?.password || "",
          },
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });
        const response = await basicAuthAxios.get(
          `/rest/api/2/issue/${ticketKey}/transitions`
        );
        transitions = response.data.transitions;
      }

      // Find the transition that matches the desired status
      const targetTransition = transitions.find(
        (transition: any) =>
          transition.to.name.toLowerCase() === statusName.toLowerCase()
      );

      if (!targetTransition) {
        spinner.warn(
          `No transition found to status '${statusName}' for ${ticketKey}`
        );
        return false;
      }

      // Perform the transition
      const transitionData = {
        transition: {
          id: targetTransition.id,
        },
      };

      if (jiraClient.isPAT) {
        await jiraClient.axios!.post(
          `/rest/api/2/issue/${ticketKey}/transitions`,
          transitionData
        );
      } else {
        // Create axios instance for basic auth
        const axios = await import("axios");
        const basicAuthAxios = axios.default.create({
          baseURL: `https://${this.config.jira?.host}`,
          auth: {
            username: this.config.jira?.username || "",
            password: this.config.jira?.password || "",
          },
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });
        await basicAuthAxios.post(
          `/rest/api/2/issue/${ticketKey}/transitions`,
          transitionData
        );
      }

      spinner.succeed(`Status updated to ${statusName} for ${ticketKey}`);
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to update status for ${ticketKey}`);
      throw error;
    }
  }

  async getCurrentUserAccountId(): Promise<string | null> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient;

    try {
      let response: any;

      if (jiraClient.isPAT) {
        // Use the /myself endpoint to get current user information
        response = await jiraClient.axios!.get(`/rest/api/2/myself`);
      } else {
        // Create axios instance for basic auth
        const axios = await import("axios");
        const basicAuthAxios = axios.default.create({
          baseURL: `https://${this.config.jira?.host}`,
          auth: {
            username: this.config.jira?.username || "",
            password: this.config.jira?.password || "",
          },
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });
        response = await basicAuthAxios.get(`/rest/api/2/myself`);
      }

      const currentUser = response.data;
      if (currentUser && currentUser.accountId) {
        if (this.config.verbose) {
          console.log(
            chalk.gray(
              `🔧 [VERBOSE] Current user: ${currentUser.displayName} (${currentUser.accountId})`
            )
          );
        }
        return currentUser.accountId;
      }

      return null;
    } catch (error: any) {
      if (this.config.verbose) {
        console.error(
          chalk.red(`Failed to get current user account ID:`),
          error.message
        );
      }
      return null;
    }
  }

  async getUserAccountId(username: string): Promise<string | null> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient;

    try {
      let response: any;

      if (jiraClient.isPAT) {
        response = await jiraClient.axios!.get(`/rest/api/2/user/search`, {
          params: {
            query: username,
          },
        });
      } else {
        // Create axios instance for basic auth
        const axios = await import("axios");
        const basicAuthAxios = axios.default.create({
          baseURL: `https://${this.config.jira?.host}`,
          auth: {
            username: this.config.jira?.username || "",
            password: this.config.jira?.password || "",
          },
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });
        response = await basicAuthAxios.get(`/rest/api/2/user/search`, {
          params: {
            query: username,
          },
        });
      }

      const users = response.data;
      if (users && users.length > 0) {
        return users[0].accountId;
      }

      return null;
    } catch (error: any) {
      if (this.config.verbose) {
        console.error(
          chalk.red(`Failed to get account ID for ${username}:`),
          error.message
        );
      }
      return null;
    }
  }

  async assignTicketToUser(
    ticketKey: string,
    username: string
  ): Promise<boolean> {
    if (!this.jiraClient) {
      throw new Error(
        "JIRA client not initialized. Check your JIRA configuration."
      );
    }

    const jiraClient = this.jiraClient; // Store reference to avoid undefined issues
    const spinner = ora(`Assigning ${ticketKey} to current user...`).start();

    try {
      // First, try to get the current user's accountId (works even in GDPR strict mode)
      let accountId = await this.getCurrentUserAccountId();

      let assignData: any;

      if (accountId) {
        // Use accountId for GDPR strict mode (preferred)
        assignData = {
          accountId: accountId,
        };
        if (this.config.verbose) {
          console.log(
            chalk.gray(
              `🔧 [VERBOSE] Using current user accountId: ${accountId}`
            )
          );
        }
      } else {
        // Fallback: try to search for user and get accountId
        accountId = await this.getUserAccountId(username);
        if (accountId) {
          assignData = {
            accountId: accountId,
          };
          if (this.config.verbose) {
            console.log(
              chalk.gray(
                `🔧 [VERBOSE] Using searched user accountId: ${accountId}`
              )
            );
          }
        } else {
          // Final fallback to name for older JIRA instances
          assignData = {
            name: username,
          };
          if (this.config.verbose) {
            console.log(
              chalk.gray(`🔧 [VERBOSE] Using username fallback: ${username}`)
            );
          }
        }
      }

      if (jiraClient.isPAT) {
        await jiraClient.axios!.put(
          `/rest/api/2/issue/${ticketKey}/assignee`,
          assignData
        );
      } else {
        // Create axios instance for basic auth
        const axios = await import("axios");
        const basicAuthAxios = axios.default.create({
          baseURL: `https://${this.config.jira?.host}`,
          auth: {
            username: this.config.jira?.username || "",
            password: this.config.jira?.password || "",
          },
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });
        await basicAuthAxios.put(
          `/rest/api/2/issue/${ticketKey}/assignee`,
          assignData
        );
      }

      spinner.succeed(`Ticket ${ticketKey} assigned to current user`);
      return true;
    } catch (error: any) {
      spinner.fail(`Failed to assign ${ticketKey} to current user`);

      // Provide more detailed error information
      if (this.config.verbose) {
        console.error(
          chalk.red(`Assignment error details:`),
          error.response?.data || error.message
        );
      }

      // Try to provide helpful guidance
      if (error.response?.status === 400) {
        console.error(
          chalk.yellow(
            `💡 JIRA GDPR strict mode may require specific account configuration`
          )
        );
      }

      throw error;
    }
  }

  async claimTicket(
    ticketKey: string,
    claimantName: string,
    username: string,
    dryRun: boolean = false
  ): Promise<boolean> {
    if (dryRun) {
      console.log(
        chalk.yellow(
          `[DRY RUN] Would claim ticket ${ticketKey} for ${claimantName}`
        )
      );
      console.log(chalk.yellow(`[DRY RUN] Would assign to: ${username}`));
      console.log(
        chalk.yellow(`[DRY RUN] Would update status to: In Progress`)
      );
      return true;
    }

    const results = {
      comment: false,
      assignment: false,
      status: false,
    };

    try {
      // Step 1: Add comment
      const claimMessage = `Ticket claimed by ${claimantName}`;
      results.comment = await this.addCommentToTicket(ticketKey, claimMessage);

      // Step 2: Assign to user
      try {
        results.assignment = await this.assignTicketToUser(ticketKey, username);
      } catch (assignError: any) {
        console.error(
          chalk.red(`❌ Assignment failed for ${ticketKey}:`),
          assignError.message
        );
        console.log(chalk.yellow(`💡 Continuing with status update...`));
      }

      // Step 3: Update status to In Progress
      results.status = await this.updateTicketStatus(ticketKey, "In Progress");

      // Report results
      if (results.comment && results.assignment && results.status) {
        console.log(chalk.green(`✅ Ticket ${ticketKey} successfully claimed`));
      } else {
        console.log(chalk.yellow(`⚠️  Ticket ${ticketKey} partially claimed:`));
        console.log(chalk.gray(`   Comment: ${results.comment ? "✅" : "❌"}`));
        console.log(
          chalk.gray(`   Assignment: ${results.assignment ? "✅" : "❌"}`)
        );
        console.log(chalk.gray(`   Status: ${results.status ? "✅" : "❌"}`));
      }
      return results.comment && results.status; // Success if at least comment and status work
    } catch (error: any) {
      console.error(
        chalk.red(`❌ Failed to claim ticket ${ticketKey}:`),
        error.message
      );
      throw error;
    }
  }

  async generateCodingPrompt(
    ticket: Ticket,
    epicContext: Epic | null = null
  ): Promise<string> {
    if (!this.aiProcessor) {
      throw new Error(
        "AI processor not initialized. Check your OpenAI configuration."
      );
    }

    const spinner = ora("Generating coding prompt...").start();

    try {
      const epicContextText = epicContext
        ? `\n\nEpic Context:\n${epicContext.summary}\n${epicContext.description}`
        : "";

      const prompt = `You are creating a detailed coding prompt for a development agent. Based on the following JIRA ticket, create a comprehensive prompt that will help a coding agent implement the described feature or fix.

Ticket: ${ticket.key}
Title: ${ticket.summary}
Description: ${ticket.description}
Priority: ${ticket.priority}
Issue Type: ${ticket.issueType}
Labels: ${ticket.labels.join(", ")}
Components: ${ticket.components.join(", ")}${epicContextText}

Generate a detailed coding prompt that includes:
1. Clear objective and requirements
2. Technical considerations and constraints
3. Implementation guidelines
4. Testing requirements
5. Definition of done
6. PR title formatting instructions

IMPORTANT: When creating the pull request, format the title as: "${
        ticket.key
      } {description of what is fixed}"

Make it actionable for a coding agent to implement.`;

      const { generateText } = await import("ai");
      const { text } = await generateText({
        model: this.aiProcessor.model,
        prompt,
        temperature: 0.3,
        maxTokens: 2000,
      });

      spinner.succeed("Coding prompt generated");
      return text;
    } catch (error: any) {
      spinner.fail("Failed to generate coding prompt");
      throw error;
    }
  }

  async writeToTempFile(content: string, filename?: string): Promise<string> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const tempDir = os.tmpdir();
    const tempFile = filename || `coding-prompt-${Date.now()}.md`;
    const tempPath = path.join(tempDir, tempFile);

    await fs.writeFile(tempPath, content, "utf8");

    return tempPath;
  }
}
