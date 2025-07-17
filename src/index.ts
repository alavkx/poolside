#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { EpicWorkflow } from "./epic-workflow.js";
import { generateMultiRepoReleaseNotes } from "./release-notes-generator.js";
import { IntegrationUtils } from "./integration-utils.js";

dotenv.config();

interface ValidationResult {
  key: string;
  description: string;
}

interface WorkflowConfig {
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

interface ReleaseNotesConfig {
  releaseConfig: {
    month?: string;
    outputFile?: string;
    title?: string;
    description?: string;
    includeTableOfContents: boolean;
    includeSummary: boolean;
  };
  aiConfig: {
    maxTokens: number;
    batchSize: number;
    model: string;
  };
  repositories: Array<{
    name: string;
    repo: string;
    description?: string;
    priority?: number;
    includeInSummary?: boolean;
    categories?: Record<string, string>;
  }>;
  jiraConfig: {
    enabled: boolean;
    baseUrl?: string;
    priorityMapping?: Record<string, string>;
  };
}

type RequiredFor = "epic" | "release-notes" | "all";

// Validate environment configuration
function validateConfig(requiredFor: RequiredFor = "all"): void {
  const baseVars: Record<string, string> = {
    POOLSIDE_OPENAI_API_KEY: "OpenAI API Key",
    POOLSIDE_AI_MODEL: "AI Model",
    POOLSIDE_AI_MAX_TOKENS: "AI Max Tokens",
  };

  const jiraVars: Record<string, string> = {
    POOLSIDE_JIRA_HOST: "JIRA Server Host",
    POOLSIDE_JIRA_USERNAME: "JIRA Username",
    POOLSIDE_JIRA_PASSWORD: "JIRA Password/Token",
  };

  const githubVars: Record<string, string> = {
    POOLSIDE_GITHUB_TOKEN: "GitHub Personal Access Token",
  };

  // Only POOLSIDE_OPENAI_API_KEY is truly required - other vars are conditional
  let requiredVars = {
    POOLSIDE_OPENAI_API_KEY: baseVars.POOLSIDE_OPENAI_API_KEY,
  };
  let optionalVars: typeof baseVars = {
    POOLSIDE_AI_MODEL: baseVars.POOLSIDE_AI_MODEL,
    POOLSIDE_AI_MAX_TOKENS: baseVars.POOLSIDE_AI_MAX_TOKENS,
  };

  if (requiredFor === "epic" || requiredFor === "all") {
    requiredVars = { ...requiredVars, ...jiraVars };
    optionalVars = { ...optionalVars, ...githubVars };
  } else if (requiredFor === "release-notes") {
    requiredVars = { ...requiredVars, ...githubVars };
    optionalVars = { ...optionalVars, ...jiraVars };
  }

  const missing: ValidationResult[] = [];
  const optional: ValidationResult[] = [];

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
    console.log(chalk.red("\n❌ Missing required configuration:"));
    console.log(chalk.red("══════════════════════════════════\n"));

    missing.forEach(({ key, description }) => {
      console.log(chalk.red(`• ${description}`));
      console.log(chalk.cyan(`  ${key}=your_value_here`));
      console.log("");
    });

    console.log(chalk.yellow("📋 Setup Instructions:"));
    console.log(chalk.yellow("═══════════════════════\n"));

    console.log(chalk.white("1. Copy the example environment file:"));
    console.log(chalk.gray("   cp env.example .env\n"));

    console.log(chalk.white("2. Edit .env and add your credentials:\n"));

    missing.forEach(({ key }) => {
      console.log(chalk.cyan(`   ${key}=your_value_here`));
    });

    console.log("\n" + chalk.white("3. Get your credentials:"));
    console.log(
      chalk.gray("   • OpenAI API Key: https://platform.openai.com/api-keys")
    );
    console.log(
      chalk.gray("   • GitHub Token: https://github.com/settings/tokens")
    );
    console.log(chalk.gray("   • JIRA Host: Your JIRA server hostname"));
    console.log(chalk.gray("   • JIRA Username: Your JIRA username"));
    console.log(
      chalk.gray(
        "   • JIRA Password: Your JIRA password or Personal Access Token"
      )
    );

    console.log(
      "\n" +
        chalk.white("For detailed setup instructions, see the README.md file.")
    );

    process.exit(1);
  }

  if (optional.length > 0) {
    console.log(chalk.yellow("\n⚠️  Optional integrations not configured:"));
    optional.forEach(({ key, description }) => {
      console.log(chalk.gray(`   • ${description}: ${key}`));
    });
    console.log(
      chalk.gray(
        "\n   Some features may be limited without these credentials.\n"
      )
    );
  }
}

function createWorkflowConfig(): WorkflowConfig {
  return {
    jira: {
      host: process.env.POOLSIDE_JIRA_HOST?.replace(/^https?:\/\//, ""),
      username: process.env.POOLSIDE_JIRA_USERNAME,
      password: process.env.POOLSIDE_JIRA_PASSWORD,
    },
    github: {
      token: process.env.POOLSIDE_GITHUB_TOKEN,
    },
    ai: {
      apiKey: process.env.POOLSIDE_OPENAI_API_KEY,
      model: process.env.POOLSIDE_AI_MODEL || "gpt-4o",
      maxTokens: Number.parseInt(process.env.POOLSIDE_AI_MAX_TOKENS || "4000"),
    },
    verbose: false,
  };
}

async function loadReleaseNotesConfig(
  configPath: string
): Promise<ReleaseNotesConfig> {
  try {
    const configData = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(configData) as ReleaseNotesConfig;

    // Validate required config structure
    if (!config.repositories || !Array.isArray(config.repositories)) {
      throw new Error('Config must contain a "repositories" array');
    }

    if (config.repositories.length === 0) {
      throw new Error("At least one repository must be configured");
    }

    // Validate each repository config
    config.repositories.forEach((repo, index) => {
      if (!repo.name || !repo.repo) {
        throw new Error(
          `Repository at index ${index} missing required fields: name, repo`
        );
      }

      if (!repo.repo.includes("/")) {
        throw new Error(
          `Repository "${repo.repo}" must be in format "owner/repo"`
        );
      }
    });

    // Set defaults
    config.releaseConfig = {
      ...config.releaseConfig,
      includeTableOfContents:
        config.releaseConfig.includeTableOfContents ?? true,
      includeSummary: config.releaseConfig.includeSummary ?? true,
    };

    config.aiConfig = {
      ...config.aiConfig,
      maxTokens: config.aiConfig.maxTokens ?? 8000,
      batchSize: config.aiConfig.batchSize ?? 3,
      model: config.aiConfig.model ?? "gpt-4o",
    };

    return config;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Config file not found: ${configPath}. Create one using config.example.json as a template.`
      );
    }
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const program = new Command();

program
  .name("poolside")
  .description(
    "CLI tool for automating workflows with productivity tools like JIRA and GitHub"
  )
  .version("2.0.0");

// Epic Automation Workflow Commands
program
  .command("process-epic <epic-id>")
  .description(
    "Process a JIRA epic to claim the next available ticket and generate a coding prompt"
  )
  .option(
    "-a, --agent <name>",
    "Name of the agent claiming the ticket",
    "Coding Agent"
  )
  .option("-c, --claimant <name>", "Name to use when claiming the ticket")
  .option("--dry-run", "Preview changes without actually claiming the ticket")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (
      epicId: string,
      options: {
        agent: string;
        claimant?: string;
        dryRun?: boolean;
        verbose?: boolean;
      }
    ) => {
      try {
        validateConfig("epic");

        const config = createWorkflowConfig();
        config.verbose = options.verbose || false;

        const workflow = new EpicWorkflow(config);
        const result = await workflow.processEpic(epicId, {
          agentName: options.agent,
          claimantName: options.claimant || options.agent,
          dryRun: options.dryRun,
        });

        if (result) {
          console.log(
            chalk.green("\n✅ Epic workflow completed successfully!")
          );
          console.log(chalk.blue(`📋 Epic: ${result.epic.key}`));
          console.log(
            chalk.blue(`🎫 Ticket: ${result.ticket.key} - ${result.ticket.url}`)
          );
          console.log(chalk.blue(`📄 Prompt file: ${result.tempFile}`));
        } else {
          console.log(
            chalk.yellow(
              "\n⚠️  Epic workflow completed but no ticket was processed"
            )
          );
        }
      } catch (error: any) {
        console.error(chalk.red("❌ Error processing epic:"), error.message);
        process.exit(1);
      }
    }
  );

program
  .command("process-issue <issue-id>")
  .description(
    "Process a JIRA issue to claim it and generate a coding prompt"
  )
  .option(
    "-a, --agent <name>",
    "Name of the agent claiming the issue",
    "Coding Agent"
  )
  .option("-c, --claimant <name>", "Name to use when claiming the issue")
  .option("--dry-run", "Preview changes without actually claiming the issue")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (
      issueId: string,
      options: {
        agent: string;
        claimant?: string;
        dryRun?: boolean;
        verbose?: boolean;
      }
    ) => {
      try {
        validateConfig("epic");

        const config = createWorkflowConfig();
        config.verbose = options.verbose || false;

        const utils = new IntegrationUtils(config);
        const result = await utils.processIssue(issueId, {
          agentName: options.agent,
          claimantName: options.claimant || options.agent,
          dryRun: options.dryRun,
        });

        if (result) {
          console.log(
            chalk.green("\n✅ Issue workflow completed successfully!")
          );
          console.log(chalk.blue(`🎫 Issue: ${result.issue.key}`));
          console.log(chalk.blue(`📄 Prompt file: ${result.tempFile}`));
        } else {
          console.log(
            chalk.yellow(
              "\n⚠️  Issue workflow completed but no issue was processed"
            )
          );
        }
      } catch (error: any) {
        console.error(chalk.red("❌ Error processing issue:"), error.message);
        process.exit(1);
      }
    }
  );

program
  .command("list-epics <project-key>")
  .description("List all epics for a JIRA project")
  .option("-l, --limit <number>", "Maximum number of epics to return", "20")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (
      projectKey: string,
      options: { limit: string; verbose?: boolean }
    ) => {
      try {
        validateConfig("epic");

        const config = createWorkflowConfig();
        config.verbose = options.verbose || false;

        const workflow = new EpicWorkflow(config);
        await workflow.listEpics(projectKey, {
          maxResults: Number.parseInt(options.limit),
        });
      } catch (error: any) {
        console.error(chalk.red("❌ Error listing epics:"), error.message);
        process.exit(1);
      }
    }
  );

program
  .command("epic-status <epic-id>")
  .description("Get the status of a JIRA epic and its child tickets")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(async (epicId: string, options: { verbose?: boolean }) => {
    try {
      validateConfig("epic");

      const config = createWorkflowConfig();
      config.verbose = options.verbose || false;

      const workflow = new EpicWorkflow(config);
      await workflow.getEpicStatus(epicId);
    } catch (error: any) {
      console.error(chalk.red("❌ Error getting epic status:"), error.message);
      process.exit(1);
    }
  });

program
  .command("cursor-prompt <epic-id>")
  .description(
    "Generate a prompt template for Cursor agents to run the epic workflow"
  )
  .action((epicId: string) => {
    const prompt = `# Poolside Epic Workflow Instructions

You are a coding assistant helping to implement tickets from a JIRA epic using the poolside CLI automation tool.

## Your Task

1. **Run the poolside CLI command** to get the next available ticket and coding prompt:
   \`\`\`bash
   npx poolside@latest process-epic ${epicId}
   \`\`\`

2. **Use the generated prompt**: The command will output a detailed coding prompt that includes:
   - Epic context and background
   - Specific ticket requirements
   - Implementation guidelines
   - Definition of done
   - PR formatting instructions

3. **Implement the solution** based on the generated prompt

4. **Create a pull request** with the title format specified in the prompt (usually: \`TICKET-KEY description\`)

## What the poolside command does:
- Finds the next available ticket from the epic
- Claims the ticket automatically
- Generates a comprehensive coding prompt using AI
- Outputs the prompt for you to follow

## Important Notes:
- The poolside command will automatically claim the ticket in JIRA
- Follow the generated prompt exactly for best results
- The prompt includes specific PR title formatting requirements
- If no tickets are available, the command will let you know

## Ready to start?
Run the command above and follow the generated prompt to complete your implementation.`;

    console.log(prompt);
  });

// Release Notes Workflow Commands
program
  .command("generate-release-notes")
  .description("Generate release notes for multiple repositories")
  .requiredOption("-c, --config <file>", "Configuration file path (JSON)")
  .option("-m, --month <month>", "Override month from config (YYYY-MM)")
  .option("-o, --output <file>", "Override output file from config")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (options: {
      config: string;
      month?: string;
      output?: string;
      verbose?: boolean;
    }) => {
      try {
        validateConfig("release-notes");

        console.log(
          chalk.blue("🚀 Starting multi-repository release notes generation...")
        );
        console.log(chalk.gray(`Config file: ${options.config}`));

        const config = await loadReleaseNotesConfig(options.config);

        // Override config with CLI options if provided
        if (options.month) {
          config.releaseConfig.month = options.month;
        }
        if (options.output) {
          config.releaseConfig.outputFile = options.output;
        }

        console.log(chalk.blue(`\n📊 Configuration loaded successfully:`));
        console.log(
          chalk.gray(`   • Repositories: ${config.repositories.length}`)
        );
        console.log(
          chalk.gray(
            `   • Target month: ${
              config.releaseConfig.month || getCurrentMonth()
            }`
          )
        );
        console.log(
          chalk.gray(
            `   • Output file: ${
              config.releaseConfig.outputFile || "release-notes.md"
            }`
          )
        );
        console.log(chalk.gray(`   • AI Model: ${config.aiConfig.model}`));

        await generateMultiRepoReleaseNotes({
          ...config,
          verbose: options.verbose || false,
        });

        console.log(
          chalk.green(
            "\n✅ Multi-repository release notes generated successfully!"
          )
        );
      } catch (error: any) {
        console.error(
          chalk.red("❌ Error generating release notes:"),
          error.message
        );
        process.exit(1);
      }
    }
  );

// Legacy single-repo command for backward compatibility
program
  .command("generate-single-repo")
  .description("Generate release notes for a single repository (legacy)")
  .requiredOption("-r, --repo <repo>", "GitHub repository (owner/repo)")
  .option(
    "-m, --month <month>",
    "Month to generate for (YYYY-MM)",
    getCurrentMonth()
  )
  .option("-o, --output <file>", "Output file", "release-notes.md")
  .option("--jira-base-url <url>", "JIRA base URL (overrides env var)")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (options: {
      repo: string;
      month: string;
      output: string;
      jiraBaseUrl?: string;
      verbose?: boolean;
    }) => {
      try {
        validateConfig("release-notes");

        console.log(
          chalk.yellow(
            "⚠️  Using legacy single-repo mode. Consider switching to config-driven multi-repo mode."
          )
        );
        console.log(chalk.blue("🚀 Starting release notes generation..."));
        console.log(chalk.gray(`Repository: ${options.repo}`));
        console.log(chalk.gray(`Month: ${options.month}`));
        console.log(chalk.gray(`Output: ${options.output}`));

        // Create a minimal config for backward compatibility
        const legacyConfig: ReleaseNotesConfig = {
          releaseConfig: {
            month: options.month,
            outputFile: options.output,
            title: "Release Notes",
            description: "Generated release notes",
            includeTableOfContents: false,
            includeSummary: true,
          },
          aiConfig: {
            maxTokens: 4000,
            batchSize: 5,
            model: "gpt-4o-mini",
          },
          repositories: [
            {
              name: options.repo.split("/")[1],
              repo: options.repo,
              description: "",
              priority: 1,
              includeInSummary: true,
            },
          ],
          jiraConfig: {
            enabled: true,
            baseUrl: options.jiraBaseUrl,
          },
        };

        await generateMultiRepoReleaseNotes({
          ...legacyConfig,
          verbose: options.verbose || false,
        });

        console.log(chalk.green("✅ Release notes generated successfully!"));
      } catch (error: any) {
        console.error(
          chalk.red("❌ Error generating release notes:"),
          error.message
        );
        process.exit(1);
      }
    }
  );

// Configuration and Utility Commands
program
  .command("setup-jira-pat")
  .description("Set up JIRA Personal Access Token for better security")
  .option("--jira-base-url <url>", "JIRA base URL (overrides env var)")
  .action(async (options: { jiraBaseUrl?: string }) => {
    try {
      validateConfig("epic");

      const { JiraPATManager } = await import("./jira-pat-manager.js");

      const jiraHost = options.jiraBaseUrl || process.env.POOLSIDE_JIRA_HOST;
      const jiraUsername = process.env.POOLSIDE_JIRA_USERNAME;
      const jiraPassword = process.env.POOLSIDE_JIRA_PASSWORD;

      if (!jiraHost || !jiraUsername || !jiraPassword) {
        console.log(chalk.red("❌ JIRA configuration missing."));
        console.log(
          chalk.gray(
            "Please set POOLSIDE_JIRA_HOST, POOLSIDE_JIRA_USERNAME, and POOLSIDE_JIRA_PASSWORD environment variables."
          )
        );
        process.exit(1);
      }

      const patManager = new JiraPATManager({
        host: jiraHost.replace(/^https?:\/\//, ""),
        username: jiraUsername,
        password: jiraPassword,
      });

      await patManager.setupPATWorkflow();
    } catch (error: any) {
      console.error(chalk.red("❌ Error setting up JIRA PAT:"), error.message);
      process.exit(1);
    }
  });

// Helper function to parse existing .env file
async function parseEnvFile(
  filePath: string
): Promise<Record<string, string | undefined>> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const env: Record<string, string | undefined> = {};

    // Parse .env file content
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join("=").trim();
        }
      }
    }

    return env;
  } catch (error) {
    return {};
  }
}

// Helper function to check configuration completeness
function analyzeConfiguration(envVars: Record<string, string | undefined>): {
  hasOpenAI: boolean;
  hasJira: boolean;
  hasGitHub: boolean;
  missing: string[];
  configured: string[];
} {
  const requiredVars = [
    "POOLSIDE_OPENAI_API_KEY",
    "POOLSIDE_JIRA_HOST",
    "POOLSIDE_JIRA_USERNAME",
    "POOLSIDE_JIRA_PASSWORD",
  ];
  const optionalVars = [
    "POOLSIDE_GITHUB_TOKEN",
    "POOLSIDE_AI_MODEL",
    "POOLSIDE_AI_MAX_TOKENS",
  ];

  const hasOpenAI =
    !!envVars.POOLSIDE_OPENAI_API_KEY &&
    envVars.POOLSIDE_OPENAI_API_KEY !== "your_openai_api_key_here";
  const hasJira =
    !!(
      envVars.POOLSIDE_JIRA_HOST &&
      envVars.POOLSIDE_JIRA_USERNAME &&
      envVars.POOLSIDE_JIRA_PASSWORD
    ) &&
    envVars.POOLSIDE_JIRA_HOST !== "your-company.atlassian.net" &&
    envVars.POOLSIDE_JIRA_USERNAME !== "your_jira_username" &&
    envVars.POOLSIDE_JIRA_PASSWORD !== "your_jira_password_or_pat";
  const hasGitHub =
    !!envVars.POOLSIDE_GITHUB_TOKEN &&
    envVars.POOLSIDE_GITHUB_TOKEN !== "your_github_token_here";

  const missing: string[] = [];
  const configured: string[] = [];

  requiredVars.forEach((key) => {
    if (envVars[key] && !envVars[key]?.startsWith("your_")) {
      configured.push(key);
    } else {
      missing.push(key);
    }
  });

  optionalVars.forEach((key) => {
    if (envVars[key] && !envVars[key]?.startsWith("your_")) {
      configured.push(key);
    }
  });

  return { hasOpenAI, hasJira, hasGitHub, missing, configured };
}

// Helper function to update .env file with missing variables
async function updateEnvFile(
  filePath: string,
  updates: Record<string, string>
): Promise<void> {
  let content = "";

  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    // File doesn't exist, start with empty content
    content =
      "# Poolside CLI Configuration\n# Edit this file to add your credentials\n\n";
  }

  // Add missing variables
  for (const [key, value] of Object.entries(updates)) {
    if (content.includes(`${key}=`)) {
      // Replace existing value
      content = content.replace(
        new RegExp(`${key}=.*$`, "m"),
        `${key}=${value}`
      );
    } else {
      // Add new variable
      content += `${key}=${value}\n`;
    }
  }

  await fs.writeFile(filePath, content);
}

program
  .command("init-env")
  .description("Initialize environment configuration file")
  .option("-o, --output <file>", "Output env file path", ".env")
  .option("--force", "Force overwrite existing file")
  .action(async (options: { output: string; force?: boolean }) => {
    try {
      const envFile = options.output;
      const examplePath = path.join(process.cwd(), "env.example");

      // Check if .env file already exists
      let envExists = false;
      try {
        await fs.access(envFile);
        envExists = true;
      } catch {
        envExists = false;
      }

      if (envExists && !options.force) {
        console.log(
          chalk.blue(
            "🔍 Found existing environment file, analyzing configuration..."
          )
        );

        // Parse existing .env file
        const existingEnv = await parseEnvFile(envFile);
        const analysis = analyzeConfiguration(existingEnv);

        console.log(chalk.blue("\n📊 Configuration Analysis:"));
        console.log(chalk.gray("═══════════════════════════"));

        if (analysis.configured.length > 0) {
          console.log(
            chalk.green(
              `✅ Configured variables (${analysis.configured.length}):`
            )
          );
          analysis.configured.forEach((key) => {
            const value = existingEnv[key];
            const display = value ? `${value.substring(0, 8)}...` : "Set";
            console.log(chalk.gray(`   • ${key}: ${display}`));
          });
        }

        if (analysis.missing.length > 0) {
          console.log(
            chalk.yellow(
              `\n⚠️  Missing variables (${analysis.missing.length}):`
            )
          );
          analysis.missing.forEach((key) => {
            console.log(chalk.gray(`   • ${key}`));
          });
        }

        // Determine setup status
        const isWellConfigured =
          analysis.hasOpenAI && (analysis.hasJira || analysis.hasGitHub);

        if (isWellConfigured) {
          console.log(
            chalk.green("\n🎉 Your environment is already well-configured!")
          );
          console.log(chalk.blue("🔧 Capabilities detected:"));
          if (analysis.hasOpenAI)
            console.log(chalk.gray("   • AI-powered features (OpenAI)"));
          if (analysis.hasJira)
            console.log(chalk.gray("   • JIRA epic automation"));
          if (analysis.hasGitHub)
            console.log(chalk.gray("   • GitHub release notes"));

          console.log(
            chalk.yellow(
              "\n💡 Use 'poolside check-config' to verify your configuration"
            )
          );
          console.log(
            chalk.gray(
              "   Use 'poolside init-env --force' to recreate the file"
            )
          );
          return;
        }

        if (analysis.missing.length > 0) {
          console.log(chalk.blue("\n🔧 Setup recommendations:"));
          console.log(chalk.gray("═══════════════════════════"));

          if (analysis.missing.includes("POOLSIDE_OPENAI_API_KEY")) {
            console.log(chalk.yellow("🤖 OpenAI API Key (Required):"));
            console.log(
              chalk.gray("   Get from: https://platform.openai.com/api-keys")
            );
            console.log(
              chalk.gray(
                "   Add to .env: POOLSIDE_OPENAI_API_KEY=sk-your_key_here"
              )
            );
          }

          if (analysis.missing.some((k) => k.startsWith("POOLSIDE_JIRA_"))) {
            console.log(
              chalk.yellow("\n🎫 JIRA Configuration (For epic automation):")
            );
            console.log(
              chalk.gray("   POOLSIDE_JIRA_HOST: your-company.atlassian.net")
            );
            console.log(chalk.gray("   POOLSIDE_JIRA_USERNAME: your_username"));
            console.log(
              chalk.gray("   POOLSIDE_JIRA_PASSWORD: your_password_or_pat")
            );
            console.log(
              chalk.gray(
                "   Use 'poolside setup-jira-pat' for secure PAT setup"
              )
            );
          }

          if (analysis.missing.includes("POOLSIDE_GITHUB_TOKEN")) {
            console.log(chalk.yellow("\n🐙 GitHub Token (For release notes):"));
            console.log(
              chalk.gray("   Get from: https://github.com/settings/tokens")
            );
            console.log(chalk.gray("   Permissions: repo, read:org"));
            console.log(
              chalk.gray(
                "   Add to .env: POOLSIDE_GITHUB_TOKEN=ghp_your_token_here"
              )
            );
          }

          console.log(chalk.blue("\n📝 Next steps:"));
          console.log(
            chalk.gray("1. Edit your .env file to add the missing credentials")
          );
          console.log(chalk.gray("2. Run 'poolside check-config' to verify"));
          console.log(chalk.gray("3. Run 'poolside test-connections' to test"));

          return;
        }

        console.log(
          chalk.yellow(
            "\n⚠️  Configuration incomplete - some variables need proper values"
          )
        );
        console.log(
          chalk.gray(
            "Edit your .env file to replace placeholder values with real credentials"
          )
        );
        return;
      }

      // Create new .env file (either doesn't exist or --force was used)
      if (options.force && envExists) {
        console.log(
          chalk.yellow("⚠️  Overwriting existing environment file...")
        );
      } else {
        console.log(chalk.blue("🆕 Creating new environment file..."));
      }

      try {
        await fs.access(examplePath);
        await fs.copyFile(examplePath, envFile);
        console.log(chalk.green(`✅ Environment template created: ${envFile}`));
      } catch {
        // If example doesn't exist, create a minimal env file
        const minimalEnv = `# Poolside CLI Configuration
# Edit this file to add your credentials

# ================================
# OpenAI Configuration (Required)
# ================================
POOLSIDE_OPENAI_API_KEY=your_openai_api_key_here
POOLSIDE_AI_MODEL=gpt-4o
POOLSIDE_AI_MAX_TOKENS=4000

# ================================
# JIRA Configuration (Required for Epic Automation)
# ================================
POOLSIDE_JIRA_HOST=your-company.atlassian.net
POOLSIDE_JIRA_USERNAME=your_jira_username
POOLSIDE_JIRA_PASSWORD=your_jira_password_or_pat

# ================================
# GitHub Configuration (Required for Release Notes)
# ================================
POOLSIDE_GITHUB_TOKEN=your_github_token_here
`;

        await fs.writeFile(envFile, minimalEnv);
        console.log(chalk.green(`✅ Environment template created: ${envFile}`));
      }

      console.log(chalk.blue("\n🚀 Quick Setup Guide:"));
      console.log(chalk.gray("═══════════════════════"));
      console.log(chalk.yellow("1. Get your OpenAI API key:"));
      console.log(
        chalk.gray("   • Visit: https://platform.openai.com/api-keys")
      );
      console.log(chalk.gray("   • Create a new secret key"));
      console.log(
        chalk.gray("   • Replace 'your_openai_api_key_here' in .env")
      );

      console.log(chalk.yellow("\n2. For JIRA epic automation:"));
      console.log(
        chalk.gray(
          "   • Replace POOLSIDE_JIRA_HOST with your server (e.g., company.atlassian.net)"
        )
      );
      console.log(chalk.gray("   • Add your JIRA username and password"));
      console.log(
        chalk.gray("   • Or run 'poolside setup-jira-pat' for secure PAT setup")
      );

      console.log(chalk.yellow("\n3. For GitHub release notes:"));
      console.log(chalk.gray("   • Visit: https://github.com/settings/tokens"));
      console.log(
        chalk.gray("   • Create token with 'repo' and 'read:org' permissions")
      );
      console.log(chalk.gray("   • Replace 'your_github_token_here' in .env"));

      console.log(chalk.blue("\n📋 Next steps:"));
      console.log(chalk.gray("• Edit .env file with your credentials"));
      console.log(chalk.gray("• Run 'poolside check-config' to verify setup"));
      console.log(chalk.gray("• Run 'poolside test-connections' to test"));
    } catch (error: any) {
      console.error(
        chalk.red("❌ Error creating environment file:"),
        error.message
      );
      process.exit(1);
    }
  });

program
  .command("init-release-config")
  .description("Initialize a release notes configuration file")
  .option(
    "-o, --output <file>",
    "Output config file path",
    "release-config.json"
  )
  .action(async (options: { output: string }) => {
    try {
      const examplePath = path.join(process.cwd(), "config.example.json");

      try {
        await fs.access(examplePath);
        await fs.copyFile(examplePath, options.output);
        console.log(
          chalk.green(
            `✅ Release notes configuration template created: ${options.output}`
          )
        );
        console.log(
          chalk.yellow(
            "📝 Edit the configuration file to match your repositories and requirements."
          )
        );
      } catch {
        // If example doesn't exist, create a minimal config
        const minimalConfig = {
          releaseConfig: {
            month: getCurrentMonth(),
            outputFile: "release-notes.md",
            title: "Release Notes",
            description: "Generated release notes",
            includeTableOfContents: true,
            includeSummary: true,
          },
          aiConfig: {
            maxTokens: 8000,
            batchSize: 3,
            model: "gpt-4o",
          },
          repositories: [
            {
              name: "Example Repo",
              repo: "owner/repository",
              description: "Description of the repository",
              priority: 1,
              includeInSummary: true,
            },
          ],
          jiraConfig: {
            enabled: true,
          },
        };

        await fs.writeFile(
          options.output,
          JSON.stringify(minimalConfig, null, 2)
        );
        console.log(
          chalk.green(
            `✅ Basic release notes configuration created: ${options.output}`
          )
        );
        console.log(
          chalk.yellow(
            "📝 Update the configuration with your actual repository details."
          )
        );
      }
    } catch (error: any) {
      console.error(chalk.red("❌ Error creating config file:"), error.message);
      process.exit(1);
    }
  });

// Add a config check command for debugging
program
  .command("check-config")
  .description("Check current environment configuration")
  .action(() => {
    console.log(chalk.blue("🔧 Checking configuration...\n"));

    const vars = [
      {
        name: "OpenAI API Key",
        key: "POOLSIDE_OPENAI_API_KEY",
        required: true,
      },
      { name: "AI Model", key: "POOLSIDE_AI_MODEL", required: false },
      { name: "AI Max Tokens", key: "POOLSIDE_AI_MAX_TOKENS", required: false },
      { name: "JIRA Host", key: "POOLSIDE_JIRA_HOST", required: false },
      { name: "JIRA Username", key: "POOLSIDE_JIRA_USERNAME", required: false },
      { name: "JIRA Password", key: "POOLSIDE_JIRA_PASSWORD", required: false },
      { name: "GitHub Token", key: "POOLSIDE_GITHUB_TOKEN", required: false },
    ];

    vars.forEach(({ name, key, required }) => {
      const value = process.env[key];
      const status = value ? "✅" : required ? "❌" : "⚠️";
      const display = value ? `${value.substring(0, 8)}...` : "Not set";
      const label = required ? "Required" : "Optional";

      console.log(`${status} ${name}: ${display} (${label})`);
      console.log(chalk.gray(`    Variable: ${key}`));
      console.log();
    });

    console.log(
      chalk.gray(
        "Note: Only the first 8 characters of tokens are shown for security."
      )
    );
    console.log(chalk.blue("\nWorkflow Requirements:"));
    console.log(
      chalk.gray(
        "• Epic Automation: Requires OpenAI API Key, JIRA Host, JIRA Username, JIRA Password"
      )
    );
    console.log(
      chalk.gray(
        "• Release Notes: Requires OpenAI API Key, GitHub Token (JIRA optional)"
      )
    );
  });

program
  .command("test-connections")
  .description("Test connections to JIRA, GitHub, and OpenAI")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(async (options: { verbose?: boolean }) => {
    try {
      const config = createWorkflowConfig();
      config.verbose = options.verbose || false;

      const workflow = new EpicWorkflow(config);
      await workflow.validateConnections();

      console.log(chalk.green("✅ All connections tested successfully!"));
    } catch (error: any) {
      console.error(chalk.red("❌ Connection test failed:"), error.message);
      process.exit(1);
    }
  });

program.parse();
