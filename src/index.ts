#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import { EpicWorkflow } from "./epic-workflow.js";
import { generateMultiRepoReleaseNotes } from "./release-notes-generator.js";

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
    OPENAI_API_KEY: "OpenAI API Key",
  };

  const jiraVars: Record<string, string> = {
    JIRA_HOST: "JIRA Server Host",
    JIRA_USERNAME: "JIRA Username",
    JIRA_PASSWORD: "JIRA Password/Token",
  };

  const githubVars: Record<string, string> = {
    GITHUB_TOKEN: "GitHub Personal Access Token",
  };

  let requiredVars: Record<string, string> = { ...baseVars };
  let optionalVars: Record<string, string> = {};

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
      console.log(chalk.red(`• ${key}`));
      console.log(chalk.gray(`  Description: ${description}`));
      console.log("");
    });

    console.log(chalk.yellow("📋 Setup Instructions:"));
    console.log(chalk.yellow("═══════════════════════\n"));

    console.log(chalk.white("1. Copy the example environment file:"));
    console.log(chalk.gray("   cp env.example .env\n"));

    console.log(
      chalk.white(
        "2. Edit .env and add your credentials for these variables:\n"
      )
    );

    missing.forEach(({ key, description }) => {
      console.log(chalk.cyan(`   ${key}=your_${key.toLowerCase()}_here`));
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
      console.log(chalk.gray(`   • ${key} - ${description}`));
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
      host: process.env.JIRA_HOST?.replace(/^https?:\/\//, ""),
      username: process.env.JIRA_USERNAME,
      password: process.env.JIRA_PASSWORD,
    },
    github: {
      token: process.env.GITHUB_TOKEN,
    },
    ai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.AI_MODEL || "gpt-4o",
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || "4000"),
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
          maxResults: parseInt(options.limit),
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

      const jiraHost = options.jiraBaseUrl || process.env.JIRA_HOST;
      const jiraUsername = process.env.JIRA_USERNAME;
      const jiraPassword = process.env.JIRA_PASSWORD;

      if (!jiraHost || !jiraUsername || !jiraPassword) {
        console.log(chalk.red("❌ JIRA configuration missing."));
        console.log(
          chalk.gray(
            "Please set JIRA_HOST, JIRA_USERNAME, and JIRA_PASSWORD environment variables."
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

program
  .command("init-env")
  .description("Initialize environment configuration file")
  .option("-o, --output <file>", "Output env file path", ".env")
  .action(async (options: { output: string }) => {
    try {
      const examplePath = path.join(process.cwd(), "env.example");

      try {
        await fs.access(examplePath);
        await fs.copyFile(examplePath, options.output);
        console.log(
          chalk.green(`✅ Environment template created: ${options.output}`)
        );
        console.log(
          chalk.yellow("📝 Edit the environment file to add your credentials.")
        );
      } catch {
        // If example doesn't exist, create a minimal env file
        const minimalEnv = `# Poolside CLI Configuration
# Copy this file to .env and fill in your credentials

# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here
AI_MODEL=gpt-4o
AI_MAX_TOKENS=4000

# JIRA Configuration (Required for Epic Automation)
JIRA_HOST=your-company.atlassian.net
JIRA_USERNAME=your_jira_username
JIRA_PASSWORD=your_jira_password_or_pat

# GitHub Configuration (Required for Release Notes)
GITHUB_TOKEN=your_github_token_here
`;

        await fs.writeFile(options.output, minimalEnv);
        console.log(
          chalk.green(`✅ Environment template created: ${options.output}`)
        );
        console.log(
          chalk.yellow("📝 Edit the environment file to add your credentials.")
        );
      }
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
      { key: "OPENAI_API_KEY", required: true },
      { key: "JIRA_HOST", required: false },
      { key: "JIRA_USERNAME", required: false },
      { key: "JIRA_PASSWORD", required: false },
      { key: "GITHUB_TOKEN", required: false },
    ];

    vars.forEach(({ key, required }) => {
      const value = process.env[key];
      const status = value ? "✅" : required ? "❌" : "⚠️";
      const display = value ? `${value.substring(0, 8)}...` : "Not set";
      const label = required ? "Required" : "Optional";

      console.log(`${status} ${key}: ${display} (${label})`);
    });

    console.log(
      "\n" +
        chalk.gray(
          "Note: Only the first 8 characters of tokens are shown for security."
        )
    );
    console.log(chalk.blue("\nWorkflow Requirements:"));
    console.log(
      chalk.gray(
        "• Epic Automation: Requires OPENAI_API_KEY, JIRA_HOST, JIRA_USERNAME, JIRA_PASSWORD"
      )
    );
    console.log(
      chalk.gray(
        "• Release Notes: Requires OPENAI_API_KEY, GITHUB_TOKEN (JIRA optional)"
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
