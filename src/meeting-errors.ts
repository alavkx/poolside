import chalk from "chalk";

export type MeetingPipelineStage =
	| "chunking"
	| "extraction"
	| "refinement"
	| "generation"
	| "editing";

export const STAGE_NUMBERS: Record<MeetingPipelineStage, number> = {
	chunking: 1,
	extraction: 2,
	refinement: 3,
	generation: 4,
	editing: 5,
};

export const TOTAL_STAGES = 5;

export interface ErrorContext {
	chunkIndex?: number;
	totalChunks?: number;
	model?: string;
	provider?: string;
}

export class MeetingPipelineError extends Error {
	readonly stage: MeetingPipelineStage;
	readonly stageNumber: number;
	readonly cause?: Error;
	readonly suggestions: string[];
	readonly context: ErrorContext;

	constructor(
		message: string,
		stage: MeetingPipelineStage,
		options: {
			cause?: Error;
			suggestions?: string[];
			context?: ErrorContext;
		} = {}
	) {
		super(message);
		this.name = "MeetingPipelineError";
		this.stage = stage;
		this.stageNumber = STAGE_NUMBERS[stage];
		this.cause = options.cause;
		this.suggestions = options.suggestions ?? [];
		this.context = options.context ?? {};

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, MeetingPipelineError);
		}
	}

	getFormattedMessage(): string {
		const lines: string[] = [];

		const stageInfo = this.context.chunkIndex !== undefined
			? `Stage ${this.stageNumber}/${TOTAL_STAGES}, chunk ${this.context.chunkIndex}/${this.context.totalChunks ?? "?"}`
			: `Stage ${this.stageNumber}/${TOTAL_STAGES}`;

		lines.push(chalk.red(`❌ ${this.stageName} failed (${stageInfo})`));
		lines.push("");
		lines.push(chalk.white(`Error: ${this.message}`));

		if (this.suggestions.length > 0) {
			lines.push("");
			lines.push(chalk.yellow("Try one of these:"));
			for (const suggestion of this.suggestions) {
				lines.push(chalk.cyan(`  ${suggestion}`));
			}
		}

		return lines.join("\n");
	}

	private get stageName(): string {
		const names: Record<MeetingPipelineStage, string> = {
			chunking: "Chunking",
			extraction: "Extraction",
			refinement: "Refinement",
			generation: "Generation",
			editing: "Editing",
		};
		return names[this.stage];
	}
}

export class ModelCompatibilityError extends MeetingPipelineError {
	constructor(
		model: string,
		provider: string,
		issue: string,
		options: { cause?: Error } = {}
	) {
		const suggestions = [
			"--model openai:gpt-4o",
			"--preset fast",
			"poolside config set aiModel gpt-4o",
		];

		super(
			`Model '${model}' (${provider}): ${issue}`,
			"extraction",
			{
				cause: options.cause,
				suggestions,
				context: { model, provider },
			}
		);
		this.name = "ModelCompatibilityError";
	}
}

export class APIKeyMissingError extends MeetingPipelineError {
	constructor(provider: string, stage: MeetingPipelineStage = "extraction") {
		const envVar = provider === "anthropic"
			? "POOLSIDE_ANTHROPIC_API_KEY"
			: "POOLSIDE_OPENAI_API_KEY";

		const suggestions = [
			`Set ${envVar} environment variable`,
			"poolside setup",
			`poolside config set ${provider === "anthropic" ? "anthropicApiKey" : "openaiApiKey"} <your-key>`,
		];

		super(
			`${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key not configured`,
			stage,
			{
				suggestions,
				context: { provider },
			}
		);
		this.name = "APIKeyMissingError";
	}
}

export class TimeoutError extends MeetingPipelineError {
	constructor(
		stage: MeetingPipelineStage,
		timeoutMs: number,
		options: { chunkIndex?: number; totalChunks?: number } = {}
	) {
		const suggestions = [
			"--preset fast (uses a faster model)",
			"Split the transcript into smaller files",
			"Set POOLSIDE_AI_REQUEST_TIMEOUT_MS to a higher value",
		];

		super(
			`Request timed out after ${Math.round(timeoutMs / 1000)}s`,
			stage,
			{
				suggestions,
				context: {
					chunkIndex: options.chunkIndex,
					totalChunks: options.totalChunks,
				},
			}
		);
		this.name = "TimeoutError";
	}
}

export class TranscriptError extends MeetingPipelineError {
	constructor(message: string, options: { cause?: Error } = {}) {
		const suggestions = [
			"Check the file path is correct",
			"Ensure the file is a text file (not binary)",
			"Verify the file has valid content",
		];

		super(message, "chunking", {
			cause: options.cause,
			suggestions,
		});
		this.name = "TranscriptError";
	}
}

export function wrapError(
	error: unknown,
	stage: MeetingPipelineStage,
	context?: ErrorContext
): MeetingPipelineError {
	if (error instanceof MeetingPipelineError) {
		return error;
	}

	const originalError = error instanceof Error ? error : new Error(String(error));
	const message = originalError.message || "Unknown error";

	if (message.includes("max_tokens") || message.includes("max_completion_tokens")) {
		return new ModelCompatibilityError(
			context?.model ?? "unknown",
			context?.provider ?? "unknown",
			"does not support 'max_tokens' parameter",
			{ cause: originalError }
		);
	}

	if (message.includes("API key") || message.includes("Unauthorized") || message.includes("401")) {
		return new APIKeyMissingError(context?.provider ?? "unknown", stage);
	}

	if (originalError.name === "AbortError" || message.includes("timeout") || message.includes("aborted")) {
		return new TimeoutError(stage, 120000, {
			chunkIndex: context?.chunkIndex,
			totalChunks: context?.totalChunks,
		});
	}

	const suggestions: string[] = [];
	if (message.includes("rate limit") || message.includes("429")) {
		suggestions.push("Wait a few minutes and try again", "--preset cheap (uses a lower-tier model)");
	}

	return new MeetingPipelineError(message, stage, {
		cause: originalError,
		suggestions,
		context,
	});
}

export function formatError(error: unknown): string {
	if (error instanceof MeetingPipelineError) {
		return error.getFormattedMessage();
	}

	const message = error instanceof Error ? error.message : String(error);
	return chalk.red(`❌ Error processing meeting: ${message}`);
}
