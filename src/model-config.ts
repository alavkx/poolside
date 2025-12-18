import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type AIProvider = "openai" | "anthropic";

export interface ModelPreset {
  name: string;
  provider: AIProvider;
  model: string;
  description?: string;
}

export interface PoolsideConfig {
  activePreset?: string;
  presets: Record<string, ModelPreset>;
  apiKeys?: {
    openai?: string;
    anthropic?: string;
  };
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
    model: "gpt-4o",
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
      // Return default config if file doesn't exist
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
   * 6. balanced preset (default)
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

    // 3. POOLSIDE_AI_MODEL + POOLSIDE_AI_PROVIDER env vars
    const envModel = process.env.POOLSIDE_AI_MODEL;
    const envProvider = process.env.POOLSIDE_AI_PROVIDER?.toLowerCase() as
      | AIProvider
      | undefined;
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

    // 6. Default to balanced preset
    const defaultPreset = BUILT_IN_PRESETS[DEFAULT_PRESET];
    return {
      provider: defaultPreset.provider,
      model: defaultPreset.model,
      source: "default",
    };
  }

  /**
   * Get the API key for a provider
   */
  getApiKeyForProvider(provider: AIProvider): string | undefined {
    if (provider === "anthropic") {
      return process.env.POOLSIDE_ANTHROPIC_API_KEY;
    }
    return process.env.POOLSIDE_OPENAI_API_KEY;
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
}
