import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import chalk from "chalk";
import {
	ChunkExtractionSchema,
	type ChunkExtraction,
} from "./meeting-schemas.js";
import type { TranscriptChunk } from "./meeting-types.js";
import {
	type AIProvider,
	type ResolvedModel,
	ConfigManager,
	isReasoningModel,
} from "./model-config.js";
import type { PipelineProgress } from "./meeting-progress.js";
import { wrapError } from "./meeting-errors.js";

export interface ExtractorConfig {
	provider?: AIProvider;
	model?: string;
	maxTokens?: number;
	verbose?: boolean;
	resolvedModel?: ResolvedModel;
	progress?: PipelineProgress;
}

export interface ExtractionResult {
	extractions: ChunkExtraction[];
	totalChunks: number;
	processingTimeMs: number;
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert meeting analyst. Your task is to extract structured information from meeting transcript segments.

For each chunk, you must:
1. Identify decisions that were made (explicit agreements, approvals, or choices)
2. Find action items (tasks assigned to specific people)
3. Note deliverables (features, products, or outputs discussed)
4. Capture key discussion points

CRITICAL REQUIREMENTS:
- Every decision, action item, and deliverable MUST include a direct quote from the transcript that supports it
- The quote should be the actual words spoken, not a paraphrase
- Only extract items that are clearly stated, not implied
- If context from previous chunks is provided, use it to maintain continuity
- Be concise but complete in your extractions
- Provide a summary at the end to pass context to the next chunk`;

export class MeetingExtractor {
	private verbose: boolean;
	private config: Required<Omit<ExtractorConfig, "resolvedModel" | "progress">> & {
		resolvedModel?: ResolvedModel;
	};
	private model: Parameters<typeof generateObject>[0]["model"];
	private requestTimeoutMs: number;
	private progress?: PipelineProgress;

	static async create(config: ExtractorConfig = {}): Promise<MeetingExtractor> {
		const configManager = new ConfigManager();

		let provider = config.provider;
		let model = config.model;

		if (!provider || !model) {
			const resolved = await configManager.resolveModel({});
			provider = provider ?? resolved.provider;
			model = model ?? resolved.model;
		}

		const apiKey = configManager.getApiKeyForProvider(provider);
		if (!apiKey) {
			const providerName = provider === "anthropic" ? "Anthropic" : "OpenAI";
			const envVar =
				provider === "anthropic"
					? "POOLSIDE_ANTHROPIC_API_KEY"
					: "POOLSIDE_OPENAI_API_KEY";
			throw new Error(
				`${providerName} API key is required (${envVar}). Run "poolside setup" to configure.`
			);
		}

		return new MeetingExtractor(apiKey, {
			...config,
			provider,
			model,
		});
	}

	constructor(apiKey: string, config: ExtractorConfig = {}) {
		const provider = config.provider ?? "openai";

		if (!apiKey) {
			throw new Error(
				`API key required for ${provider === "anthropic" ? "Anthropic" : "OpenAI"}`
			);
		}

		if (provider === "anthropic") {
			process.env.ANTHROPIC_API_KEY = apiKey;
		} else {
			process.env.OPENAI_API_KEY = apiKey;
		}

		const defaultModel =
			provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-5.2";

		this.config = {
			provider,
			model: config.model ?? defaultModel,
			maxTokens: config.maxTokens ?? 4000,
			verbose: config.verbose ?? false,
			resolvedModel: config.resolvedModel,
		};

		this.verbose = this.config.verbose;
		this.progress = config.progress;

		const configManager = new ConfigManager();
		const timeoutEnv = process.env.POOLSIDE_AI_REQUEST_TIMEOUT_MS;
		const configTimeout =
			configManager.readConfigSync().credentials?.aiRequestTimeoutMs;
		this.requestTimeoutMs = this.parseTimeoutMs(
			timeoutEnv ||
				(configTimeout !== undefined ? String(configTimeout) : undefined)
		);

		this.model =
			provider === "anthropic"
				? anthropic(this.config.model)
				: openai(this.config.model);

		this.debugLog(`Meeting Extractor initialized`);
		this.debugLog(`Provider: ${this.config.provider}`);
		this.debugLog(`Model: ${this.config.model}`);
		this.debugLog(`Max Tokens: ${this.config.maxTokens}`);
	}

	private debugLog(message: string): void {
		if (this.progress) {
			this.progress.debug(message);
		} else if (this.verbose) {
			console.log(chalk.gray(`🔧 [VERBOSE] ${message}`));
		}
	}

	private parseTimeoutMs(value: string | undefined): number {
		const fallback = 120_000;
		if (!value) return fallback;
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
		if (parsed < 1_000) return fallback;
		return Math.floor(parsed);
	}

	async extractFromChunks(chunks: TranscriptChunk[]): Promise<ExtractionResult> {
		const startTime = Date.now();
		const extractions: ChunkExtraction[] = [];
		let runningSummary = "";

		this.debugLog(`Starting extraction for ${chunks.length} chunks`);

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];

			this.progress?.updateWithCount(i + 1, chunks.length, `Extracting from chunk`);
			this.debugLog(`Processing chunk ${i + 1}/${chunks.length}`);
			this.debugLog(`Chunk size: ${chunk.content.length} characters`);
			this.debugLog(`Speakers: ${chunk.speakersPresent.join(", ") || "unknown"}`);
			if (runningSummary) {
				this.debugLog(`Context from previous: ${runningSummary.slice(0, 100)}...`);
			}

			try {
				const extraction = await this.extractFromChunk(chunk, runningSummary);
				extractions.push(extraction);
				runningSummary = extraction.summaryForNextChunk;

				this.debugLog(`Chunk ${i + 1} results:`);
				this.debugLog(`  Decisions: ${extraction.decisions.length}`);
				this.debugLog(`  Action items: ${extraction.actionItems.length}`);
				this.debugLog(`  Deliverables: ${extraction.deliverables.length}`);
				this.debugLog(`  Key points: ${extraction.keyPoints.length}`);
			} catch (error) {
				throw wrapError(error, "extraction", {
					chunkIndex: i + 1,
					totalChunks: chunks.length,
					model: this.config.model,
					provider: this.config.provider,
				});
			}

			if (i < chunks.length - 1) {
				await this.delay(100);
			}
		}

		const processingTimeMs = Date.now() - startTime;

		const totals = this.computeTotals(extractions);
		this.debugLog(`Extraction complete in ${processingTimeMs}ms`);
		this.debugLog(`Total decisions: ${totals.decisions}`);
		this.debugLog(`Total action items: ${totals.actionItems}`);
		this.debugLog(`Total deliverables: ${totals.deliverables}`);

		return {
			extractions,
			totalChunks: chunks.length,
			processingTimeMs,
		};
	}

	private async extractFromChunk(
		chunk: TranscriptChunk,
		runningSummary: string
	): Promise<ChunkExtraction> {
		const prompt = this.buildExtractionPrompt(chunk, runningSummary);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, this.requestTimeoutMs);

		const startTime = Date.now();

		try {
			this.debugLog(`Sending extraction request...`);
			this.debugLog(`Prompt length: ${prompt.length} characters`);

			// @ts-expect-error AI SDK v6 + Zod 3.25.x type inference issue
			const { object, usage } = await generateObject({
				model: this.model,
				schema: ChunkExtractionSchema,
				system: EXTRACTION_SYSTEM_PROMPT,
				prompt,
				...(isReasoningModel(this.config.model) ? {} : { temperature: 0.1 }),
				maxOutputTokens: this.config.maxTokens,
				abortSignal: abortController.signal,
			});

			const duration = Date.now() - startTime;

			this.debugLog(`Response received in ${duration}ms`);
			if (usage) {
				this.debugLog(`Tokens - prompt: ${usage.inputTokens}, completion: ${usage.outputTokens}`);
			}

			return object;
		} catch (error: unknown) {
			const duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			this.debugLog(`Extraction failed: ${errorMessage}`);
			this.debugLog(`Duration before error: ${duration}ms`);

			if (error instanceof Error && error.name === "AbortError") {
				this.debugLog(`Request aborted due to timeout after ${this.requestTimeoutMs}ms`);
			}

			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private buildExtractionPrompt(
		chunk: TranscriptChunk,
		runningSummary: string
	): string {
		const parts: string[] = [];

		if (runningSummary) {
			parts.push(`CONTEXT FROM PREVIOUS SECTION:\n${runningSummary}\n`);
		}

		parts.push(`TRANSCRIPT SECTION ${chunk.index + 1}:`);

		if (chunk.speakersPresent.length > 0) {
			parts.push(`Speakers in this section: ${chunk.speakersPresent.join(", ")}`);
		}

		parts.push(`\n${chunk.content}`);

		if (chunk.hasOverlap && chunk.overlapContent) {
			parts.push(`\n[Section continues with: ${chunk.overlapContent.slice(0, 200)}...]`);
		}

		parts.push("\nExtract all decisions, action items, deliverables, and key points from this transcript section. Include direct quotes to support each extraction.");

		return parts.join("\n");
	}

	private computeTotals(extractions: ChunkExtraction[]): {
		decisions: number;
		actionItems: number;
		deliverables: number;
		keyPoints: number;
	} {
		return extractions.reduce(
			(acc, extraction) => ({
				decisions: acc.decisions + extraction.decisions.length,
				actionItems: acc.actionItems + extraction.actionItems.length,
				deliverables: acc.deliverables + extraction.deliverables.length,
				keyPoints: acc.keyPoints + extraction.keyPoints.length,
			}),
			{ decisions: 0, actionItems: 0, deliverables: 0, keyPoints: 0 }
		);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	getConfig(): Omit<ExtractorConfig, "resolvedModel"> {
		return {
			provider: this.config.provider,
			model: this.config.model,
			maxTokens: this.config.maxTokens,
			verbose: this.config.verbose,
		};
	}
}

export function createExtractor(config?: ExtractorConfig): Promise<MeetingExtractor> {
	return MeetingExtractor.create(config);
}
