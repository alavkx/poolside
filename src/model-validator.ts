import chalk from "chalk";
import {
	ConfigManager,
	type AIProvider,
	type ResolvedModel,
} from "./model-config.js";
import { APIKeyMissingError, ModelCompatibilityError } from "./meeting-errors.js";

export interface ValidationResult {
	valid: boolean;
	provider: AIProvider;
	model: string;
	warnings: string[];
	source: ResolvedModel["source"];
}

export interface ValidatorOptions {
	provider?: AIProvider;
	model?: string;
	preset?: string;
	cliModel?: string;
}

const KNOWN_COMPATIBLE_MODELS: Record<AIProvider, string[]> = {
	openai: [
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4-turbo",
		"gpt-4",
		"gpt-3.5-turbo",
		"gpt-5.2",
	],
	anthropic: [
		"claude-3-opus-20240229",
		"claude-3-sonnet-20240229",
		"claude-3-haiku-20240307",
		"claude-sonnet-4-20250514",
		"claude-3-5-sonnet-20241022",
	],
};

export async function validateModelConfig(
	options: ValidatorOptions = {}
): Promise<ValidationResult> {
	const configManager = new ConfigManager();

	let provider = options.provider;
	let model = options.model;
	let source: ResolvedModel["source"] = "default";

	if (options.cliModel) {
		const parsed = ConfigManager.parseModelString(options.cliModel);
		if (parsed) {
			provider = parsed.provider;
			model = parsed.model;
			source = "cli-model";
		} else {
			throw new ModelCompatibilityError(
				options.cliModel,
				"unknown",
				'Invalid format. Use "provider:model" (e.g., "openai:gpt-4o")'
			);
		}
	} else if (options.preset) {
		const preset = configManager.getPreset(options.preset);
		if (preset) {
			provider = preset.provider;
			model = preset.model;
			source = "cli-preset";
		} else {
			throw new ModelCompatibilityError(
				options.preset,
				"preset",
				`Unknown preset. Use "poolside config preset list" to see available presets.`
			);
		}
	}

	if (!provider || !model) {
		const resolved = await configManager.resolveModel({
			cliModel: options.cliModel,
			cliPreset: options.preset,
		});
		provider = resolved.provider;
		model = resolved.model;
		source = resolved.source;
	}

	const apiKey = configManager.getApiKeyForProvider(provider);
	if (!apiKey) {
		throw new APIKeyMissingError(provider);
	}

	const warnings: string[] = [];

	const knownModels = KNOWN_COMPATIBLE_MODELS[provider] || [];
	const isKnownModel = knownModels.some(
		(known) => model.includes(known) || known.includes(model)
	);

	if (!isKnownModel) {
		warnings.push(
			`Model '${model}' is not in the list of tested models for ${provider}. It may still work.`
		);
	}

	return {
		valid: true,
		provider,
		model,
		warnings,
		source,
	};
}

export function printValidationResult(result: ValidationResult): void {
	console.log(chalk.blue("\nProcessing meeting transcript..."));
	console.log(chalk.gray(`  Model: ${result.model} (${result.provider})`));

	if (result.warnings.length > 0) {
		for (const warning of result.warnings) {
			console.log(chalk.yellow(`  ⚠ ${warning}`));
		}
	}

	console.log();
}

export function validateTranscript(content: string): {
	valid: boolean;
	error?: string;
	charCount: number;
} {
	if (!content || content.trim().length === 0) {
		return {
			valid: false,
			error: "Transcript file is empty",
			charCount: 0,
		};
	}

	const charCount = content.length;

	if (charCount < 100) {
		return {
			valid: false,
			error: "Transcript is too short (less than 100 characters)",
			charCount,
		};
	}

	const binaryPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
	if (binaryPattern.test(content.slice(0, 1000))) {
		return {
			valid: false,
			error: "File appears to be binary, not a text transcript",
			charCount,
		};
	}

	return {
		valid: true,
		charCount,
	};
}
