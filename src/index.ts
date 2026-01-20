#!/usr/bin/env node

import { Command } from "commander";
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
  CREDENTIAL_ENV_MAP,
  type ModelPreset,
  type AIProvider,
  type CredentialKey,
} from "./model-config.js";
import { initChangelog, generateChangelogWorkflow } from "./init-changelog.js";
import { TranscriptChunker } from "./transcript-chunker.js";
import { MeetingExtractor } from "./meeting-extractor.js";
import { MeetingRefiner } from "./meeting-refiner.js";
import { MeetingGenerator } from "./meeting-generator.js";
import { MeetingEditor } from "./meeting-editor.js";
import type { ProcessedMeeting, ProcessingStats } from "./meeting-types.js";
import {
  createProgress,
  formatDuration,
  formatCount,
  type MeetingProgressReporter,
} from "./meeting-progress.js";
import {
  MeetingPipelineError,
  TranscriptError,
  formatError,
  TOTAL_STAGES,
} from "./meeting-errors.js";
import {
  validateModelConfig,
  validateTranscript,
} from "./model-validator.js";
import { slugify } from "./meeting-formatters.js";

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

// Get the current AI provider from environment or config
function getAIProvider(): AIProvider {
  const configManager = new ConfigManager();
  const config = configManager.readConfigSync();
  const provider = (process.env.POOLSIDE_AI_PROVIDER || config.credentials?.aiProvider)?.toLowerCase();
  if (provider === "anthropic") return "anthropic";
  return "openai";
}

// Get the API key for the current provider
function getAIApiKey(): string | undefined {
  const configManager = new ConfigManager();
  return configManager.getApiKeyForProvider(getAIProvider());
}

async function validateConfig(requiredFor: RequiredFor = "all"): Promise<void> {
  const configManager = new ConfigManager();
  const provider = getAIProvider();
  
  const apiKeyCredential: CredentialKey = provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey";
  const apiKeyDesc = provider === "anthropic" ? "Anthropic API Key" : "OpenAI API Key";

  const baseCredentials: Record<CredentialKey, string> = {
    [apiKeyCredential]: apiKeyDesc,
  } as Record<CredentialKey, string>;

  const jiraCredentials: Partial<Record<CredentialKey, string>> = {
    jiraHost: "JIRA Server Host",
    jiraUsername: "JIRA Username",
    jiraPassword: "JIRA Password/Token",
  };

  const githubCredentials: Partial<Record<CredentialKey, string>> = {
    githubToken: "GitHub Personal Access Token",
  };

  let requiredCredentials: Partial<Record<CredentialKey, string>> = {
    [apiKeyCredential]: baseCredentials[apiKeyCredential],
  };
  let optionalCredentials: Partial<Record<CredentialKey, string>> = {};

  if (requiredFor === "epic" || requiredFor === "all") {
    requiredCredentials = { ...requiredCredentials, ...jiraCredentials };
    optionalCredentials = { ...optionalCredentials, ...githubCredentials };
  } else if (requiredFor === "release-notes") {
    requiredCredentials = { ...requiredCredentials, ...githubCredentials };
    optionalCredentials = { ...optionalCredentials, ...jiraCredentials };
  }

  const missing: ValidationResult[] = [];
  const optional: ValidationResult[] = [];

  for (const [key, description] of Object.entries(requiredCredentials)) {
    const value = await configManager.getCredential(key as CredentialKey);
    if (!value) {
      const envVar = CREDENTIAL_ENV_MAP[key as CredentialKey];
      missing.push({ key: envVar, description });
    }
  }

  for (const [key, description] of Object.entries(optionalCredentials)) {
    const value = await configManager.getCredential(key as CredentialKey);
    if (!value) {
      const envVar = CREDENTIAL_ENV_MAP[key as CredentialKey];
      optional.push({ key: envVar, description });
    }
  }

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

    console.log(chalk.white("1. Run the interactive setup wizard:"));
    console.log(chalk.gray("   poolside setup\n"));

    console.log(chalk.white("2. Or set credentials directly:"));
    missing.forEach(({ key }) => {
      const credKey = ConfigManager.getCredentialKey(key);
      if (credKey) {
        console.log(chalk.cyan(`   poolside config set ${credKey} <value>`));
      }
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

    console.log(chalk.gray("\nCredentials are stored in: ~/.poolside/config.json"));
    console.log(chalk.gray("Environment variables (POOLSIDE_*) take precedence over config file."));

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
  const configManager = new ConfigManager();
  const config = configManager.readConfigSync();
  const provider = getAIProvider();
  const defaultModel =
    provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-5.2";

  const jiraHost = process.env.POOLSIDE_JIRA_HOST || config.credentials?.jiraHost;
  const jiraUsername = process.env.POOLSIDE_JIRA_USERNAME || config.credentials?.jiraUsername;
  const jiraPassword = process.env.POOLSIDE_JIRA_PASSWORD || config.credentials?.jiraPassword;
  const githubToken = process.env.POOLSIDE_GITHUB_TOKEN || config.credentials?.githubToken;
  const aiModel = process.env.POOLSIDE_AI_MODEL || config.credentials?.aiModel || defaultModel;
  const aiMaxTokens = process.env.POOLSIDE_AI_MAX_TOKENS || config.credentials?.aiMaxTokens || "4000";

  return {
    jira: {
      host: jiraHost?.replace(/^https?:\/\//, ""),
      username: jiraUsername,
      password: jiraPassword,
    },
    github: {
      token: githubToken,
    },
    ai: {
      provider,
      apiKey: getAIApiKey(),
      model: aiModel,
      maxTokens: Number.parseInt(String(aiMaxTokens)),
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
      model: config.aiConfig.model ?? "gpt-5.2",
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
        await validateConfig("epic");

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
        await validateConfig("epic");

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
        await validateConfig("epic");

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
      await validateConfig("epic");

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

program
  .command("process-meeting <file>")
  .description(
    "Process a meeting transcript to extract decisions, action items, and generate meeting notes"
  )
  .option("--no-prd", "Skip PRD generation even if deliverables are found")
  .option("--preset <name>", "Use a named preset (e.g., fast, quality, balanced, cheap)")
  .option(
    "--model <provider:model>",
    "Direct model override (e.g., anthropic:claude-3-haiku-20240307)"
  )
  .option("--verbose", "Show detailed debug information")
  .action(
    async (
      file: string,
      options: {
        prd: boolean;
        preset?: string;
        model?: string;
        verbose?: boolean;
      }
    ) => {
      const progress = createProgress({ verbose: options.verbose });
      const startTime = Date.now();

      try {
        const validationResult = await validateModelConfig({
          preset: options.preset,
          cliModel: options.model,
        });

        console.log(chalk.blue("\n🎙️  Processing meeting transcript..."));
        console.log(chalk.gray(`  File: ${file}`));
        console.log(chalk.gray(`  Model: ${validationResult.model} (${validationResult.provider})`));
        console.log();

        for (const warning of validationResult.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warning}`));
        }

        const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
        let transcript: string;
        try {
          transcript = await fs.readFile(filePath, "utf8");
        } catch (err: unknown) {
          throw new TranscriptError(
            `Failed to read transcript file: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err instanceof Error ? err : undefined }
          );
        }

        const transcriptValidation = validateTranscript(transcript);
        if (!transcriptValidation.valid) {
          throw new TranscriptError(transcriptValidation.error || "Invalid transcript");
        }

        progress.info(`Transcript: ${transcriptValidation.charCount.toLocaleString()} characters`);

        const componentConfig = {
          provider: validationResult.provider,
          model: validationResult.model,
          verbose: options.verbose,
          progress,
        };

        progress.start("Chunking transcript...");
        progress.setStage({ name: "chunking", number: 1, totalStages: TOTAL_STAGES });

        const chunker = new TranscriptChunker();
        const chunks = chunker.chunk(transcript);
        const metadata = chunker.extractMetadata(transcript);

        progress.succeed(`Chunking complete (${formatCount(chunks.length, "chunk")}, ${formatCount(metadata.attendees.length, "attendee")})`);

        progress.phaseIntro("Analyzing transcript with AI to extract decisions, actions, and deliverables...");
        progress.setStage({ name: "extraction", number: 2, totalStages: TOTAL_STAGES });

        const extractor = await MeetingExtractor.create(componentConfig);
        const extractionResult = await extractor.extractFromChunks(chunks);

        const totalDecisions = extractionResult.extractions.reduce(
          (sum, e) => sum + e.decisions.length,
          0
        );
        const totalActionItems = extractionResult.extractions.reduce(
          (sum, e) => sum + e.actionItems.length,
          0
        );
        const totalDeliverables = extractionResult.extractions.reduce(
          (sum, e) => sum + e.deliverables.length,
          0
        );

        progress.succeed(`Extraction complete (${totalDecisions} decisions, ${totalActionItems} actions, ${totalDeliverables} deliverables)`);

        progress.phaseIntro("Consolidating and deduplicating findings...");
        progress.setStage({ name: "refinement", number: 3, totalStages: TOTAL_STAGES });
        progress.start("Merging results from chunks...");

        const refiner = await MeetingRefiner.create(componentConfig);
        const refinementResult = await refiner.refine(extractionResult.extractions);

        progress.succeed(`Consolidated: ${refinementResult.refined.decisions.length} decisions, ${refinementResult.refined.actionItems.length} actions, ${refinementResult.refined.deliverables.length} deliverables`);

        progress.phaseIntro("Generating meeting notes and PRD...");
        progress.setStage({ name: "generation", number: 4, totalStages: TOTAL_STAGES });
        progress.start("Creating documents...");

        const generator = await MeetingGenerator.create(componentConfig);
        const generatorResult = await generator.generate(refinementResult.refined, {
          generatePrd: options.prd,
        });

        const prdText = generatorResult.prdGenerated ? " + PRD" : "";
        progress.succeed(`Meeting notes${prdText} generated`);

        progress.phaseIntro("Final polish for clarity and consistency...");
        progress.setStage({ name: "editing", number: 5, totalStages: TOTAL_STAGES });
        progress.start("Applying improvements...");

        const editor = await MeetingEditor.create(componentConfig);
        const editorResult = await editor.edit(generatorResult.resources);

        progress.succeed(`${formatCount(editorResult.changesApplied.length, "improvement")} applied`);

        const totalTime = Date.now() - startTime;
        const stats: ProcessingStats = {
          totalChunks: chunks.length,
          refinementPasses: 1,
          processingTimeMs: totalTime,
          decisionsFound: refinementResult.refined.decisions.length,
          actionItemsFound: refinementResult.refined.actionItems.length,
          deliverablesFound: refinementResult.refined.deliverables.length,
          prdGenerated: generatorResult.prdGenerated,
        };

        const title = editorResult.output.notes.title || "Meeting Notes";
        const slugifiedTitle = slugify(title);
        const dateId = (metadata.date || "undated").replace(/\//g, "-");
        const outputFilename = `${slugifiedTitle}-${dateId}.md`;
        const outputPath = path.resolve(process.cwd(), outputFilename);

        await fs.writeFile(outputPath, editorResult.output.markdown, "utf8");

        console.log(chalk.green(`\n✅ Complete! (${formatDuration(totalTime)})`));
        console.log(chalk.blue(`📄 ${outputFilename}`))

        if (options.verbose) {
          console.log(chalk.blue("\n📊 Processing Summary"));
          console.log(chalk.gray(`  Total chunks processed: ${stats.totalChunks}`));
          console.log(chalk.gray(`  Decisions extracted: ${stats.decisionsFound}`));
          console.log(chalk.gray(`  Action items extracted: ${stats.actionItemsFound}`));
          console.log(chalk.gray(`  Deliverables extracted: ${stats.deliverablesFound}`));
          console.log(chalk.gray(`  PRD generated: ${stats.prdGenerated ? "Yes" : "No"}`));
          console.log(chalk.gray(`  Total processing time: ${formatDuration(stats.processingTimeMs)}`));
        }
      } catch (error: unknown) {
        progress.stop();

        if (error instanceof MeetingPipelineError) {
          console.error(error.getFormattedMessage());
        } else {
          console.error(formatError(error));
        }
        process.exit(1);
      }
    }
  );

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
        await validateConfig("release-notes");

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
        await validateConfig("release-notes");

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
            model: "gpt-5.2",
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

// Changelog Command - Analyze git diff and generate customer-focused summary
program
  .command("changelog")
  .alias("diff")
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
        const changelogConfigManager = new ConfigManager();
        const webhookUrl =
          options.slackWebhook || await changelogConfigManager.getCredential("slackWebhookUrl") as string | undefined;

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
  .description("Interactive setup wizard and project scaffolding commands");

setupProgram.action(async () => {
  await runSetupWizard();
});

setupProgram
  .command("jira-pat")
  .description("Set up JIRA Personal Access Token for better security")
  .option("--jira-base-url <url>", "JIRA base URL (overrides env var)")
  .action(async (options: { jiraBaseUrl?: string }) => {
    await setupJiraPATCommand(options);
  });

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

setupProgram
  .command("changelog")
  .description(
    "Add GitHub Actions workflow for AI-powered PR changelog summaries"
  )
  .option("--no-slack", "Skip Slack integration setup")
  .option("--force", "Overwrite existing workflow file")
  .option("--dry-run", "Preview what would be created without writing files")
  .action(
    async (options: { slack: boolean; force?: boolean; dryRun?: boolean }) => {
      await setupChangelogCommand(options);
    }
  );

async function runSetupWizard(): Promise<void> {
  console.log(chalk.blue("🚀 Poolside CLI Setup Wizard"));
  console.log(chalk.gray("═══════════════════════════════════"));
  console.log();

  const configManager = new ConfigManager();
  const configPath = configManager.getConfigPath();

  console.log(chalk.blue("🔍 Analyzing current configuration..."));
  console.log(chalk.gray(`Config file: ${configPath}`));
  console.log();

  const hasOpenAI = !!await configManager.getCredential("openaiApiKey");
  const hasAnthropic = !!await configManager.getCredential("anthropicApiKey");
  const hasAI = hasOpenAI || hasAnthropic;
  const hasJiraHost = !!await configManager.getCredential("jiraHost");
  const hasJiraUsername = !!await configManager.getCredential("jiraUsername");
  const hasJiraPassword = !!await configManager.getCredential("jiraPassword");
  const hasJira = hasJiraHost && hasJiraUsername && hasJiraPassword;
  const hasGitHub = !!await configManager.getCredential("githubToken");

  if (hasOpenAI && hasAnthropic) {
    console.log(chalk.green("✅ Both OpenAI and Anthropic API keys configured"));
    const provider = getAIProvider();
    console.log(chalk.gray(`   Active provider: ${provider}`));
  } else if (hasOpenAI) {
    console.log(chalk.green("✅ OpenAI API key configured"));
  } else if (hasAnthropic) {
    console.log(chalk.green("✅ Anthropic API key configured"));
  } else {
    console.log(chalk.red("❌ No AI provider configured (OpenAI or Anthropic)"));
  }

  if (hasJira) {
    console.log(chalk.green("✅ JIRA credentials configured"));
  } else if (hasJiraHost || hasJiraUsername || hasJiraPassword) {
    console.log(chalk.yellow("⚠️  JIRA credentials partially configured"));
  } else {
    console.log(chalk.red("❌ JIRA credentials not configured"));
  }

  if (hasGitHub) {
    console.log(chalk.green("✅ GitHub token configured"));
  } else {
    console.log(chalk.yellow("⚠️  GitHub token not configured"));
  }

  console.log();

  let releaseConfigExists = false;
  try {
    await fs.access("release-config.json");
    releaseConfigExists = true;
    console.log(chalk.green("✅ Release notes config found"));
  } catch {
    console.log(chalk.yellow("⚠️  Release notes config not found"));
  }

  console.log();

  const isWellConfigured = hasAI && (hasJira || hasGitHub);

  if (isWellConfigured && releaseConfigExists) {
    console.log(chalk.green("🎉 Your setup looks complete!"));
    console.log();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Test all connections", value: "test" },
          { name: "Set up JIRA Personal Access Token (recommended)", value: "jira-pat" },
          { name: "Configure credentials", value: "credentials" },
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    if (action === "exit") return;
    if (action === "credentials") {
      await promptForCredentials(configManager, { hasOpenAI, hasAnthropic, hasJira, hasGitHub });
      return;
    }
    await executeSetupAction(action, {});
    return;
  }

  const choices = [];

  if (!hasAI || !hasJira || !hasGitHub) {
    choices.push({ name: "Configure credentials", value: "credentials" });
  }

  if (hasJira) {
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

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices,
    },
  ]);

  if (action === "credentials") {
    await promptForCredentials(configManager, { hasOpenAI, hasAnthropic, hasJira, hasGitHub });
  } else {
    await executeSetupAction(action, {});
  }
}

async function promptForCredentials(
  configManager: ConfigManager,
  status: { hasOpenAI: boolean; hasAnthropic: boolean; hasJira: boolean; hasGitHub: boolean }
): Promise<void> {
  console.log(chalk.blue("\n📝 Configure Credentials"));
  console.log(chalk.gray("Credentials will be stored in: ~/.poolside/config.json"));
  console.log(chalk.gray("Environment variables (POOLSIDE_*) take precedence over config file.\n"));

  if (!status.hasOpenAI && !status.hasAnthropic) {
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Which AI provider would you like to configure?",
        choices: [
          { name: "OpenAI (recommended)", value: "openai" },
          { name: "Anthropic", value: "anthropic" },
          { name: "Skip", value: "skip" },
        ],
      },
    ]);

    if (provider === "openai") {
      const { apiKey } = await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "Enter your OpenAI API key (https://platform.openai.com/api-keys):",
          validate: (input: string) => input.trim().length > 0 || "API key is required",
        },
      ]);
      await configManager.setCredential("openaiApiKey", apiKey.trim());
      console.log(chalk.green("✅ OpenAI API key saved"));
    } else if (provider === "anthropic") {
      const { apiKey } = await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "Enter your Anthropic API key (https://console.anthropic.com/settings/keys):",
          validate: (input: string) => input.trim().length > 0 || "API key is required",
        },
      ]);
      await configManager.setCredential("anthropicApiKey", apiKey.trim());
      await configManager.setCredential("aiProvider", "anthropic");
      console.log(chalk.green("✅ Anthropic API key saved"));
    }
  }

  if (!status.hasJira) {
    const { configureJira } = await inquirer.prompt([
      {
        type: "confirm",
        name: "configureJira",
        message: "Would you like to configure JIRA credentials?",
        default: true,
      },
    ]);

    if (configureJira) {
      const jiraAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "host",
          message: "Enter your JIRA host (e.g., your-company.atlassian.net):",
          validate: (input: string) => input.trim().length > 0 || "JIRA host is required",
        },
        {
          type: "input",
          name: "username",
          message: "Enter your JIRA username/email:",
          validate: (input: string) => input.trim().length > 0 || "Username is required",
        },
        {
          type: "password",
          name: "password",
          message: "Enter your JIRA password or Personal Access Token:",
          validate: (input: string) => input.trim().length > 0 || "Password/token is required",
        },
      ]);

      const cleanHost = jiraAnswers.host.trim().replace(/^https?:\/\//, "");
      await configManager.setCredential("jiraHost", cleanHost);
      await configManager.setCredential("jiraUsername", jiraAnswers.username.trim());
      await configManager.setCredential("jiraPassword", jiraAnswers.password.trim());
      console.log(chalk.green("✅ JIRA credentials saved"));
    }
  }

  if (!status.hasGitHub) {
    const { configureGitHub } = await inquirer.prompt([
      {
        type: "confirm",
        name: "configureGitHub",
        message: "Would you like to configure a GitHub token?",
        default: true,
      },
    ]);

    if (configureGitHub) {
      console.log(chalk.gray("\nGet a GitHub token from:"));
      console.log(chalk.gray("  Classic: https://github.com/settings/tokens"));
      console.log(chalk.gray("  Fine-grained: https://github.com/settings/tokens?type=beta (recommended)"));
      console.log(chalk.gray("  Required permissions: Contents:Read, Metadata:Read, Pull requests:Read\n"));

      const { token } = await inquirer.prompt([
        {
          type: "password",
          name: "token",
          message: "Enter your GitHub Personal Access Token:",
          validate: (input: string) => input.trim().length > 0 || "Token is required",
        },
      ]);

      await configManager.setCredential("githubToken", token.trim());
      console.log(chalk.green("✅ GitHub token saved"));
    }
  }

  console.log(chalk.green("\n🎉 Credentials configured!"));
  console.log(chalk.gray(`Stored in: ${configManager.getConfigPath()}`));
  console.log(chalk.gray("\nRun 'poolside config test' to verify your connections."));
  console.log(chalk.gray("Run 'poolside config' to view all stored credentials and presets.\n"));
}

async function executeSetupAction(action: string, options: Record<string, unknown>): Promise<void> {
  switch (action) {
    case "jira-pat":
      await setupJiraPATCommand({ jiraBaseUrl: options.jiraBaseUrl as string | undefined });
      break;
    case "release":
      await setupReleaseCommand({ output: "release-config.json" });
      break;
    case "changelog":
      await setupChangelogCommand({ slack: true, force: false, dryRun: false });
      break;
    case "test":
      await configTestCommand({ verbose: options.verbose as boolean | undefined });
      break;
  }
}

// Move existing command implementations to functions
async function setupJiraPATCommand(options: {
  jiraBaseUrl?: string;
}): Promise<void> {
  try {
    await validateConfig("epic");

    const { JiraPATManager } = await import("./jira-pat-manager.js");

    const configManager = new ConfigManager();
    const jiraHost = options.jiraBaseUrl || await configManager.getCredential("jiraHost") as string | undefined;
    const jiraUsername = await configManager.getCredential("jiraUsername") as string | undefined;
    const jiraPassword = await configManager.getCredential("jiraPassword") as string | undefined;

    if (!jiraHost || !jiraUsername || !jiraPassword) {
      console.log(chalk.red("❌ JIRA configuration missing."));
      console.log(chalk.gray("Run 'poolside setup' to configure JIRA credentials."));
      console.log(chalk.gray("Or set credentials directly:"));
      console.log(chalk.gray("  poolside config set jiraHost your-company.atlassian.net"));
      console.log(chalk.gray("  poolside config set jiraUsername your_username"));
      console.log(chalk.gray("  poolside config set jiraPassword your_password"));
      process.exit(1);
    }

    const patManager = new JiraPATManager({
      host: jiraHost.replace(/^https?:\/\//, ""),
      username: jiraUsername,
      password: jiraPassword,
    });

    await patManager.setupPATWorkflow();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("❌ Error setting up JIRA PAT:"), errorMessage);
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
          model: "gpt-5.2",
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("❌ Error creating config file:"), errorMessage);
    process.exit(1);
  }
}

async function setupChangelogCommand(options: {
  slack: boolean;
  force?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  const isDryRun = options.dryRun ?? false;

  if (isDryRun) {
    console.log(
      chalk.magenta("\n🔍 DRY RUN MODE - No files will be written\n")
    );
  }

  console.log(chalk.blue("🏖️  Poolside Changelog Setup\n"));

  let includeSlack = false;
  if (options.slack) {
    const { wantSlack } = await inquirer.prompt([
      {
        type: "confirm",
        name: "wantSlack",
        message: "Include Slack integration for posting PR summaries?",
        default: true,
      },
    ]);
    includeSlack = wantSlack;
  }

  const workflowPath = path.join(
    process.cwd(),
    ".github",
    "workflows",
    "changelog.yml"
  );

  if (isDryRun) {
    let fileExists = false;
    try {
      await fs.access(workflowPath);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    console.log(chalk.white("Configuration:"));
    console.log(
      chalk.gray(`  • Slack integration: ${includeSlack ? "Yes" : "No"}`)
    );
    console.log(chalk.gray(`  • Target: ${workflowPath}`));
    console.log(chalk.gray(`  • File exists: ${fileExists ? "Yes" : "No"}`));
    if (fileExists && !options.force) {
      console.log(
        chalk.yellow(
          "\n⚠️  Would skip - file exists (use --force to overwrite)"
        )
      );
    } else if (fileExists && options.force) {
      console.log(chalk.yellow("\n⚠️  Would overwrite existing file"));
    }
    console.log();

    const workflowContent = generateChangelogWorkflow(includeSlack);
    console.log(chalk.white("Generated workflow content:"));
    console.log(chalk.gray("─".repeat(50)));
    console.log(chalk.cyan(workflowContent));
    console.log(chalk.gray("─".repeat(50)));

    console.log(chalk.magenta("\n✨ Dry run complete - no files were written"));
    console.log(chalk.gray("   Remove --dry-run to create the workflow\n"));
    return;
  }

  const result = await initChangelog({
    targetDir: process.cwd(),
    includeSlack,
    force: options.force,
  });

  if (!result.created && result.alreadyExists) {
    console.log(chalk.yellow("⚠️  Workflow file already exists at:"));
    console.log(chalk.gray(`   ${result.workflowPath}`));
    console.log(chalk.gray("\n   Use --force to overwrite\n"));
    return;
  }

  console.log(chalk.green("✅ Created .github/workflows/changelog.yml\n"));

  console.log(chalk.white("Next steps:\n"));

  console.log(chalk.cyan("  1. Add OPENAI_API_KEY to your repository secrets"));
  console.log(
    chalk.gray("     → Go to: Settings → Secrets and variables → Actions")
  );
  console.log(chalk.gray("     → Click 'New repository secret'"));
  console.log(chalk.gray("     → Name: OPENAI_API_KEY"));
  console.log(
    chalk.gray("     → Get key: https://platform.openai.com/api-keys\n")
  );

  if (includeSlack) {
    console.log(
      chalk.cyan("  2. Add SLACK_WEBHOOK_URL for Slack notifications")
    );
    console.log(
      chalk.gray("     → Create a Slack app: https://api.slack.com/apps")
    );
    console.log(chalk.gray("     → Enable Incoming Webhooks"));
    console.log(chalk.gray("     → Add webhook to your channel"));
    console.log(chalk.gray("     → Add the URL as a repository secret\n"));
  }

  console.log(
    chalk.cyan(`  ${includeSlack ? "3" : "2"}. Commit and push the workflow`)
  );
  console.log(chalk.gray("     git add .github/workflows/changelog.yml"));
  console.log(chalk.gray("     git commit -m 'Add PR changelog workflow'"));
  console.log(chalk.gray("     git push\n"));

  console.log(
    chalk.green("Done! PRs will now get AI-generated changelog summaries.\n")
  );

  console.log(chalk.gray("📖 Full documentation:"));
  console.log(
    chalk.gray("   https://github.com/poolside/poolside#changelog\n")
  );
}

async function configTestCommand(options: { verbose?: boolean }): Promise<void> {
  console.log(chalk.blue("🔗 Testing connections...\n"));

  try {
    const config = createWorkflowConfig();
    config.verbose = options.verbose || false;

    const workflow = new EpicWorkflow(config);
    await workflow.validateConnections();

    console.log(chalk.green("\n✅ All connections tested successfully!"));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red("❌ Connection test failed:"), errorMessage);
    process.exit(1);
  }
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

// ===========================
// Configuration Management Commands
// ===========================
const configProgram = program
  .command("config")
  .description("Configuration management for credentials and AI presets");

configProgram.action(async () => {
  await configMainCommand();
});

configProgram
  .command("show")
  .description("Display all credentials and presets (same as 'config')")
  .action(async () => {
    await configMainCommand();
  });

configProgram
  .command("set <key> <value>")
  .description("Set a credential value")
  .action(async (key: string, value: string) => {
    await configSetCommand(key, value);
  });

configProgram
  .command("get <key>")
  .description("Get a credential value (checks env var first, then config)")
  .action(async (key: string) => {
    await configGetCommand(key);
  });

configProgram
  .command("unset <key>")
  .description("Remove a stored credential from config")
  .action(async (key: string) => {
    await configUnsetCommand(key);
  });

configProgram
  .command("test")
  .description("Test connections to JIRA, GitHub, and AI provider")
  .option("--verbose", "Enable verbose logging for debugging")
  .action(async (options: { verbose?: boolean }) => {
    await configTestCommand(options);
  });

const presetProgram = configProgram
  .command("preset")
  .description("Manage AI model presets");

presetProgram
  .command("list")
  .description("List all available presets")
  .action(async () => {
    await configPresetListCommand();
  });

presetProgram
  .command("use <name>")
  .description("Switch active preset")
  .action(async (preset: string) => {
    await configPresetUseCommand(preset);
  });

presetProgram
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
      await configPresetAddCommand(name, options);
    }
  );

presetProgram
  .command("remove <name>")
  .description("Remove a custom preset")
  .action(async (name: string) => {
    await configPresetRemoveCommand(name);
  });

async function configMainCommand(): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.readConfig();
  const resolved = await configManager.resolveModel();
  const { stored, fromEnv, effective } = await configManager.getAllCredentials();

  console.log(chalk.blue("\n🔧 Poolside Configuration"));
  console.log(chalk.gray("═══════════════════════════════════\n"));

  console.log(chalk.white("Config file:"), chalk.gray(configManager.getConfigPath()));
  console.log();

  console.log(chalk.blue("📋 Credentials"));
  console.log(chalk.gray("─".repeat(40)));

  const allKeys = Object.keys(CREDENTIAL_ENV_MAP) as CredentialKey[];

  for (const key of allKeys) {
    const envVar = CREDENTIAL_ENV_MAP[key];
    const envValue = fromEnv[key];
    const storedValue = stored[key];
    const effectiveValue = effective[key];

    const hasValue = effectiveValue !== undefined;
    const marker = hasValue ? chalk.green("●") : chalk.gray("○");
    const keyStr = hasValue ? chalk.white(key) : chalk.gray(key);
    const source = envValue ? "(env)" : storedValue !== undefined ? "(config)" : "";

    if (hasValue) {
      const masked = maskSensitiveValue(key, String(effectiveValue));
      console.log(`${marker} ${keyStr}: ${masked} ${chalk.gray(source)}`);
    } else {
      console.log(`${marker} ${keyStr}: ${chalk.gray("Not set")}`);
    }
  }

  console.log();
  console.log(chalk.blue("🎛️  AI Model Configuration"));
  console.log(chalk.gray("─".repeat(40)));

  console.log(chalk.white("Current Model:"));
  console.log(chalk.green(`  Provider: ${resolved.provider}`));
  console.log(chalk.green(`  Model: ${resolved.model}`));
  console.log(chalk.gray(`  Source: ${resolved.source}`));
  console.log();

  console.log(chalk.white("Built-in Presets:"));
  for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
    const isActive = config.activePreset === name;
    const marker = isActive ? chalk.green("●") : chalk.gray("○");
    const nameStr = isActive ? chalk.green(name) : chalk.white(name);
    console.log(
      `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${preset.model}`
    );
  }

  const customPresets = Object.entries(config.presets || {});
  if (customPresets.length > 0) {
    console.log();
    console.log(chalk.white("Custom Presets:"));
    for (const [name, preset] of customPresets) {
      const isActive = config.activePreset === name;
      const marker = isActive ? chalk.green("●") : chalk.gray("○");
      const nameStr = isActive ? chalk.green(name) : chalk.white(name);
      console.log(
        `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${preset.model}`
      );
    }
  }

  console.log();
  console.log(chalk.gray("─".repeat(40)));
  console.log(chalk.white("\nUsage:"));
  console.log(chalk.gray("  poolside config set <key> <value>    Set a credential"));
  console.log(chalk.gray("  poolside config get <key>            Get a credential"));
  console.log(chalk.gray("  poolside config test                 Test all connections"));
  console.log(chalk.gray("  poolside config preset list          List AI presets"));
  console.log(chalk.gray("  poolside config preset use <name>    Switch active preset"));
}

async function configPresetListCommand(): Promise<void> {
  const configManager = new ConfigManager();
  const config = await configManager.readConfig();
  const resolved = await configManager.resolveModel();

  console.log(chalk.blue("\n🎛️  AI Model Presets"));
  console.log(chalk.gray("═══════════════════════════════════\n"));

  console.log(chalk.white("Current Model:"));
  console.log(chalk.green(`  Provider: ${resolved.provider}`));
  console.log(chalk.green(`  Model: ${resolved.model}`));
  console.log(chalk.gray(`  Source: ${resolved.source}`));
  console.log();

  console.log(chalk.white("Built-in Presets:"));
  for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
    const isActive = config.activePreset === name;
    const marker = isActive ? chalk.green("●") : chalk.gray("○");
    const nameStr = isActive ? chalk.green(name) : chalk.white(name);
    console.log(
      `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${preset.model}`
    );
    if (preset.description) {
      console.log(chalk.gray(`                   ${preset.description}`));
    }
  }
  console.log();

  const customPresets = Object.entries(config.presets || {});
  if (customPresets.length > 0) {
    console.log(chalk.white("Custom Presets:"));
    for (const [name, preset] of customPresets) {
      const isActive = config.activePreset === name;
      const marker = isActive ? chalk.green("●") : chalk.gray("○");
      const nameStr = isActive ? chalk.green(name) : chalk.white(name);
      console.log(
        `  ${marker} ${nameStr.padEnd(12)} ${chalk.cyan(preset.provider)}:${preset.model}`
      );
      if (preset.description) {
        console.log(chalk.gray(`                   ${preset.description}`));
      }
    }
    console.log();
  }

  console.log(chalk.white("API Key Status:"));
  const hasOpenAI = configManager.hasApiKeyForProvider("openai");
  const hasAnthropic = configManager.hasApiKeyForProvider("anthropic");
  console.log(
    `  ${hasOpenAI ? chalk.green("✅") : chalk.red("❌")} OpenAI`
  );
  console.log(
    `  ${hasAnthropic ? chalk.green("✅") : chalk.red("❌")} Anthropic`
  );
  console.log();

  console.log(chalk.white("Usage:"));
  console.log(chalk.gray("  poolside config preset use <name>     Switch active preset"));
  console.log(chalk.gray("  poolside config preset add <name>     Add custom preset"));
  console.log(chalk.gray("  poolside config preset remove <name>  Remove custom preset"));
  console.log(chalk.gray("  poolside diff --preset fast           One-time preset override"));
}

async function configPresetUseCommand(presetName: string): Promise<void> {
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

async function configPresetAddCommand(
  name: string,
  options: { provider?: string; model?: string; description?: string }
): Promise<void> {
  const configManager = new ConfigManager();

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

  if (options.provider && options.model) {
    if (options.provider !== "openai" && options.provider !== "anthropic") {
      console.error(chalk.red('\n❌ Provider must be "openai" or "anthropic"'));
      process.exit(1);
    }
    provider = options.provider as AIProvider;
    model = options.model;
  } else {
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
    console.log(chalk.gray(`Use it with: poolside config preset use ${name}`));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

async function configPresetRemoveCommand(name: string): Promise<void> {
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

async function configSetCommand(key: string, value: string): Promise<void> {
  const configManager = new ConfigManager();

  if (!ConfigManager.isValidCredentialKey(key)) {
    console.error(chalk.red(`\n❌ Invalid credential key: ${key}`));
    console.log(chalk.gray("\nValid keys:"));
    for (const [credKey, envVar] of Object.entries(CREDENTIAL_ENV_MAP)) {
      console.log(chalk.gray(`  ${credKey} (${envVar})`));
    }
    process.exit(1);
  }

  try {
    await configManager.setCredential(key, value);
    const envVar = ConfigManager.getEnvVarName(key);
    console.log(chalk.green(`\n✅ Stored ${key} in config`));
    console.log(chalk.gray(`   Environment variable: ${envVar}`));
    console.log(chalk.gray(`   Config file: ${configManager.getConfigPath()}`));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

async function configGetCommand(key: string): Promise<void> {
  const configManager = new ConfigManager();

  if (!ConfigManager.isValidCredentialKey(key)) {
    console.error(chalk.red(`\n❌ Invalid credential key: ${key}`));
    console.log(chalk.gray("\nValid keys:"));
    for (const [credKey, envVar] of Object.entries(CREDENTIAL_ENV_MAP)) {
      console.log(chalk.gray(`  ${credKey} (${envVar})`));
    }
    process.exit(1);
  }

  try {
    const value = await configManager.getCredential(key);
    const envVar = ConfigManager.getEnvVarName(key);
    const envValue = configManager.getCredentialFromEnv(key);

    console.log(chalk.blue(`\n🔑 ${key}`));
    console.log(chalk.gray(`   Environment variable: ${envVar}`));

    if (envValue) {
      const masked = maskSensitiveValue(key, envValue);
      console.log(chalk.green(`   From env: ${masked}`));
    }

    const config = await configManager.readConfig();
    const storedValue = config.credentials?.[key];
    if (storedValue !== undefined) {
      const masked = maskSensitiveValue(key, String(storedValue));
      console.log(chalk.cyan(`   From config: ${masked}`));
    }

    if (value !== undefined) {
      const masked = maskSensitiveValue(key, String(value));
      console.log(chalk.white(`   Effective value: ${masked}`));
      console.log(chalk.gray(`   Source: ${envValue ? "environment" : "config"}`));
    } else {
      console.log(chalk.yellow(`   Not set`));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

async function configUnsetCommand(key: string): Promise<void> {
  const configManager = new ConfigManager();

  if (!ConfigManager.isValidCredentialKey(key)) {
    console.error(chalk.red(`\n❌ Invalid credential key: ${key}`));
    console.log(chalk.gray("\nValid keys:"));
    for (const [credKey, envVar] of Object.entries(CREDENTIAL_ENV_MAP)) {
      console.log(chalk.gray(`  ${credKey} (${envVar})`));
    }
    process.exit(1);
  }

  try {
    await configManager.unsetCredential(key);
    console.log(chalk.green(`\n✅ Removed ${key} from config`));

    const envVar = ConfigManager.getEnvVarName(key);
    const envValue = configManager.getCredentialFromEnv(key);
    if (envValue) {
      console.log(
        chalk.yellow(`   Note: ${envVar} is still set in environment`)
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ ${errorMessage}`));
    process.exit(1);
  }
}

function maskSensitiveValue(key: CredentialKey, value: string): string {
  const sensitiveKeys: CredentialKey[] = [
    "openaiApiKey",
    "anthropicApiKey",
    "jiraPassword",
    "githubToken",
    "slackWebhookUrl",
  ];

  if (sensitiveKeys.includes(key) && value.length > 8) {
    return `${value.substring(0, 8)}...`;
  }

  return value;
}

program.parse();
