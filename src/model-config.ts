import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

export type AIProvider = "openai" | "anthropic";

export interface ModelPreset {
  name: string;
  provider: AIProvider;
  model: string;
  description?: string;
}

export interface PoolsideCredentials {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  jiraHost?: string;
  jiraUsername?: string;
  jiraPassword?: string;
  githubToken?: string;
  slackWebhookUrl?: string;
  aiModel?: string;
  aiProvider?: string;
  aiMaxTokens?: number;
  aiRequestTimeoutMs?: number;
}

export type CredentialKey = keyof PoolsideCredentials;

export const CREDENTIAL_ENV_MAP: Record<CredentialKey, string> = {
  openaiApiKey: "POOLSIDE_OPENAI_API_KEY",
  anthropicApiKey: "POOLSIDE_ANTHROPIC_API_KEY",
  jiraHost: "POOLSIDE_JIRA_HOST",
  jiraUsername: "POOLSIDE_JIRA_USERNAME",
  jiraPassword: "POOLSIDE_JIRA_PASSWORD",
  githubToken: "POOLSIDE_GITHUB_TOKEN",
  slackWebhookUrl: "POOLSIDE_SLACK_WEBHOOK_URL",
  aiModel: "POOLSIDE_AI_MODEL",
  aiProvider: "POOLSIDE_AI_PROVIDER",
  aiMaxTokens: "POOLSIDE_AI_MAX_TOKENS",
  aiRequestTimeoutMs: "POOLSIDE_AI_REQUEST_TIMEOUT_MS",
};

export interface PoolsideConfig {
  activePreset?: string;
  presets: Record<string, ModelPreset>;
  credentials?: PoolsideCredentials;
}

// Built-in presets
export const BUILT_IN_PRESETS: Record<string, ModelPreset> = {
  fast: {
    name: "fast",
    provider: "openai",
    model: "gpt-4o-mini",
    description: "Quick tasks, lower cost",
  },
  quality: {
    name: "quality",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    description: "Best output quality",
  },
  balanced: {
    name: "balanced",
    provider: "openai",
    model: "gpt-5.2",
    description: "Good balance of speed/quality",
  },
  cheap: {
    name: "cheap",
    provider: "openai",
    model: "gpt-3.5-turbo",
    description: "Lowest cost",
  },
};

export const DEFAULT_PRESET = "balanced";

export interface ResolvedModel {
  provider: AIProvider;
  model: string;
  source:
    | "cli-model"
    | "cli-preset"
    | "env-model"
    | "env-preset"
    | "config"
    | "default";
}

export interface ModelResolutionOptions {
  cliModel?: string; // Direct model override (e.g., "anthropic:claude-3-haiku-20240307")
  cliPreset?: string; // Preset name from CLI
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), ".poolside");
    this.configPath = path.join(this.configDir, "config.json");
  }

  /**
   * Get the path to the config file
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Ensure the config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  /**
   * Read the configuration file
   */
  async readConfig(): Promise<PoolsideConfig> {
    try {
      const content = await fs.readFile(this.configPath, "utf8");
      return JSON.parse(content) as PoolsideConfig;
    } catch (error) {
      return {
        presets: {},
      };
    }
  }

  /**
   * Read the configuration file synchronously (for use in sync contexts)
   */
  readConfigSync(): PoolsideConfig {
    try {
      const content = fsSync.readFileSync(this.configPath, "utf8");
      return JSON.parse(content) as PoolsideConfig;
    } catch (error) {
      return {
        presets: {},
      };
    }
  }

  /**
   * Write the configuration file
   */
  async writeConfig(config: PoolsideConfig): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(
      this.configPath,
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  /**
   * Get the active preset from config
   */
  async getActivePreset(): Promise<string | undefined> {
    const config = await this.readConfig();
    return config.activePreset;
  }

  /**
   * Set the active preset in config
   */
  async setActivePreset(presetName: string): Promise<void> {
    const config = await this.readConfig();

    // Validate preset exists
    const allPresets = this.getAllPresets(config);
    if (!allPresets[presetName]) {
      throw new Error(
        `Preset "${presetName}" not found. Use "poolside config list" to see available presets.`
      );
    }

    config.activePreset = presetName;
    await this.writeConfig(config);
  }

  /**
   * Get all presets (built-in + custom)
   */
  getAllPresets(config?: PoolsideConfig): Record<string, ModelPreset> {
    const userConfig = config || { presets: {} };
    return {
      ...BUILT_IN_PRESETS,
      ...userConfig.presets,
    };
  }

  /**
   * Add a custom preset
   */
  async addPreset(preset: ModelPreset): Promise<void> {
    const config = await this.readConfig();

    // Don't allow overwriting built-in presets
    if (BUILT_IN_PRESETS[preset.name]) {
      throw new Error(`Cannot overwrite built-in preset "${preset.name}"`);
    }

    config.presets[preset.name] = preset;
    await this.writeConfig(config);
  }

  /**
   * Remove a custom preset
   */
  async removePreset(presetName: string): Promise<void> {
    const config = await this.readConfig();

    // Don't allow removing built-in presets
    if (BUILT_IN_PRESETS[presetName]) {
      throw new Error(`Cannot remove built-in preset "${presetName}"`);
    }

    if (!config.presets[presetName]) {
      throw new Error(`Custom preset "${presetName}" not found`);
    }

    delete config.presets[presetName];

    // Clear active preset if it was the removed one
    if (config.activePreset === presetName) {
      config.activePreset = undefined;
    }

    await this.writeConfig(config);
  }

  /**
   * Check if a preset exists
   */
  presetExists(presetName: string, config?: PoolsideConfig): boolean {
    const allPresets = this.getAllPresets(config);
    return !!allPresets[presetName];
  }

  /**
   * Get a preset by name
   */
  getPreset(
    presetName: string,
    config?: PoolsideConfig
  ): ModelPreset | undefined {
    const allPresets = this.getAllPresets(config);
    return allPresets[presetName];
  }

  /**
   * Parse a model string in the format "provider:model"
   */
  static parseModelString(
    modelString: string
  ): { provider: AIProvider; model: string } | null {
    const parts = modelString.split(":");
    if (parts.length !== 2) {
      return null;
    }

    const [provider, model] = parts;
    if (provider !== "openai" && provider !== "anthropic") {
      return null;
    }

    return { provider: provider as AIProvider, model };
  }

  /**
   * Resolve the model to use based on resolution priority:
   * 1. --model flag (highest)
   * 2. --preset flag
   * 3. POOLSIDE_AI_MODEL + POOLSIDE_AI_PROVIDER env vars
   * 4. POOLSIDE_PRESET env var
   * 5. activePreset in config file
   * 6. Auto-detect based on available API keys
   * 7. balanced preset (default)
   */
  async resolveModel(
    options: ModelResolutionOptions = {}
  ): Promise<ResolvedModel> {
    const config = await this.readConfig();

    // 1. --model flag (highest priority)
    if (options.cliModel) {
      const parsed = ConfigManager.parseModelString(options.cliModel);
      if (parsed) {
        return {
          provider: parsed.provider,
          model: parsed.model,
          source: "cli-model",
        };
      }
      throw new Error(
        `Invalid model format: "${options.cliModel}". Use format "provider:model" (e.g., "anthropic:claude-3-haiku-20240307")`
      );
    }

    // 2. --preset flag
    if (options.cliPreset) {
      const preset = this.getPreset(options.cliPreset, config);
      if (preset) {
        return {
          provider: preset.provider,
          model: preset.model,
          source: "cli-preset",
        };
      }
      throw new Error(
        `Preset "${options.cliPreset}" not found. Use "poolside config list" to see available presets.`
      );
    }

    // 3. POOLSIDE_AI_MODEL + POOLSIDE_AI_PROVIDER env vars (or from config)
    const envModel = process.env.POOLSIDE_AI_MODEL || config.credentials?.aiModel;
    const envProviderRaw = process.env.POOLSIDE_AI_PROVIDER || config.credentials?.aiProvider;
    const envProvider = envProviderRaw?.toLowerCase() as AIProvider | undefined;
    if (envModel && envProvider) {
      return {
        provider: envProvider,
        model: envModel,
        source: "env-model",
      };
    }

    // 4. POOLSIDE_PRESET env var
    const envPreset = process.env.POOLSIDE_PRESET;
    if (envPreset) {
      const preset = this.getPreset(envPreset, config);
      if (preset) {
        return {
          provider: preset.provider,
          model: preset.model,
          source: "env-preset",
        };
      }
      // Silently fall through if env preset doesn't exist
    }

    // 5. activePreset in config file
    if (config.activePreset) {
      const preset = this.getPreset(config.activePreset, config);
      if (preset) {
        return {
          provider: preset.provider,
          model: preset.model,
          source: "config",
        };
      }
    }

    // 6. Auto-detect based on available API keys
    const hasOpenAI = this.hasApiKeyForProvider("openai");
    const hasAnthropic = this.hasApiKeyForProvider("anthropic");

    if (hasAnthropic && !hasOpenAI) {
      // Only Anthropic key available - use quality preset
      const anthropicPreset = BUILT_IN_PRESETS.quality;
      return {
        provider: anthropicPreset.provider,
        model: anthropicPreset.model,
        source: "default",
      };
    }

    // 7. Default to balanced preset (OpenAI)
    const defaultPreset = BUILT_IN_PRESETS[DEFAULT_PRESET];
    return {
      provider: defaultPreset.provider,
      model: defaultPreset.model,
      source: "default",
    };
  }

  /**
   * Get the API key for a provider (checks env var first, then config)
   */
  getApiKeyForProvider(provider: AIProvider): string | undefined {
    if (provider === "anthropic") {
      const envKey = process.env.POOLSIDE_ANTHROPIC_API_KEY;
      if (envKey) return envKey;

      const config = this.readConfigSync();
      return config.credentials?.anthropicApiKey;
    }

    const envKey = process.env.POOLSIDE_OPENAI_API_KEY;
    if (envKey) return envKey;

    const config = this.readConfigSync();
    return config.credentials?.openaiApiKey;
  }

  /**
   * Check if an API key is available for a provider
   */
  hasApiKeyForProvider(provider: AIProvider): boolean {
    const key = this.getApiKeyForProvider(provider);
    return (
      !!key && !key.startsWith("sk-your_") && !key.startsWith("sk-ant-your_")
    );
  }

  /**
   * Get a credential value (checks env var first, then config file)
   * Resolution order: CLI flags -> Environment Variables -> Config file -> Default
   */
  async getCredential(key: CredentialKey): Promise<string | number | undefined> {
    const envVar = CREDENTIAL_ENV_MAP[key];
    const envValue = process.env[envVar];
    if (envValue !== undefined && envValue !== "") {
      if (key === "aiMaxTokens" || key === "aiRequestTimeoutMs") {
        return Number.parseInt(envValue, 10);
      }
      return envValue;
    }

    const config = await this.readConfig();
    return config.credentials?.[key];
  }

  /**
   * Get a credential value synchronously from env only (for use in sync contexts)
   */
  getCredentialFromEnv(key: CredentialKey): string | undefined {
    const envVar = CREDENTIAL_ENV_MAP[key];
    return process.env[envVar];
  }

  /**
   * Set a credential in the config file
   */
  async setCredential(key: CredentialKey, value: string | number): Promise<void> {
    const config = await this.readConfig();

    if (!config.credentials) {
      config.credentials = {};
    }

    if (key === "aiMaxTokens" || key === "aiRequestTimeoutMs") {
      config.credentials[key] = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    } else {
      config.credentials[key] = String(value);
    }

    await this.writeConfig(config);
  }

  /**
   * Remove a credential from the config file
   */
  async unsetCredential(key: CredentialKey): Promise<void> {
    const config = await this.readConfig();

    if (config.credentials) {
      delete config.credentials[key];

      if (Object.keys(config.credentials).length === 0) {
        delete config.credentials;
      }
    }

    await this.writeConfig(config);
  }

  /**
   * Get all stored credentials (for display, with env vars merged)
   */
  async getAllCredentials(): Promise<{
    stored: Partial<PoolsideCredentials>;
    fromEnv: Partial<Record<CredentialKey, string>>;
    effective: Partial<Record<CredentialKey, string | number>>;
  }> {
    const config = await this.readConfig();
    const stored = config.credentials || {};

    const fromEnv: Partial<Record<CredentialKey, string>> = {};
    const effective: Partial<Record<CredentialKey, string | number>> = {};

    for (const [key, envVar] of Object.entries(CREDENTIAL_ENV_MAP)) {
      const credKey = key as CredentialKey;
      const envValue = process.env[envVar];

      if (envValue !== undefined && envValue !== "") {
        fromEnv[credKey] = envValue;
        if (credKey === "aiMaxTokens" || credKey === "aiRequestTimeoutMs") {
          effective[credKey] = Number.parseInt(envValue, 10);
        } else {
          effective[credKey] = envValue;
        }
      } else if (stored[credKey] !== undefined) {
        effective[credKey] = stored[credKey];
      }
    }

    return { stored, fromEnv, effective };
  }

  /**
   * Convert a credential key to its environment variable name
   */
  static getEnvVarName(key: CredentialKey): string {
    return CREDENTIAL_ENV_MAP[key];
  }

  /**
   * Convert an environment variable name to its credential key
   */
  static getCredentialKey(envVar: string): CredentialKey | undefined {
    for (const [key, value] of Object.entries(CREDENTIAL_ENV_MAP)) {
      if (value === envVar) {
        return key as CredentialKey;
      }
    }
    return undefined;
  }

  /**
   * Check if a string is a valid credential key
   */
  static isValidCredentialKey(key: string): key is CredentialKey {
    return key in CREDENTIAL_ENV_MAP;
  }
}
