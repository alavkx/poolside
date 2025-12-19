import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigManager, BUILT_IN_PRESETS } from "../src/model-config";

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
      // No OpenAI key set

      const configManager = new ConfigManager();
      // Mock readConfig to return empty config (no activePreset)
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe(BUILT_IN_PRESETS.quality.model);
      expect(result.source).toBe("default");
    });

    it("should use balanced preset (OpenAI) when only OpenAI key is available", async () => {
      process.env.POOLSIDE_OPENAI_API_KEY = "sk-real-openai-key";
      // No Anthropic key set

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });

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

      const result = await configManager.resolveModel();

      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.balanced.model);
      expect(result.source).toBe("default");
    });

    it("should use balanced preset when no keys are available (error surfaces later)", async () => {
      // No keys set

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });

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

      const result = await configManager.resolveModel();

      // OpenAI key is a placeholder, so should use Anthropic
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe(BUILT_IN_PRESETS.quality.model);
    });

    it("should prioritize CLI preset over auto-detection", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";
      // No OpenAI key - would normally auto-detect to Anthropic

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });

      const result = await configManager.resolveModel({ cliPreset: "fast" });

      // CLI preset should override auto-detection
      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.fast.model);
      expect(result.source).toBe("cli-preset");
    });

    it("should prioritize CLI model over auto-detection", async () => {
      process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-api03-real-key";
      // No OpenAI key - would normally auto-detect to Anthropic

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({ presets: {} });

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
      // No OpenAI key - would normally auto-detect to Anthropic

      const configManager = new ConfigManager();
      vi.spyOn(configManager, "readConfig").mockResolvedValue({
        presets: {},
        activePreset: "fast", // Config has fast preset active
      });

      const result = await configManager.resolveModel();

      // Config activePreset should override auto-detection
      expect(result.provider).toBe("openai");
      expect(result.model).toBe(BUILT_IN_PRESETS.fast.model);
      expect(result.source).toBe("config");
    });
  });
});
