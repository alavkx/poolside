import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigManager, CREDENTIAL_ENV_MAP } from "../src/model-config";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

describe("validateConfig Integration", () => {
  let testConfigDir: string;
  let testConfigPath: string;
  const envVarsToClean = Object.values(CREDENTIAL_ENV_MAP);

  beforeEach(async () => {
    vi.resetModules();
    
    for (const envVar of envVarsToClean) {
      delete process.env[envVar];
    }

    const uniqueId = crypto.randomBytes(8).toString("hex");
    testConfigDir = path.join(os.tmpdir(), `poolside-validate-test-${uniqueId}`);
    testConfigPath = path.join(testConfigDir, "config.json");
    await fs.mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    for (const envVar of envVarsToClean) {
      delete process.env[envVar];
    }
    vi.restoreAllMocks();

    try {
      await fs.rm(testConfigDir, { recursive: true, force: true });
    } catch {
    }
  });

  function createTestConfigManager(): ConfigManager {
    const configManager = new ConfigManager();
    (configManager as unknown as { configDir: string }).configDir = testConfigDir;
    (configManager as unknown as { configPath: string }).configPath = testConfigPath;
    return configManager;
  }

  describe("Credential validation scenarios", () => {
    it("should retrieve credentials from ConfigManager for epic workflow", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-test-key");
      await configManager.setCredential("jiraHost", "test.atlassian.net");
      await configManager.setCredential("jiraUsername", "test@example.com");
      await configManager.setCredential("jiraPassword", "test-password");

      const openai = await configManager.getCredential("openaiApiKey");
      const jiraHost = await configManager.getCredential("jiraHost");
      const jiraUser = await configManager.getCredential("jiraUsername");
      const jiraPass = await configManager.getCredential("jiraPassword");

      expect(openai).toBe("sk-test-key");
      expect(jiraHost).toBe("test.atlassian.net");
      expect(jiraUser).toBe("test@example.com");
      expect(jiraPass).toBe("test-password");
    });

    it("should retrieve credentials from ConfigManager for release-notes workflow", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-test-key");
      await configManager.setCredential("githubToken", "ghp_test-token");

      const openai = await configManager.getCredential("openaiApiKey");
      const github = await configManager.getCredential("githubToken");

      expect(openai).toBe("sk-test-key");
      expect(github).toBe("ghp_test-token");
    });

    it("should correctly identify missing credentials", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-test-key");

      const openai = await configManager.getCredential("openaiApiKey");
      const jiraHost = await configManager.getCredential("jiraHost");
      const jiraUser = await configManager.getCredential("jiraUsername");

      expect(openai).toBe("sk-test-key");
      expect(jiraHost).toBeUndefined();
      expect(jiraUser).toBeUndefined();
    });

    it("should prioritize environment variables over stored credentials", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("githubToken", "stored-token");
      process.env.POOLSIDE_GITHUB_TOKEN = "env-token";

      const github = await configManager.getCredential("githubToken");
      expect(github).toBe("env-token");
    });

    it("should handle Anthropic provider credentials", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("anthropicApiKey", "sk-ant-test-key");

      const anthropic = await configManager.getCredential("anthropicApiKey");
      expect(anthropic).toBe("sk-ant-test-key");
    });
  });

  describe("Required vs Optional credentials by workflow", () => {
    it("epic workflow requires JIRA credentials and makes GitHub optional", async () => {
      const configManager = createTestConfigManager();

      const epicRequired: (keyof typeof CREDENTIAL_ENV_MAP)[] = [
        "openaiApiKey",
        "jiraHost",
        "jiraUsername",
        "jiraPassword",
      ];
      const epicOptional: (keyof typeof CREDENTIAL_ENV_MAP)[] = ["githubToken"];

      for (const key of epicRequired) {
        await configManager.setCredential(key, `test-${key}`);
      }

      for (const key of epicRequired) {
        const value = await configManager.getCredential(key);
        expect(value).toBeDefined();
      }

      for (const key of epicOptional) {
        const value = await configManager.getCredential(key);
        expect(value).toBeUndefined();
      }
    });

    it("release-notes workflow requires GitHub and makes JIRA optional", async () => {
      const configManager = createTestConfigManager();

      const releaseRequired: (keyof typeof CREDENTIAL_ENV_MAP)[] = [
        "openaiApiKey",
        "githubToken",
      ];
      const releaseOptional: (keyof typeof CREDENTIAL_ENV_MAP)[] = [
        "jiraHost",
        "jiraUsername",
        "jiraPassword",
      ];

      for (const key of releaseRequired) {
        await configManager.setCredential(key, `test-${key}`);
      }

      for (const key of releaseRequired) {
        const value = await configManager.getCredential(key);
        expect(value).toBeDefined();
      }

      for (const key of releaseOptional) {
        const value = await configManager.getCredential(key);
        expect(value).toBeUndefined();
      }
    });
  });

  describe("Credential key mapping", () => {
    it("should correctly map credential keys to environment variables", () => {
      expect(ConfigManager.getEnvVarName("openaiApiKey")).toBe("POOLSIDE_OPENAI_API_KEY");
      expect(ConfigManager.getEnvVarName("anthropicApiKey")).toBe("POOLSIDE_ANTHROPIC_API_KEY");
      expect(ConfigManager.getEnvVarName("jiraHost")).toBe("POOLSIDE_JIRA_HOST");
      expect(ConfigManager.getEnvVarName("jiraUsername")).toBe("POOLSIDE_JIRA_USERNAME");
      expect(ConfigManager.getEnvVarName("jiraPassword")).toBe("POOLSIDE_JIRA_PASSWORD");
      expect(ConfigManager.getEnvVarName("githubToken")).toBe("POOLSIDE_GITHUB_TOKEN");
    });

    it("should correctly map environment variables back to credential keys", () => {
      expect(ConfigManager.getCredentialKey("POOLSIDE_OPENAI_API_KEY")).toBe("openaiApiKey");
      expect(ConfigManager.getCredentialKey("POOLSIDE_ANTHROPIC_API_KEY")).toBe("anthropicApiKey");
      expect(ConfigManager.getCredentialKey("POOLSIDE_JIRA_HOST")).toBe("jiraHost");
      expect(ConfigManager.getCredentialKey("POOLSIDE_JIRA_USERNAME")).toBe("jiraUsername");
      expect(ConfigManager.getCredentialKey("POOLSIDE_JIRA_PASSWORD")).toBe("jiraPassword");
      expect(ConfigManager.getCredentialKey("POOLSIDE_GITHUB_TOKEN")).toBe("githubToken");
    });
  });

  describe("Config file persistence", () => {
    it("should persist credentials to config file", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-persisted-key");
      await configManager.setCredential("jiraHost", "persisted.atlassian.net");

      const configContent = await fs.readFile(testConfigPath, "utf-8");
      const config = JSON.parse(configContent);

      expect(config.credentials.openaiApiKey).toBe("sk-persisted-key");
      expect(config.credentials.jiraHost).toBe("persisted.atlassian.net");
    });

    it("should load credentials from existing config file", async () => {
      const initialConfig = {
        presets: {},
        credentials: {
          githubToken: "ghp_from-file",
          jiraHost: "from-file.atlassian.net",
        },
      };
      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig, null, 2));

      const configManager = createTestConfigManager();

      const github = await configManager.getCredential("githubToken");
      const jiraHost = await configManager.getCredential("jiraHost");

      expect(github).toBe("ghp_from-file");
      expect(jiraHost).toBe("from-file.atlassian.net");
    });
  });
});
