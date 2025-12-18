import { exec } from "node:child_process";
import { promisify } from "node:util";
import { generateText } from "ai";
import ora from "ora";
import chalk from "chalk";
import type { AIProcessor } from "./ai-processor.js";
import type { DiffSummary, ChangeItem, CommitMeta } from "./slack-client.js";

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
 * Parse the output of git log with custom format into commit info
 * Format expected: "hash|author|message" (using | as delimiter)
 */
function parseLogOutput(logOutput: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const lines = logOutput.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    // Try to parse the new format: hash|author|message
    const parts = line.split("|");
    if (parts.length >= 3) {
      const hash = parts[0].trim();
      const author = parts[1].trim();
      const message = parts.slice(2).join("|").trim(); // Message may contain |
      commits.push({ hash, message, author });
    } else {
      // Fallback to old format: hash message
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      if (match) {
        commits.push({ hash: match[1], message: match[2] });
      }
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

    // Get commit log for the range with author info
    // Format: hash|author|message
    const logRange = range.includes("...") ? range : range.replace("..", "...");
    const logOutput = await runGitCommand(
      `log --format="%h|%an|%s" ${logRange}`,
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

Your response must include TWO parts:

### Part 1: Overview
Write a 1-3 sentence high-level summary of the overall changes. This should give readers a quick understanding of what this release/diff is about without reading the details.

### Part 2: Detailed Changes
Categorize specific impacts as:

1. **features** - New things users can now do (start with "You can now...")
2. **fixes** - Problems that no longer affect user workflows
3. **improvements** - Workflows that are now faster, easier, or more reliable
4. **breaking** - Changes users need to know about or take action on
5. **other** - Other workflow changes worth mentioning

For EACH change item, provide:
- **title**: A short headline (3-6 words) that captures the essence of the change
- **description**: What changed from the user's perspective (1-2 sentences)
- **observe**: How a user can see or verify this change in the product (e.g., "Navigate to Settings > Integrations", "Open a new project and look for...", "Try exporting a file and notice...")

CRITICAL GUIDELINES:
- Write from the USER'S perspective, not the developer's
- Focus on WORKFLOW IMPACT: How does this change the user's day-to-day experience?
- EXCLUDE: CI/CD changes, internal refactoring, test updates, documentation changes, dependency updates (unless security-related)
- Be specific about which workflows are affected when possible
- Use plain English - avoid technical jargon
- The "observe" field should be actionable - tell users exactly where to look or what to try
- If no customer-facing changes are found in a category, return an empty array for that category

DEDUPLICATION RULES (IMPORTANT):
- Each distinct change should appear ONLY ONCE across all categories
- Aggressively consolidate related changes into a single entry
- If multiple commits touch the same feature, summarize as ONE entry
- Never repeat the same information with different wording
- Prefer fewer, high-quality entries over many similar ones
- When in doubt, consolidate rather than list separately

TONE: Professional and concise. No marketing fluff. State what changed clearly.

Return your analysis as a JSON object with this exact structure:
{
  "overview": "High-level summary of what changed in this release.",
  "features": [
    { "title": "New X Capability", "description": "You can now do X, making your workflow faster.", "observe": "Navigate to the X page and click the new button" }
  ],
  "fixes": [
    { "title": "Y Workflow Fixed", "description": "Fixed issue where Y happened unexpectedly.", "observe": "Try the workflow that previously caused Y - it now works correctly" }
  ],
  "improvements": [
    { "title": "Faster Z Performance", "description": "Enhanced Z for better performance.", "observe": "Open Z and notice faster load times" }
  ],
  "breaking": [],
  "other": []
}

Only return the JSON object, no additional text or markdown.`;
}

/**
 * Normalize a change item - handles both string and object formats
 */
function normalizeChangeItem(
  item: string | ChangeItem | Record<string, unknown>
): ChangeItem {
  if (typeof item === "string") {
    return { title: "Update", description: item };
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    const description = String(obj.description || obj.desc || "");
    return {
      title: String(obj.title || "Update"),
      description,
      observe: obj.observe ? String(obj.observe) : undefined,
    };
  }
  return { title: "Update", description: String(item) };
}

/**
 * Normalize an array of change items
 */
function normalizeChangeItems(items: unknown): ChangeItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeChangeItem)
    .filter((item) => item.description.length > 0);
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
      overview:
        typeof parsed.overview === "string" ? parsed.overview : undefined,
      features: normalizeChangeItems(parsed.features),
      fixes: normalizeChangeItems(parsed.fixes),
      improvements: normalizeChangeItems(parsed.improvements),
      breaking: normalizeChangeItems(parsed.breaking),
      other: normalizeChangeItems(parsed.other),
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

  // Try to extract overview from the beginning of the response
  const overviewMatch = response.match(/overview:?\s*([^\n]+)/i);
  if (overviewMatch) {
    result.overview = overviewMatch[1].trim();
  }

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
        .filter((line) => line.length > 0)
        .map((line) => ({ title: "Update", description: line }));
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
  options: { verbose?: boolean; repoUrl?: string } = {}
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

    // Add commit metadata to the summary
    summary.commits = diffData.commits.map((commit) => {
      const commitMeta: CommitMeta = {
        sha: commit.hash,
        message: commit.message,
        author: commit.author || "Unknown",
      };
      // Add commit URL if repo URL is provided
      if (options.repoUrl) {
        commitMeta.url = `${options.repoUrl.replace(/\/$/, "")}/commit/${
          commit.hash
        }`;
      }
      return commitMeta;
    });

    if (options.repoUrl) {
      summary.repoUrl = options.repoUrl;
    }

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
 * Format a single change item for text output with elegant header style
 */
function formatChangeItemText(item: ChangeItem): string[] {
  const lines: string[] = [];
  lines.push(`  ┌─ ${item.title}`);
  lines.push(`  │`);
  // Word wrap description at ~70 chars
  const wrapped = wrapText(item.description, 66);
  for (const line of wrapped) {
    lines.push(`  │  ${line}`);
  }
  if (item.observe) {
    lines.push(`  │`);
    lines.push(`  │  How to observe:`);
    const observeWrapped = wrapText(item.observe, 66);
    for (const line of observeWrapped) {
      lines.push(`  │  ${line}`);
    }
  }
  lines.push(`  └─`);
  return lines;
}

/**
 * Simple word wrap utility
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Add items to sections array with elegant formatting
 */
function addSection(
  sections: string[],
  title: string,
  items: ChangeItem[] | undefined
): void {
  if (items && items.length > 0) {
    sections.push(title);
    sections.push("");
    for (const item of items) {
      sections.push(...formatChangeItemText(item));
      sections.push("");
    }
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

  // Add overview section
  if (summary.overview) {
    sections.push("OVERVIEW");
    sections.push("─".repeat(50));
    const overviewWrapped = wrapText(summary.overview, 70);
    for (const line of overviewWrapped) {
      sections.push(line);
    }
    sections.push("");
  }

  // Add commits section
  if (summary.commits && summary.commits.length > 0) {
    sections.push("COMMITS");
    sections.push("─".repeat(50));
    for (const commit of summary.commits) {
      const shaDisplay = commit.url
        ? `${commit.sha} (${commit.url})`
        : commit.sha;
      sections.push(`  ${shaDisplay}`);
      sections.push(`  │ ${commit.message}`);
      sections.push(`  └─ by ${commit.author}`);
      sections.push("");
    }
  }

  addSection(sections, "BREAKING CHANGES", summary.breaking);
  addSection(sections, "FEATURES", summary.features);
  addSection(sections, "FIXES", summary.fixes);
  addSection(sections, "IMPROVEMENTS", summary.improvements);
  addSection(sections, "OTHER", summary.other);

  const hasContent =
    summary.overview ||
    (summary.commits && summary.commits.length > 0) ||
    (summary.breaking && summary.breaking.length > 0) ||
    (summary.features && summary.features.length > 0) ||
    (summary.fixes && summary.fixes.length > 0) ||
    (summary.improvements && summary.improvements.length > 0) ||
    (summary.other && summary.other.length > 0);

  if (!hasContent) {
    sections.push("No customer-facing changes detected.");
  }

  return sections.join("\n");
}

/**
 * Format a single change item for markdown output
 */
function formatChangeItemMarkdown(item: ChangeItem): string[] {
  const lines: string[] = [];
  lines.push(`### ${item.title}`);
  lines.push("");
  lines.push(item.description);
  if (item.observe) {
    lines.push("");
    lines.push(`> **How to observe:** ${item.observe}`);
  }
  lines.push("");
  return lines;
}

/**
 * Add items to sections array for markdown format
 */
function addSectionMarkdown(
  sections: string[],
  title: string,
  items: ChangeItem[] | undefined
): void {
  if (items && items.length > 0) {
    sections.push(title);
    sections.push("");
    for (const item of items) {
      sections.push(...formatChangeItemMarkdown(item));
    }
  }
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

  // Add overview section
  if (summary.overview) {
    sections.push("## Overview");
    sections.push(summary.overview);
    sections.push("");
  }

  // Add commits section
  if (summary.commits && summary.commits.length > 0) {
    sections.push("## Commits");
    sections.push("");
    sections.push("| SHA | Description | Author |");
    sections.push("|-----|-------------|--------|");
    for (const commit of summary.commits) {
      const shaDisplay = commit.url
        ? `[\`${commit.sha}\`](${commit.url})`
        : `\`${commit.sha}\``;
      // Escape pipe characters in message
      const escapedMessage = commit.message.replace(/\|/g, "\\|");
      sections.push(`| ${shaDisplay} | ${escapedMessage} | ${commit.author} |`);
    }
    sections.push("");
  }

  addSectionMarkdown(sections, "## Breaking Changes", summary.breaking);
  addSectionMarkdown(sections, "## Features", summary.features);
  addSectionMarkdown(sections, "## Fixes", summary.fixes);
  addSectionMarkdown(sections, "## Improvements", summary.improvements);
  addSectionMarkdown(sections, "## Other", summary.other);

  const hasContent =
    summary.overview ||
    (summary.commits && summary.commits.length > 0) ||
    (summary.breaking && summary.breaking.length > 0) ||
    (summary.features && summary.features.length > 0) ||
    (summary.fixes && summary.fixes.length > 0) ||
    (summary.improvements && summary.improvements.length > 0) ||
    (summary.other && summary.other.length > 0);

  if (!hasContent) {
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
  private repoUrl?: string;

  constructor(options: DiffOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Set the repository URL for generating commit links
   */
  setRepoUrl(url: string): void {
    this.repoUrl = url;
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
      repoUrl: this.repoUrl,
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
