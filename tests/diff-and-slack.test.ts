import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseDiffOutput,
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
  DiffGenerator,
} from "../src/diff-generator.js";
import {
  SlackClient,
  type DiffSummary,
  type SlackMessage,
} from "../src/slack-client.js";

describe("Diff Generator", () => {
  describe("parseDiffOutput", () => {
    it("should extract files from a raw diff output", () => {
      const rawDiff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,10 @@
+import { newModule } from './new-module';
 import { existingModule } from './existing-module';
+
+const newFeature = true;
`;

      const result = parseDiffOutput(rawDiff);

      expect(result.files.length).toBe(1);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.totalFiles).toBe(1);
    });

    it("should parse stat output when provided", () => {
      const rawDiff = "diff content";
      const statOutput = ` src/index.ts | 25 ++++++++++---------
 src/utils.ts | 10 ++++++++++
 2 files changed, 26 insertions(+), 9 deletions(-)`;

      const result = parseDiffOutput(rawDiff, statOutput);

      expect(result.files.length).toBe(2);
      expect(result.files[0].path).toBe("src/index.ts");
      expect(result.files[1].path).toBe("src/utils.ts");
    });

    it("should parse log output for commits", () => {
      const rawDiff = "diff content";
      const logOutput = `abc1234 feat: add new feature
def5678 fix: resolve bug
aaa9012 chore: update deps`;

      const result = parseDiffOutput(rawDiff, undefined, logOutput);

      expect(result.commits.length).toBe(3);
      expect(result.commits[0].hash).toBe("abc1234");
      expect(result.commits[0].message).toBe("feat: add new feature");
      expect(result.commits[1].hash).toBe("def5678");
      expect(result.commits[2].hash).toBe("aaa9012");
    });

    it("should return empty arrays for no changes", () => {
      const result = parseDiffOutput("");

      expect(result.files).toEqual([]);
      expect(result.commits).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });
  });

  describe("formatAsText", () => {
    it("should format a summary with all sections", () => {
      const summary: DiffSummary = {
        title: "Test Release",
        features: ["You can now do X", "You can now do Y"],
        fixes: ["Fixed issue Z"],
        improvements: ["Performance improved"],
        breaking: [],
        other: [],
      };

      const output = formatAsText(summary);

      expect(output).toContain("# Test Release");
      expect(output).toContain("✨ Features:");
      expect(output).toContain("You can now do X");
      expect(output).toContain("You can now do Y");
      expect(output).toContain("🐛 Fixes:");
      expect(output).toContain("Fixed issue Z");
      expect(output).toContain("💪 Improvements:");
      expect(output).toContain("Performance improved");
    });

    it("should show breaking changes first", () => {
      const summary: DiffSummary = {
        features: ["New feature"],
        breaking: ["Breaking change here"],
        fixes: [],
        improvements: [],
        other: [],
      };

      const output = formatAsText(summary);
      const breakingIndex = output.indexOf("BREAKING CHANGES");
      const featuresIndex = output.indexOf("Features:");

      expect(breakingIndex).toBeLessThan(featuresIndex);
    });

    it("should handle empty summary", () => {
      const summary: DiffSummary = {
        features: [],
        fixes: [],
        improvements: [],
        breaking: [],
        other: [],
      };

      const output = formatAsText(summary);

      expect(output).toContain("No customer-facing changes detected");
    });
  });

  describe("formatAsMarkdown", () => {
    it("should format a summary as markdown", () => {
      const summary: DiffSummary = {
        title: "Release 1.0",
        prNumber: 123,
        prUrl: "https://github.com/test/repo/pull/123",
        features: ["Feature one"],
        fixes: ["Fix one"],
        improvements: [],
        breaking: [],
        other: [],
      };

      const output = formatAsMarkdown(summary);

      expect(output).toContain("# Release 1.0");
      expect(output).toContain("[#123]");
      expect(output).toContain("https://github.com/test/repo/pull/123");
      expect(output).toContain("## ✨ Features");
      expect(output).toContain("- Feature one");
      expect(output).toContain("## 🐛 Fixes");
      expect(output).toContain("- Fix one");
    });

    it("should handle summary without PR info", () => {
      const summary: DiffSummary = {
        features: ["Just a feature"],
        fixes: [],
        improvements: [],
        breaking: [],
        other: [],
      };

      const output = formatAsMarkdown(summary);

      expect(output).not.toContain("PR #");
      expect(output).toContain("- Just a feature");
    });
  });

  describe("formatAsJson", () => {
    it("should return valid JSON", () => {
      const summary: DiffSummary = {
        title: "Test",
        features: ["Feature 1"],
        fixes: ["Fix 1"],
        improvements: [],
        breaking: [],
        other: [],
      };

      const output = formatAsJson(summary);
      const parsed = JSON.parse(output);

      expect(parsed.title).toBe("Test");
      expect(parsed.features).toEqual(["Feature 1"]);
      expect(parsed.fixes).toEqual(["Fix 1"]);
    });
  });

  describe("DiffGenerator class", () => {
    it("should initialize with default options", () => {
      const generator = new DiffGenerator();
      expect(generator).toBeDefined();
    });

    it("should initialize with custom options", () => {
      const generator = new DiffGenerator({
        repoPath: "/custom/path",
        verbose: true,
        includeRawDiff: false,
      });
      expect(generator).toBeDefined();
    });
  });
});

describe("Slack Client", () => {
  describe("constructor", () => {
    it("should initialize with valid webhook URL", () => {
      const client = new SlackClient({
        webhookUrl: "https://hooks.slack.com/services/xxx/yyy/zzz",
      });

      expect(client).toBeDefined();
    });

    it("should throw error without webhook URL", () => {
      expect(() => {
        new SlackClient({ webhookUrl: "" });
      }).toThrow("Slack webhook URL is required");
    });
  });

  describe("isValidWebhookUrl", () => {
    it("should validate correct Slack webhook URLs", () => {
      expect(
        SlackClient.isValidWebhookUrl(
          "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXX"
        )
      ).toBe(true);
    });

    it("should reject invalid URLs", () => {
      expect(SlackClient.isValidWebhookUrl("not-a-url")).toBe(false);
      expect(SlackClient.isValidWebhookUrl("https://example.com/webhook")).toBe(
        false
      );
      expect(
        SlackClient.isValidWebhookUrl("https://hooks.slack.com/invalid")
      ).toBe(false);
    });
  });

  describe("static block builders", () => {
    it("should create header block", () => {
      const block = SlackClient.header("Test Header");

      expect(block.type).toBe("header");
      expect(block.text.type).toBe("plain_text");
      expect(block.text.text).toBe("Test Header");
    });

    it("should create section block", () => {
      const block = SlackClient.section("Test content");

      expect(block.type).toBe("section");
      expect(block.text.type).toBe("mrkdwn");
      expect(block.text.text).toBe("Test content");
    });

    it("should create section with accessory", () => {
      const accessory = SlackClient.buttonAccessory(
        "Click me",
        "https://example.com",
        "button_1"
      );
      const block = SlackClient.section("Content", accessory);

      expect(block.accessory).toBeDefined();
      expect(block.accessory?.type).toBe("button");
      expect(block.accessory?.url).toBe("https://example.com");
    });

    it("should create divider block", () => {
      const block = SlackClient.divider();

      expect(block.type).toBe("divider");
    });

    it("should create context block", () => {
      const block = SlackClient.context([
        { type: "mrkdwn", text: "Context text" },
      ]);

      expect(block.type).toBe("context");
      expect(block.elements.length).toBe(1);
    });

    it("should create button accessory", () => {
      const button = SlackClient.buttonAccessory(
        "View",
        "https://example.com",
        "view_button"
      );

      expect(button.type).toBe("button");
      expect(button.text.text).toBe("View");
      expect(button.url).toBe("https://example.com");
      expect(button.action_id).toBe("view_button");
    });
  });

  describe("formatDiffSummary", () => {
    it("should format summary with all sections", () => {
      const summary: DiffSummary = {
        title: "Add user feature",
        prNumber: 42,
        prUrl: "https://github.com/test/repo/pull/42",
        features: ["You can now manage users"],
        fixes: ["Login no longer fails"],
        improvements: ["Faster search"],
        breaking: [],
        other: [],
      };

      const message = SlackClient.formatDiffSummary(summary);

      expect(message.text).toContain("1 feature(s)");
      expect(message.text).toContain("1 fix(es)");
      expect(message.text).toContain("1 improvement(s)");
      expect(message.blocks).toBeDefined();
      expect(message.blocks!.length).toBeGreaterThan(0);

      // Check for header with PR number
      const headerBlock = message.blocks!.find((b) => b.type === "header");
      expect(headerBlock).toBeDefined();
    });

    it("should include breaking changes with warning", () => {
      const summary: DiffSummary = {
        features: [],
        fixes: [],
        improvements: [],
        breaking: ["API endpoint changed"],
        other: [],
      };

      const message = SlackClient.formatDiffSummary(summary);
      const blockTexts = message
        .blocks!.filter(
          (b): b is { type: "section"; text: { text: string } } =>
            b.type === "section"
        )
        .map((b) => b.text.text);

      const hasBreaking = blockTexts.some(
        (text) => text.includes("Breaking") && text.includes("API endpoint")
      );
      expect(hasBreaking).toBe(true);
    });

    it("should show message when no changes detected", () => {
      const summary: DiffSummary = {
        features: [],
        fixes: [],
        improvements: [],
        breaking: [],
        other: [],
      };

      const message = SlackClient.formatDiffSummary(summary);

      expect(message.text).toContain("No customer-facing changes");
    });

    it("should include View PR button when URL provided", () => {
      const summary: DiffSummary = {
        title: "Test PR",
        prNumber: 1,
        prUrl: "https://github.com/test/repo/pull/1",
        features: ["New feature"],
        fixes: [],
        improvements: [],
        breaking: [],
        other: [],
      };

      const message = SlackClient.formatDiffSummary(summary);

      // Find section with accessory button
      const sectionWithButton = message.blocks!.find(
        (b): b is { type: "section"; accessory?: { url: string } } =>
          b.type === "section" && "accessory" in b && b.accessory !== undefined
      );

      expect(sectionWithButton?.accessory?.url).toBe(
        "https://github.com/test/repo/pull/1"
      );
    });
  });

  describe("formatSimpleMessage", () => {
    it("should create a simple message with title and body", () => {
      const message = SlackClient.formatSimpleMessage(
        "Test Title",
        "Test body content"
      );

      expect(message.text).toContain("Test Title");
      expect(message.text).toContain("Test body content");
      expect(message.blocks!.length).toBe(2);
    });

    it("should include context items when provided", () => {
      const message = SlackClient.formatSimpleMessage("Title", "Body", [
        "Context 1",
        "Context 2",
      ]);

      expect(message.blocks!.length).toBe(4); // header, section, divider, context
      const contextBlock = message.blocks!.find((b) => b.type === "context");
      expect(contextBlock).toBeDefined();
    });
  });
});
