import { exec } from "node:child_process";
import { promisify } from "node:util";
import { generateText } from "ai";
import ora from "ora";
import chalk from "chalk";
import type { AIProcessor } from "./ai-processor.js";
import type { DiffSummary } from "./slack-client.js";

const execAsync = promisify(exec);

/**
 * Represents a single file change in a git diff
 */
export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Represents a single commit in a git range
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author?: string;
}

/**
 * Structured diff data extracted from git
 */
export interface DiffData {
  range: string;
  files: FileChange[];
  commits: CommitInfo[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  rawDiff?: string;
}

/**
 * Options for diff generation
 */
export interface DiffOptions {
  repoPath?: string;
  includeRawDiff?: boolean;
  maxDiffSize?: number;
  verbose?: boolean;
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  repoPath: process.cwd(),
  includeRawDiff: true,
  maxDiffSize: 50000,
  verbose: false,
};

/**
 * Execute a git command and return the output
 */
async function runGitCommand(
  command: string,
  repoPath: string,
  verbose: boolean
): Promise<string> {
  if (verbose) {
    console.log(chalk.gray(`🔧 [VERBOSE] Running: git ${command}`));
  }

  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
    });

    if (verbose && stderr) {
      console.log(chalk.gray(`🔧 [VERBOSE] stderr: ${stderr}`));
    }

    return stdout.trim();
  } catch (error: unknown) {
    if (error instanceof Error && "stderr" in error) {
      const gitError = error as Error & { stderr: string };
      throw new Error(
        `Git command failed: ${gitError.stderr || gitError.message}`
      );
    }
    throw error;
  }
}

/**
 * Parse a single stat line into a FileChange
 */
function parseStatLine(line: string): FileChange | null {
  // Skip the summary line
  if (line.includes("files changed") || line.includes("file changed")) {
    return null;
  }

  // Parse lines like: "src/file.ts | 25 ++++----"
  const statMatch = line.match(/^\s*(.+?)\s+\|\s+(.+)$/);
  if (!statMatch) return null;

  const filePath = statMatch[1].trim();
  const changes = statMatch[2].trim();

  // Check for binary file
  if (changes.toLowerCase().includes("bin")) {
    return { path: filePath, additions: 0, deletions: 0, binary: true };
  }

  // Parse additions and deletions from the change string
  const numberMatch = changes.match(/^(\d+)/);
  if (!numberMatch) return null;

  const totalChanges = Number.parseInt(numberMatch[1], 10);
  const additionsCount = (changes.match(/\+/g) || []).length;
  const deletionsCount = (changes.match(/-/g) || []).length;

  // Calculate proportions if we have plus/minus indicators
  if (additionsCount + deletionsCount > 0) {
    const total = additionsCount + deletionsCount;
    const additionRatio = additionsCount / total;
    return {
      path: filePath,
      additions: Math.round(totalChanges * additionRatio),
      deletions: Math.round(totalChanges * (1 - additionRatio)),
      binary: false,
    };
  }

  // All additions or no clear indicator
  return {
    path: filePath,
    additions: totalChanges,
    deletions: 0,
    binary: false,
  };
}

/**
 * Parse the output of git diff --stat into structured file changes
 */
function parseStatOutput(statOutput: string): FileChange[] {
  const lines = statOutput.split("\n").filter((line) => line.trim());
  const files: FileChange[] = [];

  for (const line of lines) {
    const fileChange = parseStatLine(line);
    if (fileChange) {
      files.push(fileChange);
    }
  }

  return files;
}

/**
 * Parse the output of git log --oneline into commit info
 */
function parseLogOutput(logOutput: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const lines = logOutput.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (match) {
      commits.push({ hash: match[1], message: match[2] });
    }
  }

  return commits;
}

/**
 * Extract file changes from raw diff output when stat output is unavailable
 */
function extractFilesFromDiff(diffOutput: string): FileChange[] {
  const files: FileChange[] = [];
  const seenFiles = new Set<string>();

  // Extract file paths from diff headers
  const fileMatches = diffOutput.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm);
  for (const match of fileMatches) {
    const filePath = match[2];
    if (!seenFiles.has(filePath)) {
      seenFiles.add(filePath);
      files.push({ path: filePath, additions: 0, deletions: 0, binary: false });
    }
  }

  // Count lines per file from the diff hunks
  const chunks = diffOutput.split(/^diff --git/m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    const pathMatch = chunk.match(/a\/(.+?) b\/(.+)/);
    if (pathMatch) {
      const filePath = pathMatch[2];
      const file = files.find((f) => f.path === filePath);
      if (file) {
        file.additions = (chunk.match(/^\+[^+]/gm) || []).length;
        file.deletions = (chunk.match(/^-[^-]/gm) || []).length;
      }
    }
  }

  return files;
}

/**
 * Log verbose file and commit information
 */
function logVerboseDetails(files: FileChange[], commits: CommitInfo[]): void {
  console.log(chalk.gray("\n🔧 [VERBOSE] Files changed:"));
  for (const f of files) {
    const changeStr = f.binary ? "binary" : `+${f.additions}/-${f.deletions}`;
    console.log(chalk.gray(`   • ${f.path} (${changeStr})`));
  }
  console.log(chalk.gray("\n🔧 [VERBOSE] Commits:"));
  for (const c of commits) {
    console.log(chalk.gray(`   • ${c.hash}: ${c.message}`));
  }
}

/**
 * Get diff data from a git range (commit range or branch comparison)
 */
export async function getDiffFromRange(
  range: string,
  options: DiffOptions = {}
): Promise<DiffData> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const spinner = ora(`Analyzing git diff for range: ${range}`).start();

  try {
    // Validate the range exists
    try {
      await runGitCommand(
        `rev-parse ${range.split("...")[0].split("..")[0]}`,
        opts.repoPath,
        opts.verbose
      );
    } catch {
      spinner.fail(`Invalid git range: ${range}`);
      throw new Error(
        `Invalid git range: ${range}. Ensure the commits/branches exist.`
      );
    }

    // Get diff stat
    const statOutput = await runGitCommand(
      `diff --stat ${range}`,
      opts.repoPath,
      opts.verbose
    );

    // Get commit log for the range
    const logRange = range.includes("...") ? range : range.replace("..", "...");
    const logOutput = await runGitCommand(
      `log --oneline ${logRange}`,
      opts.repoPath,
      opts.verbose
    );

    // Parse the outputs
    const files = parseStatOutput(statOutput);
    const commits = parseLogOutput(logOutput);

    // Calculate totals
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    // Optionally get raw diff (limited size)
    let rawDiff: string | undefined;
    if (opts.includeRawDiff) {
      const fullDiff = await runGitCommand(
        `diff ${range}`,
        opts.repoPath,
        opts.verbose
      );

      if (fullDiff.length > opts.maxDiffSize) {
        rawDiff = `${fullDiff.substring(
          0,
          opts.maxDiffSize
        )}\n... (diff truncated)`;
        if (opts.verbose) {
          console.log(
            chalk.yellow(
              `🔧 [VERBOSE] Diff truncated from ${fullDiff.length} to ${opts.maxDiffSize} characters`
            )
          );
        }
      } else {
        rawDiff = fullDiff;
      }
    }

    spinner.succeed(
      `Analyzed ${files.length} files, ${commits.length} commits (+${totalAdditions}/-${totalDeletions})`
    );

    if (opts.verbose) {
      logVerboseDetails(files, commits);
    }

    return {
      range,
      files,
      commits,
      totalAdditions,
      totalDeletions,
      totalFiles: files.length,
      rawDiff,
    };
  } catch (error) {
    spinner.fail("Failed to analyze git diff");
    throw error;
  }
}

/**
 * Parse raw diff output into structured data (alternative to getDiffFromRange)
 */
export function parseDiffOutput(
  diffOutput: string,
  statOutput?: string,
  logOutput?: string
): DiffData {
  const files = statOutput
    ? parseStatOutput(statOutput)
    : extractFilesFromDiff(diffOutput);
  const commits = logOutput ? parseLogOutput(logOutput) : [];

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    range: "parsed",
    files,
    commits,
    totalAdditions,
    totalDeletions,
    totalFiles: files.length,
    rawDiff: diffOutput,
  };
}

/**
 * Build a prompt for AI to analyze the diff and generate customer-focused summary.
 * Optimized for Customer Success teams - uses workflow-focused language.
 */
function buildDiffAnalysisPrompt(diffData: DiffData): string {
  const commitsList = diffData.commits.map((c) => `• ${c.message}`).join("\n");

  const filesList = diffData.files
    .slice(0, 50)
    .map((f) => {
      const changeStr = f.binary ? "binary" : `+${f.additions}/-${f.deletions}`;
      return `• ${f.path} (${changeStr})`;
    })
    .join("\n");

  const moreFiles =
    diffData.files.length > 50
      ? `\n... and ${diffData.files.length - 50} more files`
      : "";

  // Include a sample of the raw diff if available
  let diffSample = "";
  if (diffData.rawDiff) {
    const maxSampleSize = 15000;
    diffSample =
      diffData.rawDiff.length > maxSampleSize
        ? `${diffData.rawDiff.substring(0, maxSampleSize)}\n... (truncated)`
        : diffData.rawDiff;
  }

  return `You are analyzing a git diff to create a summary for Customer Success teams. Your goal is to explain what users can now do differently, not what developers changed.

## Git Range: ${diffData.range}

## Summary
- Total Files Changed: ${diffData.totalFiles}
- Lines Added: ${diffData.totalAdditions}
- Lines Deleted: ${diffData.totalDeletions}
- Total Commits: ${diffData.commits.length}

## Commit Messages
${commitsList || "No commits found"}

## Files Changed
${filesList}${moreFiles}

${
  diffSample
    ? `## Code Changes (Sample)\n\`\`\`diff\n${diffSample}\n\`\`\``
    : ""
}

## Instructions

Analyze these changes and describe what USERS can now do differently. Write for Customer Success teams who need to communicate value to customers.

Categorize impacts as:

1. **features** - New things users can now do (start with "You can now...")
2. **fixes** - Problems that no longer affect user workflows
3. **improvements** - Workflows that are now faster, easier, or more reliable
4. **breaking** - Changes users need to know about or take action on
5. **other** - Other workflow changes worth mentioning

CRITICAL GUIDELINES FOR CS-FOCUSED OUTPUT:
- Write from the USER'S perspective, not the developer's
- Use workflow-focused language: "You can now...", "Your [workflow] is now...", "When you [action], you'll now..."
- Focus on WORKFLOW IMPACT: How does this change the user's day-to-day experience?
- EXCLUDE: CI/CD changes, internal refactoring, test updates, documentation changes, dependency updates (unless security-related)
- Be specific about which workflows are affected when possible
- Use plain English - avoid technical jargon
- Consolidate related changes into single, meaningful entries
- If no customer-facing changes are found in a category, return an empty array for that category

LANGUAGE EXAMPLES:
- Instead of: "Added export functionality for reports"
  Write: "You can now export reports directly from the dashboard"
- Instead of: "Fixed null pointer exception in user service"
  Write: "Login issues that sometimes occurred during peak hours are now resolved"
- Instead of: "Improved database query performance"
  Write: "Your searches and filters now return results faster"

Return your analysis as a JSON object with this exact structure:
{
  "features": ["You can now...", "You can now..."],
  "fixes": ["Your [workflow] no longer..."],
  "improvements": ["Your [workflow] is now faster/easier..."],
  "breaking": [],
  "other": []
}

Only return the JSON object, no additional text or markdown.`;
}

/**
 * Parse AI response into DiffSummary structure
 */
function parseAIResponse(response: string): DiffSummary {
  try {
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      features: Array.isArray(parsed.features) ? parsed.features : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements
        : [],
      breaking: Array.isArray(parsed.breaking) ? parsed.breaking : [],
      other: Array.isArray(parsed.other) ? parsed.other : [],
    };
  } catch {
    console.warn(
      chalk.yellow(
        "Warning: Could not parse AI response as JSON, attempting text extraction"
      )
    );
    return extractTextSections(response);
  }
}

/**
 * Extract sections from text response when JSON parsing fails
 */
function extractTextSections(response: string): DiffSummary {
  const result: DiffSummary = {
    features: [],
    fixes: [],
    improvements: [],
    breaking: [],
    other: [],
  };

  type ArrayKeys = "features" | "fixes" | "improvements" | "breaking" | "other";
  const sections: Record<ArrayKeys, RegExp> = {
    features:
      /features?:?\s*([\s\S]*?)(?=(?:fixes?|improvements?|breaking|other|$))/i,
    fixes: /fixes?:?\s*([\s\S]*?)(?=(?:improvements?|breaking|other|$))/i,
    improvements: /improvements?:?\s*([\s\S]*?)(?=(?:breaking|other|$))/i,
    breaking: /breaking:?\s*([\s\S]*?)(?=(?:other|$))/i,
    other: /other:?\s*([\s\S]*?)$/i,
  };

  for (const [key, regex] of Object.entries(sections) as [
    ArrayKeys,
    RegExp
  ][]) {
    const match = response.match(regex);
    if (match) {
      const items = match[1]
        .split("\n")
        .map((line) => line.replace(/^[-•*]\s*/, "").trim())
        .filter((line) => line.length > 0);
      result[key] = items;
    }
  }

  return result;
}

/**
 * Generate a customer-focused diff summary using AI
 */
export async function generateDiffSummary(
  diffData: DiffData,
  aiProcessor: AIProcessor,
  options: { verbose?: boolean } = {}
): Promise<DiffSummary> {
  const spinner = ora("Analyzing changes with AI...").start();

  try {
    const prompt = buildDiffAnalysisPrompt(diffData);

    if (options.verbose) {
      console.log(
        chalk.gray("\n🔧 [VERBOSE] AI Prompt length:"),
        prompt.length,
        "characters"
      );
    }

    const { text, usage } = await generateText({
      model: aiProcessor.model,
      prompt,
      temperature: 0.2,
      maxTokens: 4000,
    });

    if (options.verbose) {
      console.log(chalk.gray("🔧 [VERBOSE] AI Response:"));
      console.log(chalk.gray(`   Length: ${text.length} characters`));
      if (usage) {
        console.log(chalk.gray(`   Tokens used: ${usage.totalTokens}`));
      }
    }

    const summary = parseAIResponse(text);
    const totalItems =
      (summary.features?.length || 0) +
      (summary.fixes?.length || 0) +
      (summary.improvements?.length || 0) +
      (summary.breaking?.length || 0) +
      (summary.other?.length || 0);

    spinner.succeed(`Identified ${totalItems} customer-facing changes`);

    if (options.verbose) {
      logVerboseSummary(summary);
    }

    return summary;
  } catch (error) {
    spinner.fail("Failed to analyze changes with AI");
    throw error;
  }
}

/**
 * Log verbose summary breakdown
 */
function logVerboseSummary(summary: DiffSummary): void {
  console.log(chalk.gray("\n🔧 [VERBOSE] Summary breakdown:"));
  console.log(chalk.gray(`   Features: ${summary.features?.length || 0}`));
  console.log(chalk.gray(`   Fixes: ${summary.fixes?.length || 0}`));
  console.log(
    chalk.gray(`   Improvements: ${summary.improvements?.length || 0}`)
  );
  console.log(chalk.gray(`   Breaking: ${summary.breaking?.length || 0}`));
  console.log(chalk.gray(`   Other: ${summary.other?.length || 0}`));
}

/**
 * Add items to sections array with prefix
 */
function addSection(
  sections: string[],
  title: string,
  items: string[] | undefined,
  prefix: string
): void {
  if (items && items.length > 0) {
    sections.push(title);
    for (const item of items) {
      sections.push(`${prefix}${item}`);
    }
    sections.push("");
  }
}

/**
 * Format diff summary as plain text
 */
export function formatAsText(summary: DiffSummary): string {
  const sections: string[] = [];

  if (summary.title) {
    sections.push(`# ${summary.title}`);
    sections.push("");
  }

  addSection(sections, "⚠️  BREAKING CHANGES:", summary.breaking, "  • ");
  addSection(sections, "✨ Features:", summary.features, "  • ");
  addSection(sections, "🐛 Fixes:", summary.fixes, "  • ");
  addSection(sections, "💪 Improvements:", summary.improvements, "  • ");
  addSection(sections, "📝 Other:", summary.other, "  • ");

  if (sections.length === 0) {
    sections.push("No customer-facing changes detected.");
  }

  return sections.join("\n");
}

/**
 * Format diff summary as markdown
 */
export function formatAsMarkdown(summary: DiffSummary): string {
  const sections: string[] = [];

  if (summary.title) {
    sections.push(`# ${summary.title}`);
    sections.push("");
  }

  if (summary.prNumber && summary.prUrl) {
    sections.push(`> PR [#${summary.prNumber}](${summary.prUrl})`);
    sections.push("");
  }

  addSection(sections, "## ⚠️ Breaking Changes", summary.breaking, "- ");
  addSection(sections, "## ✨ Features", summary.features, "- ");
  addSection(sections, "## 🐛 Fixes", summary.fixes, "- ");
  addSection(sections, "## 💪 Improvements", summary.improvements, "- ");
  addSection(sections, "## 📝 Other", summary.other, "- ");

  if (sections.length === 0 || (sections.length === 1 && summary.title)) {
    sections.push("*No customer-facing changes detected.*");
  }

  return sections.join("\n");
}

/**
 * Format diff summary as JSON
 */
export function formatAsJson(summary: DiffSummary): string {
  return JSON.stringify(summary, null, 2);
}

/**
 * DiffGenerator class for object-oriented usage
 */
export class DiffGenerator {
  private options: Required<DiffOptions>;

  constructor(options: DiffOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get structured diff data from a git range
   */
  async getDiff(range: string): Promise<DiffData> {
    return getDiffFromRange(range, this.options);
  }

  /**
   * Generate a customer-focused summary using AI
   */
  async generateSummary(
    diffData: DiffData,
    aiProcessor: AIProcessor
  ): Promise<DiffSummary> {
    return generateDiffSummary(diffData, aiProcessor, {
      verbose: this.options.verbose,
    });
  }

  /**
   * Get diff and generate summary in one call
   */
  async analyze(range: string, aiProcessor: AIProcessor): Promise<DiffSummary> {
    const diffData = await this.getDiff(range);
    return this.generateSummary(diffData, aiProcessor);
  }
}
