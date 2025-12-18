import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  initChangelog,
  generateChangelogWorkflow,
} from "../src/init-changelog.js";

describe("Init Changelog", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "poolside-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("generateChangelogWorkflow", () => {
    it("should generate workflow without Slack", () => {
      const workflow = generateChangelogWorkflow(false);

      expect(workflow).toContain("name: Changelog");
      expect(workflow).toContain("pull_request:");
      expect(workflow).toContain("npx poolside@latest changelog");
      expect(workflow).toContain("POOLSIDE_OPENAI_API_KEY");
      expect(workflow).not.toContain("SLACK_WEBHOOK_URL");
      expect(workflow).not.toContain("Post to Slack");
    });

    it("should generate workflow with Slack", () => {
      const workflow = generateChangelogWorkflow(true);

      expect(workflow).toContain("name: Changelog");
      expect(workflow).toContain("pull_request:");
      expect(workflow).toContain("npx poolside@latest changelog");
      expect(workflow).toContain("POOLSIDE_OPENAI_API_KEY");
      expect(workflow).toContain("SLACK_WEBHOOK_URL");
      expect(workflow).toContain("Post to Slack");
      expect(workflow).toContain("--format slack");
    });

    it("should include correct GitHub Actions syntax", () => {
      const workflow = generateChangelogWorkflow(false);

      expect(workflow).toContain("uses: actions/checkout@v4");
      expect(workflow).toContain("uses: actions/setup-node@v4");
      expect(workflow).toContain("fetch-depth: 0");
      expect(workflow).toContain("node-version: 20");
      expect(workflow).toContain(
        "${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}"
      );
    });

    it("should only run on merged PRs to main/master", () => {
      const workflow = generateChangelogWorkflow(false);

      expect(workflow).toContain("types: [closed]");
      expect(workflow).toContain("branches: [main, master]");
      expect(workflow).toContain(
        "if: github.event.pull_request.merged == true"
      );
    });
  });

  describe("initChangelog", () => {
    it("should create workflow file in empty directory", async () => {
      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
      });

      expect(result.created).toBe(true);
      expect(result.workflowPath).toBe(
        path.join(tempDir, ".github", "workflows", "changelog.yml")
      );

      // Verify file was created
      const content = await fs.readFile(result.workflowPath, "utf-8");
      expect(content).toContain("name: Changelog");
      expect(content).not.toContain("SLACK_WEBHOOK_URL");
    });

    it("should create workflow with Slack integration", async () => {
      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: true,
      });

      expect(result.created).toBe(true);

      const content = await fs.readFile(result.workflowPath, "utf-8");
      expect(content).toContain("SLACK_WEBHOOK_URL");
      expect(content).toContain("Post to Slack");
    });

    it("should create .github/workflows directory structure", async () => {
      await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
      });

      // Verify directory structure
      const githubDir = path.join(tempDir, ".github");
      const workflowsDir = path.join(githubDir, "workflows");

      const githubStat = await fs.stat(githubDir);
      const workflowsStat = await fs.stat(workflowsDir);

      expect(githubStat.isDirectory()).toBe(true);
      expect(workflowsStat.isDirectory()).toBe(true);
    });

    it("should not overwrite existing file without force", async () => {
      // Create existing workflow
      const workflowDir = path.join(tempDir, ".github", "workflows");
      await fs.mkdir(workflowDir, { recursive: true });
      const workflowPath = path.join(workflowDir, "changelog.yml");
      await fs.writeFile(workflowPath, "existing content");

      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
        force: false,
      });

      expect(result.created).toBe(false);
      expect(result.alreadyExists).toBe(true);

      // Verify file was not modified
      const content = await fs.readFile(workflowPath, "utf-8");
      expect(content).toBe("existing content");
    });

    it("should overwrite existing file with force", async () => {
      // Create existing workflow
      const workflowDir = path.join(tempDir, ".github", "workflows");
      await fs.mkdir(workflowDir, { recursive: true });
      const workflowPath = path.join(workflowDir, "changelog.yml");
      await fs.writeFile(workflowPath, "existing content");

      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
        force: true,
      });

      expect(result.created).toBe(true);

      // Verify file was overwritten
      const content = await fs.readFile(workflowPath, "utf-8");
      expect(content).toContain("name: Changelog");
      expect(content).not.toBe("existing content");
    });

    it("should work with existing .github directory", async () => {
      // Create existing .github directory with other content
      const githubDir = path.join(tempDir, ".github");
      await fs.mkdir(githubDir, { recursive: true });
      await fs.writeFile(path.join(githubDir, "CODEOWNERS"), "* @owner");

      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
      });

      expect(result.created).toBe(true);

      // Verify CODEOWNERS still exists
      const codeowners = await fs.readFile(
        path.join(githubDir, "CODEOWNERS"),
        "utf-8"
      );
      expect(codeowners).toBe("* @owner");
    });

    it("should work with existing workflows directory", async () => {
      // Create existing workflows with another workflow
      const workflowsDir = path.join(tempDir, ".github", "workflows");
      await fs.mkdir(workflowsDir, { recursive: true });
      await fs.writeFile(path.join(workflowsDir, "ci.yml"), "name: CI");

      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
      });

      expect(result.created).toBe(true);

      // Verify ci.yml still exists
      const ci = await fs.readFile(path.join(workflowsDir, "ci.yml"), "utf-8");
      expect(ci).toBe("name: CI");
    });
  });

  describe("workflow content validation", () => {
    it("should produce valid YAML structure", async () => {
      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: true,
      });

      const content = await fs.readFile(result.workflowPath, "utf-8");

      // Basic YAML structure checks
      expect(content).toMatch(/^name: /m);
      expect(content).toMatch(/^on:/m);
      expect(content).toMatch(/^jobs:/m);
      expect(content).toMatch(/^\s+steps:/m);
    });

    it("should include all required PR metadata", async () => {
      const result = await initChangelog({
        targetDir: tempDir,
        includeSlack: false,
      });

      const content = await fs.readFile(result.workflowPath, "utf-8");

      expect(content).toContain("--pr-number");
      expect(content).toContain("--pr-url");
      expect(content).toContain("--title");
      expect(content).toContain("--range");
    });
  });
});
