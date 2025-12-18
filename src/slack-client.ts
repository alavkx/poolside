import axios from "axios";
import ora from "ora";
import chalk from "chalk";

/**
 * Slack Block Kit types for rich message formatting
 */
export interface SlackHeaderBlock {
  type: "header";
  text: {
    type: "plain_text";
    text: string;
    emoji?: boolean;
  };
}

export interface SlackSectionBlock {
  type: "section";
  text: {
    type: "mrkdwn" | "plain_text";
    text: string;
  };
  accessory?: SlackAccessory;
}

export interface SlackDividerBlock {
  type: "divider";
}

export interface SlackContextBlock {
  type: "context";
  elements: Array<{
    type: "mrkdwn" | "plain_text" | "image";
    text?: string;
    image_url?: string;
    alt_text?: string;
  }>;
}

export interface SlackActionsBlock {
  type: "actions";
  elements: SlackButtonElement[];
}

export interface SlackButtonElement {
  type: "button";
  text: {
    type: "plain_text";
    text: string;
    emoji?: boolean;
  };
  url?: string;
  style?: "primary" | "danger";
  action_id: string;
}

export interface SlackAccessory {
  type: "button";
  text: {
    type: "plain_text";
    text: string;
    emoji?: boolean;
  };
  url?: string;
  action_id: string;
}

export type SlackBlock =
  | SlackHeaderBlock
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackContextBlock
  | SlackActionsBlock;

export interface SlackMessage {
  text: string; // Fallback text for notifications
  blocks?: SlackBlock[];
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

/**
 * A single change item with description and how to observe it in the product
 */
export interface ChangeItem {
  title: string; // Short headline for the change (3-6 words)
  description: string; // Full description of what changed
  observe?: string; // How to observe/verify this change in the product
}

/**
 * Commit metadata for display in diff summaries
 */
export interface CommitMeta {
  sha: string;
  message: string;
  author: string;
  url?: string; // Optional link to the commit on GitHub/GitLab
}

export interface DiffSummary {
  title?: string;
  prNumber?: number;
  prUrl?: string;
  repoUrl?: string; // Base repo URL for generating commit links
  overview?: string; // High-level summary of what changed
  commits?: CommitMeta[]; // Commit metadata
  features?: ChangeItem[];
  fixes?: ChangeItem[];
  improvements?: ChangeItem[];
  breaking?: ChangeItem[];
  other?: ChangeItem[];
}

export interface SlackClientConfig {
  webhookUrl: string;
}

export class SlackClient {
  private webhookUrl: string;

  constructor(config: SlackClientConfig) {
    if (!config.webhookUrl) {
      throw new Error(
        "Slack webhook URL is required. Pass --slack-webhook or set POOLSIDE_SLACK_WEBHOOK_URL environment variable."
      );
    }
    this.webhookUrl = config.webhookUrl;
  }

  /**
   * Post a message to Slack via webhook
   */
  async postMessage(message: SlackMessage): Promise<boolean> {
    const spinner = ora("Posting to Slack...").start();

    try {
      const response = await axios.post(this.webhookUrl, message, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      if (response.status === 200) {
        spinner.succeed("Posted to Slack successfully");
        return true;
      }

      spinner.fail(`Slack responded with status ${response.status}`);
      return false;
    } catch (error: unknown) {
      spinner.fail("Failed to post to Slack");

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          console.error(chalk.red("Bad request - check your message format:"));
          console.error(chalk.gray(JSON.stringify(message, null, 2)));
        } else if (error.response?.status === 403) {
          console.error(
            chalk.red("Webhook URL is invalid or has been revoked")
          );
        } else if (error.response?.status === 404) {
          console.error(
            chalk.red("Webhook URL not found - verify it's correct")
          );
        } else {
          console.error(chalk.red(`Slack API error: ${error.message}`));
        }
      } else if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }

      throw error;
    }
  }

  /**
   * Create a header block
   */
  static header(text: string): SlackHeaderBlock {
    return {
      type: "header",
      text: {
        type: "plain_text",
        text,
        emoji: true,
      },
    };
  }

  /**
   * Create a section block with markdown text
   */
  static section(text: string, accessory?: SlackAccessory): SlackSectionBlock {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
      ...(accessory && { accessory }),
    };
  }

  /**
   * Create a divider block
   */
  static divider(): SlackDividerBlock {
    return { type: "divider" };
  }

  /**
   * Create a context block with elements
   */
  static context(
    elements: Array<{ type: "mrkdwn" | "plain_text"; text: string }>
  ): SlackContextBlock {
    return {
      type: "context",
      elements,
    };
  }

  /**
   * Create a button accessory for a section
   */
  static buttonAccessory(
    text: string,
    url: string,
    actionId: string
  ): SlackAccessory {
    return {
      type: "button",
      text: {
        type: "plain_text",
        text,
        emoji: true,
      },
      url,
      action_id: actionId,
    };
  }

  /**
   * Format a change item for Slack display
   */
  private static formatChangeItem(item: ChangeItem): string {
    const lines = [`*${item.title}*`, `${item.description}`];
    if (item.observe) {
      lines.push(`_→ ${item.observe}_`);
    }
    return lines.join("\n");
  }

  /**
   * Generate a short headline from the overview or commit messages
   */
  private static generateShortHeadline(summary: DiffSummary): string {
    // Try to get a short headline from the overview
    if (summary.overview) {
      // Take first sentence or first ~50 chars
      const firstSentence = summary.overview.split(/[.!?]/)[0].trim();
      if (firstSentence.length <= 50) {
        return firstSentence;
      }
      // Truncate at word boundary
      const truncated = firstSentence.substring(0, 47).replace(/\s+\S*$/, "");
      return `${truncated}...`;
    }

    // Fall back to first commit message
    if (summary.commits && summary.commits.length > 0) {
      const msg = summary.commits[0].message;
      if (msg.length <= 50) {
        return msg;
      }
      const truncated = msg.substring(0, 47).replace(/\s+\S*$/, "");
      return `${truncated}...`;
    }

    // Last resort
    return "Code Changes";
  }

  /**
   * Format a diff summary as Slack blocks
   */
  static formatDiffSummary(summary: DiffSummary): SlackMessage {
    const blocks: SlackBlock[] = [];

    // Generate short headline with commit link
    const headline = SlackClient.generateShortHeadline(summary);
    const latestCommit = summary.commits?.[0];

    // Build header with commit link in parentheses
    let headerText = headline;
    if (latestCommit) {
      const shaDisplay = latestCommit.url
        ? `<${latestCommit.url}|${latestCommit.sha}>`
        : latestCommit.sha;
      headerText = `${headline} (${shaDisplay})`;
    }

    // Slack headers don't support links, so use a section with bold text instead
    blocks.push(SlackClient.section(`*${headerText}*`));

    if (summary.title) {
      blocks.push(
        SlackClient.section(
          summary.title,
          summary.prUrl
            ? SlackClient.buttonAccessory("View PR", summary.prUrl, "view_pr")
            : undefined
        )
      );
    }

    // Overview section
    if (summary.overview) {
      blocks.push(SlackClient.section(summary.overview));
    }

    // Commits section
    if (summary.commits && summary.commits.length > 0) {
      blocks.push(SlackClient.divider());
      blocks.push(SlackClient.section("*Commits*"));

      const commitLines = summary.commits.map((commit) => {
        const shaDisplay = commit.url
          ? `<${commit.url}|\`${commit.sha}\`>`
          : `\`${commit.sha}\``;
        return `${shaDisplay} ${commit.message} — _${commit.author}_`;
      });

      // Group commits in batches to avoid Slack block limits
      const maxCommitsPerBlock = 10;
      for (let i = 0; i < commitLines.length; i += maxCommitsPerBlock) {
        const batch = commitLines.slice(i, i + maxCommitsPerBlock);
        blocks.push(SlackClient.section(batch.join("\n")));
      }
    }

    blocks.push(SlackClient.divider());

    // Breaking changes (most important - show first)
    if (summary.breaking && summary.breaking.length > 0) {
      blocks.push(SlackClient.section("*Breaking Changes*"));
      for (const item of summary.breaking) {
        blocks.push(SlackClient.section(SlackClient.formatChangeItem(item)));
      }
    }

    // Features
    if (summary.features && summary.features.length > 0) {
      blocks.push(SlackClient.section("*Features*"));
      for (const item of summary.features) {
        blocks.push(SlackClient.section(SlackClient.formatChangeItem(item)));
      }
    }

    // Fixes
    if (summary.fixes && summary.fixes.length > 0) {
      blocks.push(SlackClient.section("*Fixes*"));
      for (const item of summary.fixes) {
        blocks.push(SlackClient.section(SlackClient.formatChangeItem(item)));
      }
    }

    // Improvements
    if (summary.improvements && summary.improvements.length > 0) {
      blocks.push(SlackClient.section("*Improvements*"));
      for (const item of summary.improvements) {
        blocks.push(SlackClient.section(SlackClient.formatChangeItem(item)));
      }
    }

    // Other changes
    if (summary.other && summary.other.length > 0) {
      blocks.push(SlackClient.section("*Other*"));
      for (const item of summary.other) {
        blocks.push(SlackClient.section(SlackClient.formatChangeItem(item)));
      }
    }

    // If no categorized changes, show a message
    const hasChanges =
      (summary.breaking && summary.breaking.length > 0) ||
      (summary.features && summary.features.length > 0) ||
      (summary.fixes && summary.fixes.length > 0) ||
      (summary.improvements && summary.improvements.length > 0) ||
      (summary.other && summary.other.length > 0);

    if (!hasChanges) {
      blocks.push(
        SlackClient.section("_No customer-facing changes detected._")
      );
    }

    // Build fallback text for notifications
    const fallbackParts: string[] = [];
    if (summary.features?.length)
      fallbackParts.push(`${summary.features.length} feature(s)`);
    if (summary.fixes?.length)
      fallbackParts.push(`${summary.fixes.length} fix(es)`);
    if (summary.improvements?.length)
      fallbackParts.push(`${summary.improvements.length} improvement(s)`);

    const fallbackText = hasChanges
      ? `${headline}: ${fallbackParts.join(", ")}`
      : "No customer-facing changes detected";

    return {
      text: fallbackText,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    };
  }

  /**
   * Format a simple text message as Slack blocks
   */
  static formatSimpleMessage(
    title: string,
    body: string,
    contextItems?: string[]
  ): SlackMessage {
    const blocks: SlackBlock[] = [
      SlackClient.header(title),
      SlackClient.section(body),
    ];

    if (contextItems && contextItems.length > 0) {
      blocks.push(SlackClient.divider());
      blocks.push(
        SlackClient.context(
          contextItems.map((item) => ({ type: "mrkdwn" as const, text: item }))
        )
      );
    }

    return {
      text: `${title}: ${body}`,
      blocks,
    };
  }

  /**
   * Validate webhook URL format
   */
  static isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname === "hooks.slack.com" &&
        parsed.pathname.startsWith("/services/")
      );
    } catch {
      return false;
    }
  }
}
