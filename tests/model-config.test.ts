import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ConfigManager,
  BUILT_IN_PRESETS,
  CREDENTIAL_ENV_MAP,
  type CredentialKey,
  type PoolsideConfig,
  isReasoningModel,
} from "../src/model-config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("Model Config", () => {
  describe("resolveModel - API key auto-detection", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
      // Clear all relevant env vars
      delete process.env.POOLSIDE_OPENAI_API_KEY;
      delete process.env.POOLSIDE_ANTHROPIC_API_KEY;
      delete process.env.POOLSIDE_AI_MODEL;
      delete process.env.POOLSIDE_AI_PROVIDER;
      delete process.env.POOLSIDE_PRESET;
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.restoreAllMocks();
    });

    it("should use quality preset (Anthropic) when only Anthropic key is available", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe(BUILT_IN_PRESETS.quality.model);
      expect(result.source).toBe("default");
    });

    it("should use balanced preset (OpenAI) when only OpenAI key is available", async () => {
      process.env.POOLSIDE_OPENAI_API_KEY = "sk-real-openai-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.balanced.model);
      expect(result.source).toBe("default");
    });

    it("should use balanced preset (OpenAI) when both keys are available", async () => {
      process.env.POOLSIDE_OPENAI_API_KEY = "sk-real-openai-key";
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.balanced.model);
      expect(result.source).toBe("default");
    });

    it("should use balanced preset when no keys are available (error surfaces later)", async () => {
      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.balanced.model);
      expect(result.source).toBe("default");
    });

    it("should ignore placeholder API keys", async () => {
      process.env.POOLSIDE_OPENAI_API_KEY = "sk-your_openai_key_here";
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      // OpenAI key is a placeholder, so should use Anthropic
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe(BUILT_IN_PRESETS.quality.model);
    });

    it("should prioritize CLI preset over auto-detection", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel({ cliPreset: "fast" });

      // CLI preset should override auto-detection
      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.fast.model);
      expect(result.source).toBe("cli-preset");
    });

    it("should prioritize CLI model over auto-detection", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel({
        cliModel: "openai:gpt-3.5-turbo",
      });

      // CLI model should override auto-detection
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-3.5-turbo");
      expect(result.source).toBe("cli-model");
    });

    it("should prioritize activePreset from config over auto-detection", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({
        presets: {},
        activePreset: "fast",
      });
      vi.spyOn(configManager, "readConfigSync").mockReturnValue({ presets: {} });

      const result = await configManager.resolveModel();

      // Config activePreset should override auto-detection
      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.fast.model);
      expect(result.source).toBe("config");
    });
  });

  describe("Credential Storage", () => {
    const originalEnv = process.env;
    let testConfigDir: string;
    let testConfigPath: string;

    beforeEach(async () => {
      vi.resetModules();
      process.env = { ...originalEnv };

      for (const envVar of Object.values(CREDENTIAL_ENV_MAP)) {
        delete process.env[envVar];
      }

      testConfigDir = path.join(os.tmpdir(), `poolside-test-${Date.now()}`);
      testConfigPath = path.join(testConfigDir, "config.json");
      await fs.mkdir(testConfigDir, { recursive: true });
    });

    afterEach(async () => {
      process.env = originalEnv;
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

    it("should set and get a credential", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("githubToken", "ghp_test123456789");

      const value = await configManager.getCredential("githubToken");
      expect(value).toBe("ghp_test123456789");
    });

    it("should prioritize env var over stored credential", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("githubToken", "stored_token");
      process.env.POOLSIDE_GITHUB_TOKEN = "env_token";

      const value = await configManager.getCredential("githubToken");
      expect(value).toBe("env_token");
    });

    it("should return stored credential when env var is not set", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-stored-key");

      const value = await configManager.getCredential("openaiApiKey");
      expect(value).toBe("sk-stored-key");
    });

    it("should unset a credential", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("jiraHost", "example.atlassian.net");
      let value = await configManager.getCredential("jiraHost");
      expect(value).toBe("example.atlassian.net");

      await configManager.unsetCredential("jiraHost");
      value = await configManager.getCredential("jiraHost");
      expect(value).toBeUndefined();
    });

    it("should handle numeric credentials (aiMaxTokens)", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("aiMaxTokens", 8000);

      const value = await configManager.getCredential("aiMaxTokens");
      expect(value).toBe(8000);
    });

    it("should convert string to number for numeric credentials", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("aiMaxTokens", "4000" as unknown as number);

      const config = await configManager.readConfig();
      expect(config.credentials?.aiMaxTokens).toBe(4000);
    });

    it("should getAllCredentials with correct sources", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("jiraHost", "stored.atlassian.net");
      await configManager.setCredential("jiraUsername", "stored_user");
      process.env.POOLSIDE_JIRA_HOST = "env.atlassian.net";

      const { stored, fromEnv, effective } = await configManager.getAllCredentials();

      expect(stored.jiraHost).toBe("stored.atlassian.net");
      expect(stored.jiraUsername).toBe("stored_user");
      expect(fromEnv.jiraHost).toBe("env.atlassian.net");
      expect(fromEnv.jiraUsername).toBeUndefined();
      expect(effective.jiraHost).toBe("env.atlassian.net");
      expect(effective.jiraUsername).toBe("stored_user");
    });

    it("should validate credential keys", () => {
      expect(ConfigManager.isValidCredentialKey("githubToken")).toBe(true);
      expect(ConfigManager.isValidCredentialKey("openaiApiKey")).toBe(true);
      expect(ConfigManager.isValidCredentialKey("invalidKey")).toBe(false);
      expect(ConfigManager.isValidCredentialKey("")).toBe(false);
    });

    it("should convert between env var names and credential keys", () => {
      expect(ConfigManager.getEnvVarName("githubToken")).toBe("POOLSIDE_GITHUB_TOKEN");
      expect(ConfigManager.getEnvVarName("openaiApiKey")).toBe("POOLSIDE_OPENAI_API_KEY");

      expect(ConfigManager.getCredentialKey("POOLSIDE_GITHUB_TOKEN")).toBe("githubToken");
      expect(ConfigManager.getCredentialKey("POOLSIDE_OPENAI_API_KEY")).toBe("openaiApiKey");
      expect(ConfigManager.getCredentialKey("INVALID_VAR")).toBeUndefined();
    });

    it("should store multiple credentials without overwriting others", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("githubToken", "ghp_token");
      await configManager.setCredential("jiraHost", "jira.example.com");
      await configManager.setCredential("aiModel", "gpt-5");

      const githubToken = await configManager.getCredential("githubToken");
      const jiraHost = await configManager.getCredential("jiraHost");
      const aiModel = await configManager.getCredential("aiModel");

      expect(githubToken).toBe("ghp_token");
      expect(jiraHost).toBe("jira.example.com");
      expect(aiModel).toBe("gpt-5");
    });

    it("should clean up empty credentials object when last credential is removed", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("githubToken", "ghp_token");
      await configManager.unsetCredential("githubToken");

      const config = await configManager.readConfig();
      expect(config.credentials).toBeUndefined();
    });

    it("should use stored API key in getApiKeyForProvider when env is not set", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("openaiApiKey", "sk-stored-openai-key");

      vi.spyOn(configManager, "readConfigSync").mockReturnValue({
        presets: {},
        credentials: { openaiApiKey: "sk-stored-openai-key" },
      });

      const apiKey = configManager.getApiKeyForProvider("openai");
      expect(apiKey).toBe("sk-stored-openai-key");
    });

    it("should use stored Anthropic API key in getApiKeyForProvider when env is not set", async () => {
      const configManager = createTestConfigManager();

      await configManager.setCredential("anthropicApiKey", "sk-ant-stored-key");

      vi.spyOn(configManager, "readConfigSync").mockReturnValue({
        presets: {},
        credentials: { anthropicApiKey: "sk-ant-stored-key" },
      });

      const apiKey = configManager.getApiKeyForProvider("anthropic");
      expect(apiKey).toBe("sk-ant-stored-key");
    });

    it("should prefer env API key over stored key", async () => {
      const configManager = createTestConfigManager();
      process.env.POOLSIDE_OPENAI_API_KEY = "sk-env-key";

      vi.spyOn(configManager, "readConfigSync").mockReturnValue({
        presets: {},
        credentials: { openaiApiKey: "sk-stored-key" },
      });

      const apiKey = configManager.getApiKeyForProvider("openai");
      expect(apiKey).toBe("sk-env-key");
    });
  });
});

describe("isReasoningModel", () => {
  it("should return true for o1 models", () => {
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("o1-mini")).toBe(true);
    expect(isReasoningModel("o1-preview")).toBe(true);
  });

  it("should return true for o3 models", () => {
    expect(isReasoningModel("o3")).toBe(true);
    expect(isReasoningModel("o3-mini")).toBe(true);
  });

  it("should return true for gpt-5 models", () => {
    expect(isReasoningModel("gpt-5")).toBe(true);
    expect(isReasoningModel("gpt-5.2")).toBe(true);
    expect(isReasoningModel("gpt-5.2-mini")).toBe(true);
  });

  it("should return false for non-reasoning models", () => {
    expect(isReasoningModel("gpt-4")).toBe(false);
    expect(isReasoningModel("gpt-4-turbo")).toBe(false);
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("gpt-3.5-turbo")).toBe(false);
    expect(isReasoningModel("claude-3-opus")).toBe(false);
    expect(isReasoningModel("claude-sonnet-4-20250514")).toBe(false);
  });
});
