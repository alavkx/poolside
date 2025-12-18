#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import { EpicWorkflow } from "./epic-workflow.js";
import { generateMultiRepoReleaseNotes } from "./release-notes-generator.js";
import { IntegrationUtils } from "./integration-utils.js";
import { AIProcessor } from "./ai-processor.js";
import {
  DiffGenerator,
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
} from "./diff-generator.js";
import { SlackClient } from "./slack-client.js";
import {
  ConfigManager,
  BUILT_IN_PRESETS,
  DEFAULT_PRESET,
  type ModelPreset,
  type AIProvider,
} from "./model-config.js";

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
    provider: AIProvider;
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
    branch?: string; // Optional: override the repository's default branch
    categories?: Record<string, string>;
  }>;
  jiraConfig: {
    enabled: boolean;
    baseUrl?: string;
    priorityMapping?: Record<string, string>;
  };
}

type RequiredFor = "epic" | "release-notes" | "all";

// Get the current AI provider from environment
function getAIProvider(): AIProvider {
  const provider = process.env.POOLSIDE_AI_PROVIDER?.toLowerCase();
  if (provider === "anthropic") return "anthropic";
  return "openai";
}

// Get the API key for the current provider
function getAIApiKey(): string | undefined {
  const provider = getAIProvider();
  return provider === "anthropic"
    ? process.env.POOLSIDE_ANTHROPIC_API_KEY
    : process.env.POOLSIDE_OPENAI_API_KEY;
}

// Validate environment configuration
function validateConfig(requiredFor: RequiredFor = "all"): void {
  const provider = getAIProvider();
  const apiKeyVar =
    provider === "anthropic"
      ? "POOLSIDE_ANTHROPIC_API_KEY"
      : "POOLSIDE_OPENAI_API_KEY";
  const apiKeyDesc =
    provider === "anthropic" ? "Anthropic API Key" : "OpenAI API Key";

  const baseVars: Record<string, string> = {
    [apiKeyVar]: apiKeyDesc,
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

  // Only the selected provider's API key is truly required - other vars are conditional
  let requiredVars: Record<string, string> = {
    [apiKeyVar]: baseVars[apiKeyVar],
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
      chalk.gray(
        "   • Anthropic API Key: https://console.anthropic.com/settings/keys"
      )
    );
    console.log(
      chalk.gray(
        "   • GitHub Token: https://github.com/settings/tokens (classic)"
      )
    );
    console.log(
      chalk.gray(
        "   • GitHub Fine-grained Token: https://github.com/settings/tokens?type=beta (recommended)"
      )
    );
    console.log(
      chalk.gray(
        "     Required permissions: Contents:Read, Metadata:Read, Pull requests:Read"
      )
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
  const provider = getAIProvider();
  const defaultModel =
    provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o";

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
      provider,
      apiKey: getAIApiKey(),
      model: process.env.POOLSIDE_AI_MODEL || defaultModel,
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
  .option(
    "--preset <name>",
    "Use a named preset (e.g., fast, quality, balanced, cheap)"
  )
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (
      epicId: string,
      options: {
        agent: string;
        claimant?: string;
        dryRun?: boolean;
        preset?: string;
        model?: string;
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
  .description("Process a JIRA issue to claim it and generate a coding prompt")
  .option(
    "-a, --agent <name>",
    "Name of the agent claiming the issue",
    "Coding Agent"
  )
  .option("-c, --claimant <name>", "Name to use when claiming the issue")
  .option("--dry-run", "Preview changes without actually claiming the issue")
  .option(
    "--preset <name>",
    "Use a named preset (e.g., fast, quality, balanced, cheap)"
  )
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (
      issueId: string,
      options: {
        agent: string;
        claimant?: string;
        dryRun?: boolean;
        preset?: string;
        model?: string;
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
  .option(
    "--preset <name>",
    "Use a named preset (e.g., fast, quality, balanced, cheap)"
  )
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (options: {
      config: string;
      month?: string;
      output?: string;
      preset?: string;
      model?: string;
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
          presetOptions: {
            cliPreset: options.preset,
            cliModel: options.model,
          },
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
  .option(
    "--preset <name>",
    "Use a named preset (e.g., fast, quality, balanced, cheap)"
  )
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (options: {
      repo: string;
      month: string;
      output: string;
      jiraBaseUrl?: string;
      preset?: string;
      model?: string;
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
          presetOptions: {
            cliPreset: options.preset,
            cliModel: options.model,
          },
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

// Diff Command - Analyze git diff and generate customer-focused summary
program
  .command("diff")
  .description(
    "Analyze a git diff and generate a customer-focused summary of changes"
  )
  .option(
    "-r, --range <range>",
    "Git range to analyze (e.g., main...HEAD). Defaults to <baseline>...HEAD"
  )
  .option(
    "-s, --slack-webhook <url>",
    "Slack webhook URL to post the summary (or set POOLSIDE_SLACK_WEBHOOK_URL)"
  )
  .option(
    "-f, --format <type>",
    "Output format: text, markdown, json, slack",
    "text"
  )
  .option(
    "-p, --repo-path <path>",
    "Path to git repository (defaults to current directory)",
    process.cwd()
  )
  .option(
    "--repo-url <url>",
    "Repository URL for generating commit links (e.g., https://github.com/owner/repo)"
  )
  .option("--pr-number <number>", "PR number to include in the summary")
  .option("--pr-url <url>", "PR URL to include in the summary")
  .option("--title <title>", "Custom title for the summary")
  .option(
    "--preset <name>",
    "Use a named preset (e.g., fast, quality, balanced, cheap)"
  )
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Enable verbose logging for debugging")
  .action(
    async (options: {
      range?: string;
      slackWebhook?: string;
      format: string;
      repoPath: string;
      repoUrl?: string;
      prNumber?: string;
      prUrl?: string;
      title?: string;
      preset?: string;
      model?: string;
      verbose?: boolean;
    }) => {
      try {
        console.log(chalk.blue("🔍 Analyzing git diff..."));

        // Resolve the git range - use provided range or detect baseline
        const gitRange =
          options.range || (await detectDefaultRange(options.repoPath));

        console.log(chalk.gray(`Range: ${gitRange}`));
        console.log(chalk.gray(`Repository: ${options.repoPath}`));

        // Initialize AI processor with preset resolution
        const aiProcessor = await AIProcessor.createWithPreset(
          options.verbose,
          {},
          {
            cliPreset: options.preset,
            cliModel: options.model,
          }
        );

        const resolvedModel = aiProcessor.getResolvedModel();
        if (resolvedModel) {
          console.log(chalk.gray(`AI Provider: ${resolvedModel.provider}`));
          console.log(chalk.gray(`AI Model: ${resolvedModel.model}`));
          if (options.verbose) {
            console.log(chalk.gray(`Model Source: ${resolvedModel.source}`));
          }
        }

        const diffGenerator = new DiffGenerator({
          repoPath: options.repoPath,
          verbose: options.verbose,
        });

        // Set repo URL for commit links if provided
        if (options.repoUrl) {
          diffGenerator.setRepoUrl(options.repoUrl);
        }

        // Get diff data
        const diffData = await diffGenerator.getDiff(gitRange);

        if (diffData.files.length === 0) {
          console.log(
            chalk.yellow("⚠️  No changes found in the specified range")
          );
          process.exit(0);
        }

        // Generate AI summary
        const summary = await diffGenerator.generateSummary(
          diffData,
          aiProcessor
        );

        // Add optional metadata
        if (options.title) {
          summary.title = options.title;
        }
        if (options.prNumber) {
          summary.prNumber = Number.parseInt(options.prNumber, 10);
        }
        if (options.prUrl) {
          summary.prUrl = options.prUrl;
        }
        if (options.repoUrl) {
          summary.repoUrl = options.repoUrl;
        }

        // Format output
        let output: string;
        const format = options.format.toLowerCase();

        switch (format) {
          case "markdown":
          case "md":
            output = formatAsMarkdown(summary);
            break;
          case "json":
            output = formatAsJson(summary);
            break;
          case "slack":
            output = JSON.stringify(
              SlackClient.formatDiffSummary(summary),
              null,
              2
            );
            break;
          case "text":
          default:
            output = formatAsText(summary);
            break;
        }

        // Output to console
        console.log(chalk.blue("\n📋 Summary:"));
        console.log("─".repeat(50));
        console.log(output);
        console.log("─".repeat(50));

        // Post to Slack if webhook is provided
        const webhookUrl =
          options.slackWebhook || process.env.POOLSIDE_SLACK_WEBHOOK_URL;

        if (webhookUrl) {
          if (!SlackClient.isValidWebhookUrl(webhookUrl)) {
            console.warn(
              chalk.yellow(
                "⚠️  Warning: Webhook URL doesn't look like a Slack webhook"
              )
            );
          }

          const slackClient = new SlackClient({ webhookUrl });
          const slackMessage = SlackClient.formatDiffSummary(summary);
          await slackClient.postMessage(slackMessage);
        }

        console.log(chalk.green("\n✅ Diff analysis complete!"));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(chalk.red("❌ Error analyzing diff:"), errorMessage);
        process.exit(1);
      }
    }
  );

// Configuration and Setup Commands
const setupProgram = program
  .command("setup")
  .description("Interactive setup wizard or specific setup commands");

// Interactive setup wizard
setupProgram.action(async () => {
  await runSetupWizard();
});

// Sub-command: setup env
setupProgram
  .command("env")
  .description("Initialize environment configuration file")
  .option("-o, --output <file>", "Output env file path", ".env")
  .option("--force", "Force overwrite existing file")
  .action(async (options: { output: string; force?: boolean }) => {
    await setupEnvCommand(options);
  });

// Sub-command: setup jira-pat
setupProgram
  .command("jira-pat")
  .description("Set up JIRA Personal Access Token for better security")
  .option("--jira-base-url <url>", "JIRA base URL (overrides env var)")
  .action(async (options: { jiraBaseUrl?: string }) => {
    await setupJiraPATCommand(options);
  });

// Sub-command: setup release
setupProgram
  .command("release")
  .description("Initialize a release notes configuration file")
  .option(
    "-o, --output <file>",
    "Output config file path",
    "release-config.json"
  )
  .action(async (options: { output: string }) => {
    await setupReleaseCommand(options);
  });

// Sub-command: setup validate
setupProgram
  .command("validate")
  .description("Check configuration and test connections")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(async (options: { verbose?: boolean }) => {
    await setupValidateCommand(options);
  });

// Sub-command: setup check
setupProgram
  .command("check")
  .description("Check current environment configuration")
  .action(async () => {
    await setupCheckCommand();
  });

// Sub-command: setup test
setupProgram
  .command("test")
  .description("Test connections to JIRA, GitHub, and OpenAI")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(async (options: { verbose?: boolean }) => {
    await setupTestCommand(options);
  });

// Interactive setup wizard function
async function runSetupWizard(): Promise<void> {
  console.log(chalk.blue("🚀 Poolside CLI Setup Wizard"));
  console.log(chalk.gray("═══════════════════════════════════"));
  console.log();

  console.log(chalk.blue("🔍 Analyzing current configuration..."));

  // Check for .env file
  let envExists = false;
  try {
    await fs.access(".env");
    envExists = true;
  } catch {
    envExists = false;
  }

  // Check both .env file and process.env (for external tools providing env vars)
  let analysis;
  let envVars: Record<string, string | undefined> = {};

  if (envExists) {
    envVars = await parseEnvFile(".env");
  }

  // Merge with process.env to include variables from external tools
  const allEnvVars = {
    ...envVars,
    ...process.env,
  };

  analysis = analyzeConfiguration(allEnvVars);

  console.log();

  // Show current status
  if (envExists) {
    console.log(chalk.green("✅ Environment file found (.env)"));
  } else {
    console.log(chalk.yellow("⚠️  No environment file found"));
  }

  // Show AI provider status
  if (analysis.hasOpenAI && analysis.hasAnthropic) {
    console.log(
      chalk.green("✅ Both OpenAI and Anthropic API keys configured")
    );
    console.log(chalk.gray(`   Active provider: ${analysis.provider}`));
  } else if (analysis.hasOpenAI) {
    console.log(chalk.green("✅ OpenAI API key configured"));
  } else if (analysis.hasAnthropic) {
    console.log(chalk.green("✅ Anthropic API key configured"));
  } else {
    console.log(
      chalk.red("❌ No AI provider configured (OpenAI or Anthropic)")
    );
  }

  if (analysis.hasJira) {
    console.log(chalk.green("✅ JIRA credentials configured"));
  } else if (analysis.configured.some((key) => key.includes("JIRA"))) {
    console.log(
      chalk.yellow("⚠️  JIRA credentials found but using basic auth")
    );
  } else {
    console.log(chalk.red("❌ JIRA credentials not configured"));
  }

  if (analysis.hasGitHub) {
    console.log(chalk.green("✅ GitHub token configured"));
  } else {
    console.log(chalk.yellow("⚠️  GitHub token not configured"));
  }

  console.log();

  // Check if release config exists
  let releaseConfigExists = false;
  try {
    await fs.access("release-config.json");
    releaseConfigExists = true;
    console.log(chalk.green("✅ Release notes config found"));
  } catch {
    console.log(chalk.yellow("⚠️  Release notes config not found"));
  }

  console.log();

  // Determine setup needs and present options
  const isWellConfigured =
    analysis.hasAI && (analysis.hasJira || analysis.hasGitHub);

  if (isWellConfigured && releaseConfigExists) {
    console.log(chalk.green("🎉 Your setup looks complete!"));
    console.log();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Validate current setup", value: "validate" },
          {
            name: "Set up JIRA Personal Access Token (recommended)",
            value: "jira-pat",
          },
          { name: "Reconfigure environment", value: "env" },
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    if (action === "exit") return;
    await executeSetupAction(action, {});
    return;
  }

  const choices = [];

  if (!envExists || analysis.missing.length > 0) {
    choices.push({ name: "Set up environment configuration", value: "env" });
  }

  if (analysis.hasJira && !analysis.hasAI) {
    choices.push({
      name: "Set up JIRA Personal Access Token (recommended)",
      value: "jira-pat",
    });
  }

  if (!releaseConfigExists) {
    choices.push({
      name: "Initialize release notes configuration",
      value: "release",
    });
  }

  choices.push({ name: "Test all connections", value: "test" });
  choices.push({ name: "Validate current setup", value: "validate" });

  if (choices.length === 2) {
    // Only test and validate
    choices.splice(0, 0, {
      name: "Configure individual components",
      value: "configure",
    });
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices,
    },
  ]);

  if (action === "configure") {
    const { component } = await inquirer.prompt([
      {
        type: "list",
        name: "component",
        message: "Which component would you like to configure?",
        choices: [
          { name: "Environment configuration", value: "env" },
          { name: "JIRA Personal Access Token", value: "jira-pat" },
          { name: "Release notes configuration", value: "release" },
          { name: "Back to main menu", value: "back" },
        ],
      },
    ]);

    if (component === "back") {
      return runSetupWizard();
    }
    await executeSetupAction(component, {});
  } else {
    await executeSetupAction(action, {});
  }
}

async function executeSetupAction(action: string, options: any): Promise<void> {
  switch (action) {
    case "env":
      await setupEnvCommand({ output: ".env", force: options.force });
      break;
    case "jira-pat":
      await setupJiraPATCommand({ jiraBaseUrl: options.jiraBaseUrl });
      break;
    case "release":
      await setupReleaseCommand({ output: "release-config.json" });
      break;
    case "validate":
      await setupValidateCommand({ verbose: options.verbose });
      break;
    case "test":
      await setupTestCommand({ verbose: options.verbose });
      break;
  }
}

// Move existing command implementations to functions
async function setupJiraPATCommand(options: {
  jiraBaseUrl?: string;
}): Promise<void> {
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
}

async function setupEnvCommand(options: {
  output: string;
  force?: boolean;
}): Promise<void> {
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
          chalk.yellow(`\n⚠️  Missing variables (${analysis.missing.length}):`)
        );
        analysis.missing.forEach((key) => {
          console.log(chalk.gray(`   • ${key}`));
        });
      }

      // Determine setup status
      const isWellConfigured =
        analysis.hasAI && (analysis.hasJira || analysis.hasGitHub);

      if (isWellConfigured) {
        console.log(chalk.green("\n🎉 Your configuration looks great!"));
        console.log(chalk.gray("• Run 'poolside setup check' to verify setup"));
        console.log(
          chalk.gray("• Run 'poolside setup test' to test connections")
        );
        console.log(
          chalk.gray("   Use 'poolside setup env --force' to recreate the file")
        );
        return;
      }

      if (analysis.hasJira && !analysis.hasAI) {
        console.log(
          chalk.yellow(
            "\n💡 JIRA is configured but missing AI provider API key"
          )
        );
        console.log(
          chalk.gray(
            "   Add POOLSIDE_OPENAI_API_KEY or POOLSIDE_ANTHROPIC_API_KEY to enable AI features"
          )
        );
      } else if (analysis.hasAI && !analysis.hasJira && !analysis.hasGitHub) {
        console.log(
          chalk.yellow(
            "\n💡 AI provider is configured but missing integrations"
          )
        );
        console.log(
          chalk.gray("   Add JIRA or GitHub credentials to enable workflows")
        );
        console.log(
          chalk.gray(
            "   • Or run 'poolside setup jira-pat' for secure PAT setup"
          )
        );
      }

      console.log(
        chalk.gray(
          "\n💡 Use 'poolside setup check' to verify your configuration"
        )
      );
      console.log(chalk.gray("2. Run 'poolside setup check' to verify"));
      console.log(chalk.gray("3. Run 'poolside setup test' to test"));
      return;
    }

    // Copy example file or create new
    try {
      await fs.access(examplePath);
      await fs.copyFile(examplePath, envFile);
      console.log(
        chalk.green(`✅ Environment configuration template created: ${envFile}`)
      );
      console.log(
        chalk.yellow("📝 Edit the .env file with your actual credentials:")
      );
      console.log(
        chalk.gray("   • OpenAI API Key: https://platform.openai.com/api-keys")
      );
      console.log(
        chalk.gray(
          "   • GitHub Token: https://github.com/settings/tokens (classic)"
        )
      );
      console.log(
        chalk.gray(
          "   • GitHub Fine-grained: https://github.com/settings/tokens?type=beta (recommended)"
        )
      );
      console.log(
        chalk.gray(
          "     Need: Contents:Read, Metadata:Read, Pull requests:Read"
        )
      );
      console.log(chalk.gray("   • JIRA Host: Your JIRA server hostname"));
      console.log(chalk.gray("   • JIRA Username: Your JIRA username"));
      console.log(
        chalk.gray("   • Or run 'poolside setup jira-pat' for secure PAT setup")
      );
    } catch {
      console.log(
        chalk.yellow("⚠️  env.example not found, creating basic template")
      );
      const basicEnv = `# OpenAI Configuration (Required)
POOLSIDE_OPENAI_API_KEY=your_openai_api_key_here
POOLSIDE_AI_MODEL=gpt-4o
POOLSIDE_AI_MAX_TOKENS=4000

# JIRA Configuration (Required for epic automation)
POOLSIDE_JIRA_HOST=your-company.atlassian.net
POOLSIDE_JIRA_USERNAME=your_jira_username
POOLSIDE_JIRA_PASSWORD=your_jira_password_or_pat

# GitHub Configuration (Required for release notes)
POOLSIDE_GITHUB_TOKEN=your_github_token_here
`;
      await fs.writeFile(envFile, basicEnv);
      console.log(
        chalk.green(`✅ Basic environment template created: ${envFile}`)
      );
    }

    console.log(chalk.gray("• Run 'poolside setup check' to verify setup"));
    console.log(chalk.gray("• Run 'poolside setup test' to test"));
  } catch (error: any) {
    console.error(chalk.red("❌ Error setting up environment:"), error.message);
    process.exit(1);
  }
}

async function setupReleaseCommand(options: { output: string }): Promise<void> {
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
}

async function setupCheckCommand(): Promise<void> {
  console.log(chalk.blue("🔧 Checking configuration...\n"));

  const provider = getAIProvider();
  const hasOpenAI = !!process.env.POOLSIDE_OPENAI_API_KEY;
  const hasAnthropic = !!process.env.POOLSIDE_ANTHROPIC_API_KEY;
  const hasAI = hasOpenAI || hasAnthropic;

  const vars = [
    { name: "AI Provider", key: "POOLSIDE_AI_PROVIDER", required: false },
    {
      name: "OpenAI API Key",
      key: "POOLSIDE_OPENAI_API_KEY",
      required: !hasAnthropic,
    },
    {
      name: "Anthropic API Key",
      key: "POOLSIDE_ANTHROPIC_API_KEY",
      required: !hasOpenAI,
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

  console.log(chalk.gray(`Active AI Provider: ${provider}`));
  console.log(
    chalk.gray(
      "Note: Only the first 8 characters of tokens are shown for security."
    )
  );
  console.log(chalk.blue("\nWorkflow Requirements:"));
  console.log(
    chalk.gray(
      "• Epic Automation: Requires AI API Key (OpenAI or Anthropic), JIRA Host, JIRA Username, JIRA Password"
    )
  );
  console.log(
    chalk.gray(
      "• Release Notes: Requires AI API Key (OpenAI or Anthropic), GitHub Token (JIRA optional)"
    )
  );
}

async function setupTestCommand(options: { verbose?: boolean }): Promise<void> {
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
}

async function setupValidateCommand(options: {
  verbose?: boolean;
}): Promise<void> {
  console.log(chalk.blue("🔧 Validating setup...\n"));

  // First run check
  await setupCheckCommand();

  console.log(chalk.blue("\n🔗 Testing connections...\n"));

  // Then run test
  await setupTestCommand(options);

  console.log(chalk.green("\n🎉 Setup validation complete!"));
}

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
  hasAnthropic: boolean;
  hasAI: boolean;
  hasJira: boolean;
  hasGitHub: boolean;
  missing: string[];
  configured: string[];
  provider: AIProvider;
} {
  const requiredVars = [
    "POOLSIDE_JIRA_HOST",
    "POOLSIDE_JIRA_USERNAME",
    "POOLSIDE_JIRA_PASSWORD",
  ];
  const optionalVars = [
    "POOLSIDE_OPENAI_API_KEY",
    "POOLSIDE_ANTHROPIC_API_KEY",
    "POOLSIDE_AI_PROVIDER",
    "POOLSIDE_GITHUB_TOKEN",
    "POOLSIDE_AI_MODEL",
    "POOLSIDE_AI_MAX_TOKENS",
  ];

  const hasOpenAI =
    !!envVars.POOLSIDE_OPENAI_API_KEY &&
    envVars.POOLSIDE_OPENAI_API_KEY !== "your_openai_api_key_here" &&
    !envVars.POOLSIDE_OPENAI_API_KEY?.startsWith("sk-your_");
  const hasAnthropic =
    !!envVars.POOLSIDE_ANTHROPIC_API_KEY &&
    envVars.POOLSIDE_ANTHROPIC_API_KEY !== "your_anthropic_api_key_here" &&
    !envVars.POOLSIDE_ANTHROPIC_API_KEY?.startsWith("sk-ant-your_");
  const hasAI = hasOpenAI || hasAnthropic;

  // Determine which provider is configured
  const configuredProvider =
    envVars.POOLSIDE_AI_PROVIDER?.toLowerCase() === "anthropic"
      ? "anthropic"
      : "openai";
  const provider: AIProvider = configuredProvider;

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

  // Check required JIRA vars
  requiredVars.forEach((key) => {
    if (envVars[key] && !envVars[key]?.startsWith("your_")) {
      configured.push(key);
    } else {
      missing.push(key);
    }
  });

  // At least one AI provider is required
  if (!hasAI) {
    missing.push("POOLSIDE_OPENAI_API_KEY or POOLSIDE_ANTHROPIC_API_KEY");
  }

  optionalVars.forEach((key) => {
    if (
      envVars[key] &&
      !envVars[key]?.startsWith("your_") &&
      !envVars[key]?.startsWith("sk-your_") &&
      !envVars[key]?.startsWith("sk-ant-your_")
    ) {
      configured.push(key);
    }
  });

  return {
    hasOpenAI,
    hasAnthropic,
    hasAI,
    hasJira,
    hasGitHub,
    missing,
    configured,
    provider,
  };
}

// Helper function to detect the default git range for diff comparison
async function detectDefaultRange(repoPath: string): Promise<string> {
  const { execSync } = await import("node:child_process");

  // List of potential baseline branches to check, in order of preference
  const baselineCandidates = [
    "main",
    "master",
    "origin/main",
    "origin/master",
    "develop",
    "origin/develop",
  ];

  for (const branch of baselineCandidates) {
    try {
      // Check if the branch/ref exists
      execSync(`git rev-parse --verify ${branch}`, {
        cwd: repoPath,
        stdio: "pipe",
      });
      return `${branch}...HEAD`;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // Fallback: use the merge-base of HEAD with the first remote branch
  try {
    const defaultBranch = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'",
      { cwd: repoPath, stdio: "pipe", encoding: "utf8" }
    ).trim();

    if (defaultBranch) {
      return `origin/${defaultBranch}...HEAD`;
    }
  } catch {
    // Couldn't detect default branch
  }

  // Last resort: compare against the parent commit
  console.log(
    chalk.yellow(
      "⚠️  Could not detect baseline branch. Using HEAD~1 as baseline."
    )
  );
  return "HEAD~1...HEAD";
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

// ===========================
// Model Configuration Commands
// ===========================
const configProgram = program
  .command("config")
  .description("Manage AI model presets and configuration");

// Main config command - show current config
configProgram.action(async () => {
  await configListCommand();
});

// config list - Show all presets and current selection
configProgram
  .command("list")
  .description("Show all available presets and current selection")
  .action(async () => {
    await configListCommand();
  });

// config use <preset> - Switch active preset
configProgram
  .command("use <preset>")
  .description("Switch active preset")
  .action(async (preset: string) => {
    await configUseCommand(preset);
  });

// config add <name> - Add custom preset (interactive)
configProgram
  .command("add <name>")
  .description("Add a custom preset (interactive)")
  .option("-p, --provider <provider>", "AI provider (openai or anthropic)")
  .option("-m, --model <model>", "Model name")
  .option("-d, --description <desc>", "Preset description")
  .action(
    async (
      name: string,
      options: { provider?: string; model?: string; description?: string }
    ) => {
      await configAddCommand(name, options);
    }
  );

// config remove <name> - Remove custom preset
configProgram
  .command("remove <name>")
  .description("Remove a custom preset")
  .action(async (name: string) => {
    await configRemoveCommand(name);
  });

// Config command implementations
async function configListCommand(): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.readConfig();
  const allPresets = configManager.getAllPresets(config);
  const resolved = await configManager.resolveModel();

  console.log(chalk.blue("\n🎛️  AI Model Configuration"));
  console.log(chalk.gray("═══════════════════════════════════\n"));

  // Show current active model
  console.log(chalk.white("Current Model:"));
  console.log(chalk.green(`  Provider: ${resolved.provider}`));
  console.log(chalk.green(`  Model: ${resolved.model}`));
  console.log(chalk.gray(`  Source: ${resolved.source}`));
  console.log();

  // Show built-in presets
  console.log(chalk.white("Built-in Presets:"));
  for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
    const isActive = config.activePreset === name;
    const marker = isActive ? chalk.green("●") : chalk.gray("○");
    const nameStr = isActive ? chalk.green(name) : chalk.white(name);
    console.log(
      `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${
        preset.model
      }`
    );
    if (preset.description) {
      console.log(chalk.gray(`                   ${preset.description}`));
    }
  }
  console.log();

  // Show custom presets
  const customPresets = Object.entries(config.presets || {});
  if (customPresets.length > 0) {
    console.log(chalk.white("Custom Presets:"));
    for (const [name, preset] of customPresets) {
      const isActive = config.activePreset === name;
      const marker = isActive ? chalk.green("●") : chalk.gray("○");
      const nameStr = isActive ? chalk.green(name) : chalk.white(name);
      console.log(
        `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${
          preset.model
        }`
      );
      if (preset.description) {
        console.log(chalk.gray(`                   ${preset.description}`));
      }
    }
    console.log();
  }

  // Show API key status
  console.log(chalk.white("API Key Status:"));
  const hasOpenAI = configManager.hasApiKeyForProvider("openai");
  const hasAnthropic = configManager.hasApiKeyForProvider("anthropic");
  console.log(
    `  ${
      hasOpenAI ? chalk.green("✅") : chalk.red("❌")
    } OpenAI (POOLSIDE_OPENAI_API_KEY)`
  );
  console.log(
    `  ${
      hasAnthropic ? chalk.green("✅") : chalk.red("❌")
    } Anthropic (POOLSIDE_ANTHROPIC_API_KEY)`
  );
  console.log();

  // Show config file location
  console.log(chalk.gray(`Config file: ${configManager.getConfigPath()}`));
  console.log();

  // Show usage hints
  console.log(chalk.white("Usage:"));
  console.log(
    chalk.gray("  poolside config use <preset>    Switch active preset")
  );
  console.log(
    chalk.gray("  poolside config add <name>      Add custom preset")
  );
  console.log(
    chalk.gray("  poolside config remove <name>   Remove custom preset")
  );
  console.log(
    chalk.gray("  poolside diff --preset fast   One-time preset override")
  );
  console.log(
    chalk.gray(
      "  poolside diff --model anthropic:claude-3-haiku-20240307   Direct model"
    )
  );
}

async function configUseCommand(presetName: string): Promise<void> {
  const configManager = new ConfigManager();

  try {
    await configManager.setActivePreset(presetName);
    const preset = configManager.getPreset(presetName);

    console.log(chalk.green(`\n✅ Switched to preset: ${presetName}`));
    if (preset) {
      console.log(chalk.gray(`   Provider: ${preset.provider}`));
      console.log(chalk.gray(`   Model: ${preset.model}`));
      if (preset.description) {
        console.log(chalk.gray(`   ${preset.description}`));
      }
    }
    console.log();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

async function configAddCommand(
  name: string,
  options: { provider?: string; model?: string; description?: string }
): Promise<void> {
  const configManager = new ConfigManager();

  // Check if preset name already exists
  if (configManager.presetExists(name)) {
    if (BUILT_IN_PRESETS[name]) {
      console.error(
        chalk.red(`\n❌ Cannot overwrite built-in preset "${name}"`)
      );
    } else {
      console.error(
        chalk.red(`\n❌ Preset "${name}" already exists. Remove it first.`)
      );
    }
    process.exit(1);
  }

  let provider: AIProvider;
  let model: string;
  let description: string | undefined = options.description;

  // If options provided, use them directly
  if (options.provider && options.model) {
    if (options.provider !== "openai" && options.provider !== "anthropic") {
      console.error(chalk.red('\n❌ Provider must be "openai" or "anthropic"'));
      process.exit(1);
    }
    provider = options.provider as AIProvider;
    model = options.model;
  } else {
    // Interactive mode
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select AI provider:",
        choices: [
          { name: "OpenAI", value: "openai" },
          { name: "Anthropic", value: "anthropic" },
        ],
        default: options.provider || "openai",
      },
      {
        type: "input",
        name: "model",
        message: "Enter model name:",
        default: options.model,
        validate: (input: string) =>
          input.trim().length > 0 || "Model name is required",
      },
      {
        type: "input",
        name: "description",
        message: "Enter description (optional):",
        default: options.description || "",
      },
    ]);

    provider = answers.provider;
    model = answers.model;
    description = answers.description || undefined;
  }

  const preset: ModelPreset = {
    name,
    provider,
    model,
    description,
  };

  try {
    await configManager.addPreset(preset);
    console.log(chalk.green(`\n✅ Added custom preset: ${name}`));
    console.log(chalk.gray(`   Provider: ${provider}`));
    console.log(chalk.gray(`   Model: ${model}`));
    if (description) {
      console.log(chalk.gray(`   ${description}`));
    }
    console.log();
    console.log(chalk.gray(`Use it with: poolside config use ${name}`));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

async function configRemoveCommand(name: string): Promise<void> {
  const configManager = new ConfigManager();

  try {
    await configManager.removePreset(name);
    console.log(chalk.green(`\n✅ Removed custom preset: ${name}`));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

program.parse();
