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

export interface DiffSummary {
  title?: string;
  prNumber?: number;
  prUrl?: string;
  features?: string[];
  fixes?: string[];
  improvements?: string[];
  breaking?: string[];
  other?: string[];
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
   * Format a diff summary as Slack blocks
   */
  static formatDiffSummary(summary: DiffSummary): SlackMessage {
    const blocks: SlackBlock[] = [];

    // Header with PR info
    const headerText = summary.prNumber
      ? `🔄 What's Changed (PR #${summary.prNumber})`
      : "🔄 What's Changed";

    blocks.push(SlackClient.header(headerText));

    if (summary.title) {
      blocks.push(
        SlackClient.section(
          `*${summary.title}*`,
          summary.prUrl
            ? SlackClient.buttonAccessory("View PR", summary.prUrl, "view_pr")
            : undefined
        )
      );
    }

    blocks.push(SlackClient.divider());

    // Breaking changes (most important - show first with warning)
    if (summary.breaking && summary.breaking.length > 0) {
      blocks.push(
        SlackClient.section(
          `⚠️ *Breaking Changes:*\n${summary.breaking
            .map((item) => `• ${item}`)
            .join("\n")}`
        )
      );
    }

    // Features
    if (summary.features && summary.features.length > 0) {
      blocks.push(
        SlackClient.section(
          `✨ *Features:*\n${summary.features
            .map((item) => `• ${item}`)
            .join("\n")}`
        )
      );
    }

    // Fixes
    if (summary.fixes && summary.fixes.length > 0) {
      blocks.push(
        SlackClient.section(
          `🐛 *Fixes:*\n${summary.fixes.map((item) => `• ${item}`).join("\n")}`
        )
      );
    }

    // Improvements
    if (summary.improvements && summary.improvements.length > 0) {
      blocks.push(
        SlackClient.section(
          `💪 *Improvements:*\n${summary.improvements
            .map((item) => `• ${item}`)
            .join("\n")}`
        )
      );
    }

    // Other changes
    if (summary.other && summary.other.length > 0) {
      blocks.push(
        SlackClient.section(
          `📝 *Other:*\n${summary.other.map((item) => `• ${item}`).join("\n")}`
        )
      );
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
      ? `What's Changed: ${fallbackParts.join(", ")}`
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
