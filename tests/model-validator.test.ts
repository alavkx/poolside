import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	validateModelConfig,
	validateTranscript,
	printValidationResult,
	type ValidationResult,
} from "../src/model-validator";
import { APIKeyMissingError, ModelCompatibilityError } from "../src/meeting-errors";

describe("validateModelConfig", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
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

	it("should validate with OpenAI API key set", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		const result = await validateModelConfig();

		expect(result.valid).toBe(true);
		expect(result.provider).toBe("openai");
		expect(result.model).toBeDefined();
	});

	it("should validate with Anthropic API key and explicit model", async () => {
		process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-test-key";

		const result = await validateModelConfig({ cliModel: "anthropic:claude-3-opus-20240229" });

		expect(result.valid).toBe(true);
		expect(result.provider).toBe("anthropic");
		expect(result.model).toBe("claude-3-opus-20240229");
	});

	it("should throw APIKeyMissingError for provider without API key", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";
		delete process.env.POOLSIDE_ANTHROPIC_API_KEY;

		await expect(
			validateModelConfig({ cliModel: "anthropic:claude-3-opus-20240229" })
		).rejects.toThrow(APIKeyMissingError);
	});

	it("should parse CLI model option", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		const result = await validateModelConfig({ cliModel: "openai:gpt-4o" });

		expect(result.provider).toBe("openai");
		expect(result.model).toBe("gpt-4o");
		expect(result.source).toBe("cli-model");
	});

	it("should throw for invalid CLI model format", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		await expect(validateModelConfig({ cliModel: "invalid-format" })).rejects.toThrow(
			ModelCompatibilityError
		);
	});

	it("should use preset when specified", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";
		process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-test-key";

		const result = await validateModelConfig({ preset: "fast" });

		expect(result.source).toBe("cli-preset");
		expect(result.valid).toBe(true);
	});

	it("should throw for unknown preset", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		await expect(validateModelConfig({ preset: "nonexistent-preset" })).rejects.toThrow(
			ModelCompatibilityError
		);
	});

	it("should warn for unknown model", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		const result = await validateModelConfig({ cliModel: "openai:gpt-99-turbo" });

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("not in the list of tested models");
	});

	it("should not warn for known OpenAI models", async () => {
		process.env.POOLSIDE_OPENAI_API_KEY = "sk-test-key";

		const result = await validateModelConfig({ cliModel: "openai:gpt-4o" });

		expect(result.warnings).toHaveLength(0);
	});

	it("should not warn for known Anthropic models", async () => {
		process.env.POOLSIDE_ANTHROPIC_API_KEY = "sk-ant-test-key";

		const result = await validateModelConfig({ cliModel: "anthropic:claude-3-opus-20240229" });

		expect(result.warnings).toHaveLength(0);
	});
});

describe("validateTranscript", () => {
	it("should validate non-empty transcript", () => {
		const transcript = "A".repeat(200);
		const result = validateTranscript(transcript);

		expect(result.valid).toBe(true);
		expect(result.charCount).toBe(200);
		expect(result.error).toBeUndefined();
	});

	it("should reject empty transcript", () => {
		const result = validateTranscript("");

		expect(result.valid).toBe(false);
		expect(result.error).toBe("Transcript file is empty");
		expect(result.charCount).toBe(0);
	});

	it("should reject whitespace-only transcript", () => {
		const result = validateTranscript("   \n\t  ");

		expect(result.valid).toBe(false);
		expect(result.error).toBe("Transcript file is empty");
	});

	it("should reject transcript shorter than 100 characters", () => {
		const result = validateTranscript("Short transcript");

		expect(result.valid).toBe(false);
		expect(result.error).toBe("Transcript is too short (less than 100 characters)");
	});

	it("should accept transcript with exactly 100 characters", () => {
		const transcript = "A".repeat(100);
		const result = validateTranscript(transcript);

		expect(result.valid).toBe(true);
	});

	it("should reject binary content", () => {
		const binaryContent = "Hello\x00World\x01Binary\x02Content" + "A".repeat(100);
		const result = validateTranscript(binaryContent);

		expect(result.valid).toBe(false);
		expect(result.error).toBe("File appears to be binary, not a text transcript");
	});

	it("should accept normal text with line breaks", () => {
		const transcript = "Speaker 1: Hello everyone\n".repeat(10);
		const result = validateTranscript(transcript);

		expect(result.valid).toBe(true);
	});

	it("should accept text with tabs and carriage returns", () => {
		const transcript = "Speaker 1:\tHello\r\nSpeaker 2:\tHi\r\n".repeat(10);
		const result = validateTranscript(transcript);

		expect(result.valid).toBe(true);
	});

	it("should return character count for valid transcript", () => {
		const transcript = "Test content".repeat(50);
		const result = validateTranscript(transcript);

		expect(result.charCount).toBe(transcript.length);
	});

	it("should return character count even for invalid transcript", () => {
		const transcript = "Too short";
		const result = validateTranscript(transcript);

		expect(result.valid).toBe(false);
		expect(result.charCount).toBe(9);
	});
});

describe("printValidationResult", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	it("should print model and provider info", () => {
		const result: ValidationResult = {
			valid: true,
			provider: "openai",
			model: "gpt-4o",
			warnings: [],
			source: "default",
		};

		printValidationResult(result);

		const output = consoleSpy.mock.calls.flat().join(" ");
		expect(output).toContain("gpt-4o");
		expect(output).toContain("openai");
	});

	it("should print warnings when present", () => {
		const result: ValidationResult = {
			valid: true,
			provider: "openai",
			model: "gpt-99",
			warnings: ["Model is not tested", "May have issues"],
			source: "cli-model",
		};

		printValidationResult(result);

		const output = consoleSpy.mock.calls.flat().join(" ");
		expect(output).toContain("Model is not tested");
		expect(output).toContain("May have issues");
	});

	it("should not print warnings section when empty", () => {
		const result: ValidationResult = {
			valid: true,
			provider: "anthropic",
			model: "claude-3-opus",
			warnings: [],
			source: "default",
		};

		printValidationResult(result);

		expect(consoleSpy).toHaveBeenCalledTimes(3);
	});
});
