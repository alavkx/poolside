import { describe, it, expect } from "vitest";
import {
	MeetingPipelineError,
	ModelCompatibilityError,
	APIKeyMissingError,
	TimeoutError,
	TranscriptError,
	wrapError,
	formatError,
	STAGE_NUMBERS,
	TOTAL_STAGES,
	type MeetingPipelineStage,
	type ErrorContext,
} from "../src/meeting-errors";

describe("STAGE_NUMBERS", () => {
	it("should have correct stage numbers", () => {
		expect(STAGE_NUMBERS.chunking).toBe(1);
		expect(STAGE_NUMBERS.extraction).toBe(2);
		expect(STAGE_NUMBERS.refinement).toBe(3);
		expect(STAGE_NUMBERS.generation).toBe(4);
		expect(STAGE_NUMBERS.editing).toBe(5);
	});

	it("should have total stages equal to 5", () => {
		expect(TOTAL_STAGES).toBe(5);
	});
});

describe("MeetingPipelineError", () => {
	describe("constructor", () => {
		it("should create error with message and stage", () => {
			const error = new MeetingPipelineError("Test error", "extraction");

			expect(error.message).toBe("Test error");
			expect(error.stage).toBe("extraction");
			expect(error.stageNumber).toBe(2);
			expect(error.name).toBe("MeetingPipelineError");
		});

		it("should create error with all stages", () => {
			const stages: MeetingPipelineStage[] = ["chunking", "extraction", "refinement", "generation", "editing"];

			for (const stage of stages) {
				const error = new MeetingPipelineError("Test", stage);
				expect(error.stage).toBe(stage);
				expect(error.stageNumber).toBe(STAGE_NUMBERS[stage]);
			}
		});

		it("should accept optional cause", () => {
			const cause = new Error("Original error");
			const error = new MeetingPipelineError("Wrapped error", "extraction", { cause });

			expect(error.cause).toBe(cause);
		});

		it("should accept optional suggestions", () => {
			const suggestions = ["Try this", "Or this"];
			const error = new MeetingPipelineError("Test", "extraction", { suggestions });

			expect(error.suggestions).toEqual(suggestions);
		});

		it("should default to empty suggestions", () => {
			const error = new MeetingPipelineError("Test", "extraction");
			expect(error.suggestions).toEqual([]);
		});

		it("should accept optional context", () => {
			const context: ErrorContext = {
				chunkIndex: 3,
				totalChunks: 10,
				model: "gpt-4o",
				provider: "openai",
			};
			const error = new MeetingPipelineError("Test", "extraction", { context });

			expect(error.context).toEqual(context);
		});

		it("should default to empty context", () => {
			const error = new MeetingPipelineError("Test", "extraction");
			expect(error.context).toEqual({});
		});
	});

	describe("getFormattedMessage", () => {
		it("should format error without chunk info", () => {
			const error = new MeetingPipelineError("Something went wrong", "refinement");
			const formatted = error.getFormattedMessage();

			expect(formatted).toContain("❌ Refinement failed");
			expect(formatted).toContain("Stage 3/5");
			expect(formatted).toContain("Something went wrong");
		});

		it("should format error with chunk info", () => {
			const error = new MeetingPipelineError("Chunk failed", "extraction", {
				context: { chunkIndex: 3, totalChunks: 10 },
			});
			const formatted = error.getFormattedMessage();

			expect(formatted).toContain("❌ Extraction failed");
			expect(formatted).toContain("Stage 2/5, chunk 3/10");
			expect(formatted).toContain("Chunk failed");
		});

		it("should format error with missing total chunks", () => {
			const error = new MeetingPipelineError("Chunk failed", "extraction", {
				context: { chunkIndex: 3 },
			});
			const formatted = error.getFormattedMessage();

			expect(formatted).toContain("chunk 3/?");
		});

		it("should include suggestions when present", () => {
			const error = new MeetingPipelineError("API error", "extraction", {
				suggestions: ["--model openai:gpt-4o", "--preset fast"],
			});
			const formatted = error.getFormattedMessage();

			expect(formatted).toContain("Try one of these:");
			expect(formatted).toContain("--model openai:gpt-4o");
			expect(formatted).toContain("--preset fast");
		});

		it("should not include suggestions section when empty", () => {
			const error = new MeetingPipelineError("API error", "extraction");
			const formatted = error.getFormattedMessage();

			expect(formatted).not.toContain("Try one of these:");
		});

		it("should format all stage names correctly", () => {
			const stageNames: Record<MeetingPipelineStage, string> = {
				chunking: "Chunking",
				extraction: "Extraction",
				refinement: "Refinement",
				generation: "Generation",
				editing: "Editing",
			};

			for (const [stage, name] of Object.entries(stageNames)) {
				const error = new MeetingPipelineError("Test", stage as MeetingPipelineStage);
				const formatted = error.getFormattedMessage();
				expect(formatted).toContain(`❌ ${name} failed`);
			}
		});
	});
});

describe("ModelCompatibilityError", () => {
	it("should create error with model info", () => {
		const error = new ModelCompatibilityError(
			"gpt-5.2",
			"openai",
			"does not support max_tokens parameter"
		);

		expect(error.name).toBe("ModelCompatibilityError");
		expect(error.stage).toBe("extraction");
		expect(error.message).toContain("gpt-5.2");
		expect(error.message).toContain("openai");
		expect(error.message).toContain("does not support max_tokens parameter");
	});

	it("should include default suggestions", () => {
		const error = new ModelCompatibilityError("gpt-5.2", "openai", "invalid param");

		expect(error.suggestions).toContain("--model openai:gpt-4o");
		expect(error.suggestions).toContain("--preset fast");
		expect(error.suggestions).toContain("poolside config set aiModel gpt-4o");
	});

	it("should store model and provider in context", () => {
		const error = new ModelCompatibilityError("claude-3", "anthropic", "issue");

		expect(error.context.model).toBe("claude-3");
		expect(error.context.provider).toBe("anthropic");
	});

	it("should accept optional cause", () => {
		const cause = new Error("Original API error");
		const error = new ModelCompatibilityError("gpt-5", "openai", "issue", { cause });

		expect(error.cause).toBe(cause);
	});
});

describe("APIKeyMissingError", () => {
	it("should create error for OpenAI provider", () => {
		const error = new APIKeyMissingError("openai");

		expect(error.name).toBe("APIKeyMissingError");
		expect(error.message).toContain("OpenAI API key not configured");
		expect(error.suggestions).toContain("Set POOLSIDE_OPENAI_API_KEY environment variable");
	});

	it("should create error for Anthropic provider", () => {
		const error = new APIKeyMissingError("anthropic");

		expect(error.message).toContain("Anthropic API key not configured");
		expect(error.suggestions).toContain("Set POOLSIDE_ANTHROPIC_API_KEY environment variable");
	});

	it("should default to extraction stage", () => {
		const error = new APIKeyMissingError("openai");
		expect(error.stage).toBe("extraction");
	});

	it("should accept custom stage", () => {
		const error = new APIKeyMissingError("openai", "generation");
		expect(error.stage).toBe("generation");
	});

	it("should include setup suggestion", () => {
		const error = new APIKeyMissingError("openai");
		expect(error.suggestions).toContain("poolside setup");
	});

	it("should include config set suggestion for OpenAI", () => {
		const error = new APIKeyMissingError("openai");
		expect(error.suggestions.some(s => s.includes("poolside config set openaiApiKey"))).toBe(true);
	});

	it("should include config set suggestion for Anthropic", () => {
		const error = new APIKeyMissingError("anthropic");
		expect(error.suggestions.some(s => s.includes("poolside config set anthropicApiKey"))).toBe(true);
	});

	it("should store provider in context", () => {
		const error = new APIKeyMissingError("openai");
		expect(error.context.provider).toBe("openai");
	});
});

describe("TimeoutError", () => {
	it("should create error with timeout info", () => {
		const error = new TimeoutError("extraction", 120000);

		expect(error.name).toBe("TimeoutError");
		expect(error.message).toContain("Request timed out after 120s");
		expect(error.stage).toBe("extraction");
	});

	it("should round timeout to seconds", () => {
		const error = new TimeoutError("refinement", 65432);
		expect(error.message).toContain("65s");
	});

	it("should include suggestions", () => {
		const error = new TimeoutError("extraction", 60000);

		expect(error.suggestions).toContain("--preset fast (uses a faster model)");
		expect(error.suggestions).toContain("Split the transcript into smaller files");
		expect(error.suggestions).toContain("Set POOLSIDE_AI_REQUEST_TIMEOUT_MS to a higher value");
	});

	it("should accept chunk context", () => {
		const error = new TimeoutError("extraction", 60000, {
			chunkIndex: 5,
			totalChunks: 12,
		});

		expect(error.context.chunkIndex).toBe(5);
		expect(error.context.totalChunks).toBe(12);
	});

	it("should work without chunk context", () => {
		const error = new TimeoutError("generation", 30000);

		expect(error.context.chunkIndex).toBeUndefined();
		expect(error.context.totalChunks).toBeUndefined();
	});
});

describe("TranscriptError", () => {
	it("should create error for transcript issues", () => {
		const error = new TranscriptError("File not found");

		expect(error.name).toBe("TranscriptError");
		expect(error.message).toBe("File not found");
		expect(error.stage).toBe("chunking");
	});

	it("should include file-related suggestions", () => {
		const error = new TranscriptError("Could not read file");

		expect(error.suggestions).toContain("Check the file path is correct");
		expect(error.suggestions).toContain("Ensure the file is a text file (not binary)");
		expect(error.suggestions).toContain("Verify the file has valid content");
	});

	it("should accept optional cause", () => {
		const cause = new Error("ENOENT");
		const error = new TranscriptError("File read error", { cause });

		expect(error.cause).toBe(cause);
	});
});

describe("wrapError", () => {
	it("should return MeetingPipelineError unchanged", () => {
		const original = new MeetingPipelineError("Original", "extraction");
		const wrapped = wrapError(original, "refinement");

		expect(wrapped).toBe(original);
	});

	it("should wrap max_tokens error as ModelCompatibilityError", () => {
		const original = new Error("max_tokens is not supported");
		const wrapped = wrapError(original, "extraction", { model: "gpt-5.2", provider: "openai" });

		expect(wrapped).toBeInstanceOf(ModelCompatibilityError);
		expect(wrapped.message).toContain("gpt-5.2");
	});

	it("should wrap max_completion_tokens error as ModelCompatibilityError", () => {
		const original = new Error("max_completion_tokens parameter invalid");
		const wrapped = wrapError(original, "extraction", { model: "gpt-4", provider: "openai" });

		expect(wrapped).toBeInstanceOf(ModelCompatibilityError);
	});

	it("should use unknown model/provider when not in context", () => {
		const original = new Error("max_tokens error");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped.message).toContain("unknown");
	});

	it("should wrap API key error as APIKeyMissingError", () => {
		const original = new Error("API key not valid");
		const wrapped = wrapError(original, "refinement", { provider: "openai" });

		expect(wrapped).toBeInstanceOf(APIKeyMissingError);
	});

	it("should wrap Unauthorized error as APIKeyMissingError", () => {
		const original = new Error("Unauthorized access");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped).toBeInstanceOf(APIKeyMissingError);
	});

	it("should wrap 401 error as APIKeyMissingError", () => {
		const original = new Error("Request failed with status 401");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped).toBeInstanceOf(APIKeyMissingError);
	});

	it("should wrap AbortError as TimeoutError", () => {
		const original = new Error("Request aborted");
		original.name = "AbortError";
		const wrapped = wrapError(original, "extraction", { chunkIndex: 2, totalChunks: 5 });

		expect(wrapped).toBeInstanceOf(TimeoutError);
		expect(wrapped.context.chunkIndex).toBe(2);
		expect(wrapped.context.totalChunks).toBe(5);
	});

	it("should wrap timeout message as TimeoutError", () => {
		const original = new Error("Request timeout");
		const wrapped = wrapError(original, "generation");

		expect(wrapped).toBeInstanceOf(TimeoutError);
	});

	it("should wrap aborted message as TimeoutError", () => {
		const original = new Error("The operation was aborted");
		const wrapped = wrapError(original, "editing");

		expect(wrapped).toBeInstanceOf(TimeoutError);
	});

	it("should add rate limit suggestions for 429 errors", () => {
		const original = new Error("Rate limit exceeded (429)");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped.suggestions).toContain("Wait a few minutes and try again");
		expect(wrapped.suggestions.some(s => s.includes("--preset cheap"))).toBe(true);
	});

	it("should add rate limit suggestions for rate limit message", () => {
		const original = new Error("rate limit reached");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped.suggestions.length).toBeGreaterThan(0);
	});

	it("should wrap generic Error with stage info", () => {
		const original = new Error("Something unexpected");
		const wrapped = wrapError(original, "refinement");

		expect(wrapped).toBeInstanceOf(MeetingPipelineError);
		expect(wrapped.stage).toBe("refinement");
		expect(wrapped.message).toBe("Something unexpected");
		expect(wrapped.cause).toBe(original);
	});

	it("should handle non-Error values", () => {
		const wrapped = wrapError("string error", "extraction");

		expect(wrapped).toBeInstanceOf(MeetingPipelineError);
		expect(wrapped.message).toBe("string error");
	});

	it("should handle null error", () => {
		const wrapped = wrapError(null, "chunking");

		expect(wrapped).toBeInstanceOf(MeetingPipelineError);
		expect(wrapped.message).toBe("null");
	});

	it("should handle undefined error", () => {
		const wrapped = wrapError(undefined, "generation");

		expect(wrapped).toBeInstanceOf(MeetingPipelineError);
		expect(wrapped.message).toBe("undefined");
	});

	it("should use Unknown error for empty message", () => {
		const original = new Error("");
		const wrapped = wrapError(original, "extraction");

		expect(wrapped.message).toBe("Unknown error");
	});

	it("should preserve context in wrapped error", () => {
		const original = new Error("Generic error");
		const context: ErrorContext = {
			model: "gpt-4o",
			provider: "openai",
			chunkIndex: 3,
			totalChunks: 8,
		};
		const wrapped = wrapError(original, "extraction", context);

		expect(wrapped.context).toEqual(context);
	});
});

describe("formatError", () => {
	it("should format MeetingPipelineError using getFormattedMessage", () => {
		const error = new MeetingPipelineError("Test error", "extraction", {
			suggestions: ["Try this"],
		});
		const formatted = formatError(error);

		expect(formatted).toContain("❌ Extraction failed");
		expect(formatted).toContain("Test error");
		expect(formatted).toContain("Try this");
	});

	it("should format regular Error with generic message", () => {
		const error = new Error("Something went wrong");
		const formatted = formatError(error);

		expect(formatted).toContain("❌ Error processing meeting:");
		expect(formatted).toContain("Something went wrong");
	});

	it("should format non-Error values", () => {
		const formatted = formatError("string error");

		expect(formatted).toContain("❌ Error processing meeting:");
		expect(formatted).toContain("string error");
	});

	it("should format null", () => {
		const formatted = formatError(null);
		expect(formatted).toContain("null");
	});

	it("should format undefined", () => {
		const formatted = formatError(undefined);
		expect(formatted).toContain("undefined");
	});

	it("should format ModelCompatibilityError", () => {
		const error = new ModelCompatibilityError("gpt-5", "openai", "unsupported");
		const formatted = formatError(error);

		expect(formatted).toContain("❌ Extraction failed");
		expect(formatted).toContain("gpt-5");
	});

	it("should format APIKeyMissingError", () => {
		const error = new APIKeyMissingError("openai");
		const formatted = formatError(error);

		expect(formatted).toContain("OpenAI API key not configured");
	});

	it("should format TimeoutError", () => {
		const error = new TimeoutError("extraction", 60000);
		const formatted = formatError(error);

		expect(formatted).toContain("timed out");
	});

	it("should format TranscriptError", () => {
		const error = new TranscriptError("Invalid file format");
		const formatted = formatError(error);

		expect(formatted).toContain("Invalid file format");
	});
});
