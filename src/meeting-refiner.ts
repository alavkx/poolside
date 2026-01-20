import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import chalk from "chalk";
import {
	RefinedMeetingSchema,
	type ChunkExtraction,
	type RefinedMeeting,
} from "./meeting-schemas.js";
import {
	type AIProvider,
	type ResolvedModel,
	ConfigManager,
} from "./model-config.js";

export interface RefinerConfig {
	provider?: AIProvider;
	model?: string;
	maxTokens?: number;
	verbose?: boolean;
	resolvedModel?: ResolvedModel;
}

export interface RefinementResult {
	refined: RefinedMeeting;
	inputExtractionCount: number;
	processingTimeMs: number;
}

const REFINEMENT_SYSTEM_PROMPT = `You are an expert meeting analyst specializing in consolidating and refining meeting notes.

Your task is to take multiple extraction results from different sections of a meeting transcript and produce a single, cohesive set of refined meeting data.

CRITICAL REQUIREMENTS:

1. DEDUPLICATION:
   - Merge decisions that refer to the same topic even if worded differently
   - Combine action items that are duplicates or part of the same task
   - Consolidate deliverables that overlap or are subsets of each other
   - Keep the most complete/informative version when merging

2. CONFLICT RESOLUTION:
   - If conflicting information exists, prefer later mentions (they often supersede earlier discussions)
   - If deadlines conflict, use the most specific or most recent one
   - If owners conflict, use the most explicit assignment

3. ID GENERATION:
   - Generate unique IDs: D1, D2, D3... for decisions
   - A1, A2, A3... for action items
   - DEL1, DEL2, DEL3... for deliverables

4. ATTENDEE EXTRACTION:
   - Identify all unique speakers/participants from the extractions
   - Use consistent name formatting (first name or full name as mentioned)

5. SUMMARY CREATION:
   - Write a concise 2-4 sentence executive summary
   - Focus on the most important outcomes and decisions
   - Be specific about what was accomplished

6. OPEN QUESTIONS:
   - Identify unresolved questions that need follow-up
   - Don't include questions that were answered during the meeting

7. QUALITY:
   - Preserve supporting quotes from the original extractions
   - Maintain accuracy - don't add information not in the extractions
   - Use clear, actionable language`;

export class MeetingRefiner {
	private verbose: boolean;
	private config: Required<Omit<RefinerConfig, "resolvedModel">> & {
		resolvedModel?: ResolvedModel;
	};
	private model: Parameters<typeof generateObject>[0]["model"];
	private requestTimeoutMs: number;

	static async create(config: RefinerConfig = {}): Promise<MeetingRefiner> {
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

		return new MeetingRefiner(apiKey, {
			...config,
			provider,
			model,
		});
	}

	constructor(apiKey: string, config: RefinerConfig = {}) {
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
			maxTokens: config.maxTokens ?? 8000,
			verbose: config.verbose ?? false,
			resolvedModel: config.resolvedModel,
		};

		this.verbose = this.config.verbose;

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

		if (this.verbose) {
			console.log(chalk.gray("🔧 [VERBOSE] Meeting Refiner initialized"));
			console.log(chalk.gray(`🔧 [VERBOSE] Provider: ${this.config.provider}`));
			console.log(chalk.gray(`🔧 [VERBOSE] Model: ${this.config.model}`));
			console.log(
				chalk.gray(`🔧 [VERBOSE] Max Tokens: ${this.config.maxTokens}`)
			);
		}
	}

	private parseTimeoutMs(value: string | undefined): number {
		const fallback = 180_000;
		if (!value) return fallback;
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
		if (parsed < 1_000) return fallback;
		return Math.floor(parsed);
	}

	async refine(extractions: ChunkExtraction[]): Promise<RefinementResult> {
		const startTime = Date.now();

		if (this.verbose) {
			console.log(
				chalk.gray(`\n🔧 [VERBOSE] Starting refinement for ${extractions.length} extractions`)
			);
			this.logExtractionStats(extractions);
		}

		if (extractions.length === 0) {
			return {
				refined: this.emptyRefinedMeeting(),
				inputExtractionCount: 0,
				processingTimeMs: Date.now() - startTime,
			};
		}

		const prompt = this.buildRefinementPrompt(extractions);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, this.requestTimeoutMs);

		try {
			if (this.verbose) {
				console.log(chalk.gray("🔧 [VERBOSE] Sending refinement request..."));
				console.log(
					chalk.gray(`🔧 [VERBOSE] Prompt length: ${prompt.length} characters`)
				);
			}

			const { object, usage } = await generateObject({
				model: this.model,
				schema: RefinedMeetingSchema,
				system: REFINEMENT_SYSTEM_PROMPT,
				prompt,
				temperature: 0.1,
				maxTokens: this.config.maxTokens,
				abortSignal: abortController.signal,
			});

			const processingTimeMs = Date.now() - startTime;

			if (this.verbose) {
				console.log(chalk.gray("🔧 [VERBOSE] Refinement response received"));
				console.log(chalk.gray(`🔧 [VERBOSE] Duration: ${processingTimeMs}ms`));
				if (usage) {
					console.log(
						chalk.gray(
							`🔧 [VERBOSE] Tokens - prompt: ${usage.promptTokens}, completion: ${usage.completionTokens}`
						)
					);
				}
				this.logRefinementResults(object);
			}

			return {
				refined: object,
				inputExtractionCount: extractions.length,
				processingTimeMs,
			};
		} catch (error: unknown) {
			const duration = Date.now() - startTime;

			if (this.verbose) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.log(chalk.red(`🔧 [VERBOSE] Refinement failed: ${errorMessage}`));
				console.log(chalk.red(`🔧 [VERBOSE] Duration before error: ${duration}ms`));

				if (error instanceof Error && error.name === "AbortError") {
					console.log(
						chalk.red(
							`🔧 [VERBOSE] Request aborted due to timeout after ${this.requestTimeoutMs}ms`
						)
					);
				}
			}

			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private buildRefinementPrompt(extractions: ChunkExtraction[]): string {
		const parts: string[] = [];

		parts.push("EXTRACTED DATA FROM MEETING TRANSCRIPT CHUNKS:\n");
		parts.push(`Total chunks processed: ${extractions.length}\n`);

		parts.push("---\n");
		parts.push("ALL DECISIONS:");
		const allDecisions = extractions.flatMap((e, i) =>
			e.decisions.map((d) => ({ ...d, chunkIndex: i + 1 }))
		);
		if (allDecisions.length === 0) {
			parts.push("\n(None extracted)\n");
		} else {
			for (const d of allDecisions) {
				parts.push(`\n[Chunk ${d.chunkIndex}]`);
				parts.push(`Decision: ${d.decision}`);
				if (d.madeBy) parts.push(`Made by: ${d.madeBy}`);
				parts.push(`Quote: "${d.quote}"`);
			}
			parts.push("");
		}

		parts.push("---\n");
		parts.push("ALL ACTION ITEMS:");
		const allActionItems = extractions.flatMap((e, i) =>
			e.actionItems.map((a) => ({ ...a, chunkIndex: i + 1 }))
		);
		if (allActionItems.length === 0) {
			parts.push("\n(None extracted)\n");
		} else {
			for (const a of allActionItems) {
				parts.push(`\n[Chunk ${a.chunkIndex}]`);
				parts.push(`Task: ${a.task}`);
				if (a.owner) parts.push(`Owner: ${a.owner}`);
				if (a.deadline) parts.push(`Deadline: ${a.deadline}`);
				parts.push(`Quote: "${a.quote}"`);
			}
			parts.push("");
		}

		parts.push("---\n");
		parts.push("ALL DELIVERABLES:");
		const allDeliverables = extractions.flatMap((e, i) =>
			e.deliverables.map((d) => ({ ...d, chunkIndex: i + 1 }))
		);
		if (allDeliverables.length === 0) {
			parts.push("\n(None extracted)\n");
		} else {
			for (const d of allDeliverables) {
				parts.push(`\n[Chunk ${d.chunkIndex}]`);
				parts.push(`Name: ${d.name}`);
				parts.push(`Description: ${d.description}`);
				if (d.timeline) parts.push(`Timeline: ${d.timeline}`);
				parts.push(`Quote: "${d.quote}"`);
			}
			parts.push("");
		}

		parts.push("---\n");
		parts.push("KEY POINTS FROM ALL CHUNKS:");
		const allKeyPoints = extractions.flatMap((e, i) =>
			e.keyPoints.map((kp) => `[Chunk ${i + 1}] ${kp}`)
		);
		if (allKeyPoints.length === 0) {
			parts.push("\n(None extracted)\n");
		} else {
			for (const kp of allKeyPoints) {
				parts.push(`- ${kp}`);
			}
			parts.push("");
		}

		parts.push("---\n");
		parts.push("CHUNK SUMMARIES (for context flow):");
		for (let i = 0; i < extractions.length; i++) {
			parts.push(`\n[Chunk ${i + 1}] ${extractions[i].summaryForNextChunk}`);
		}

		parts.push("\n\n---");
		parts.push(
			"Please consolidate the above extractions into a single refined meeting summary. Merge duplicates, resolve any conflicts, identify all attendees, and create a cohesive executive summary."
		);

		return parts.join("\n");
	}

	private emptyRefinedMeeting(): RefinedMeeting {
		return {
			decisions: [],
			actionItems: [],
			deliverables: [],
			meetingSummary: "No content was extracted from the meeting transcript.",
			attendees: [],
			openQuestions: [],
		};
	}

	private logExtractionStats(extractions: ChunkExtraction[]): void {
		const stats = extractions.reduce(
			(acc, e) => ({
				decisions: acc.decisions + e.decisions.length,
				actionItems: acc.actionItems + e.actionItems.length,
				deliverables: acc.deliverables + e.deliverables.length,
				keyPoints: acc.keyPoints + e.keyPoints.length,
			}),
			{ decisions: 0, actionItems: 0, deliverables: 0, keyPoints: 0 }
		);

		console.log(chalk.gray(`🔧 [VERBOSE] Input stats:`));
		console.log(chalk.gray(`  Raw decisions: ${stats.decisions}`));
		console.log(chalk.gray(`  Raw action items: ${stats.actionItems}`));
		console.log(chalk.gray(`  Raw deliverables: ${stats.deliverables}`));
		console.log(chalk.gray(`  Raw key points: ${stats.keyPoints}`));
	}

	private logRefinementResults(refined: RefinedMeeting): void {
		console.log(chalk.gray(`🔧 [VERBOSE] Refinement results:`));
		console.log(chalk.gray(`  Decisions: ${refined.decisions.length}`));
		console.log(chalk.gray(`  Action items: ${refined.actionItems.length}`));
		console.log(chalk.gray(`  Deliverables: ${refined.deliverables.length}`));
		console.log(chalk.gray(`  Attendees: ${refined.attendees.length}`));
		console.log(chalk.gray(`  Open questions: ${refined.openQuestions.length}`));
	}

	getConfig(): Omit<RefinerConfig, "resolvedModel"> {
		return {
			provider: this.config.provider,
			model: this.config.model,
			maxTokens: this.config.maxTokens,
			verbose: this.config.verbose,
		};
	}
}

export function createRefiner(config?: RefinerConfig): Promise<MeetingRefiner> {
	return MeetingRefiner.create(config);
}
