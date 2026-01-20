import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import chalk from "chalk";
import {
	PRDSchema,
	type PRD,
	type RefinedMeeting,
	type RefinedDeliverable,
} from "./meeting-schemas.js";
import type {
	MeetingNotes,
	PRDDocument,
	MeetingResources,
} from "./meeting-types.js";
import {
	type AIProvider,
	type ResolvedModel,
	ConfigManager,
} from "./model-config.js";

export interface GeneratorConfig {
	provider?: AIProvider;
	model?: string;
	maxTokens?: number;
	verbose?: boolean;
	resolvedModel?: ResolvedModel;
}

export interface GeneratorResult {
	resources: MeetingResources;
	markdown: string;
	processingTimeMs: number;
	prdGenerated: boolean;
}

const PRD_GENERATION_SYSTEM_PROMPT = `You are a product manager creating a concise Product Requirements Document (PRD) from meeting discussion.

Your task is to transform deliverable information discussed in a meeting into a structured PRD.

REQUIREMENTS:
1. Feature Name: Clear, descriptive name for the feature/deliverable
2. Overview: 2-3 sentences explaining what this feature does and why it matters
3. Requirements: Break down into specific, actionable requirements using MoSCoW prioritization:
   - "must": Critical for launch
   - "should": Important but not blocking
   - "could": Nice to have
4. Timeline: Target delivery date/period if mentioned
5. Dependencies: External systems, teams, or blockers
6. Open Questions: Unresolved items that need answers before implementation

GUIDELINES:
- Be specific and actionable
- Don't invent requirements not discussed in the meeting
- Use the quotes provided to stay grounded in actual discussion
- Keep it concise - this is a starting point, not a final document`;

export class MeetingGenerator {
	private verbose: boolean;
	private config: Required<Omit<GeneratorConfig, "resolvedModel">> & {
		resolvedModel?: ResolvedModel;
	};
	private model: Parameters<typeof generateObject>[0]["model"];
	private requestTimeoutMs: number;

	static async create(config: GeneratorConfig = {}): Promise<MeetingGenerator> {
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

		return new MeetingGenerator(apiKey, {
			...config,
			provider,
			model,
		});
	}

	constructor(apiKey: string, config: GeneratorConfig = {}) {
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
			console.log(chalk.gray("🔧 [VERBOSE] Meeting Generator initialized"));
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

	async generate(
		refined: RefinedMeeting,
		options: { generatePrd?: boolean } = {}
	): Promise<GeneratorResult> {
		const startTime = Date.now();
		const shouldGeneratePrd =
			options.generatePrd !== false && refined.deliverables.length > 0;

		if (this.verbose) {
			console.log(chalk.gray("\n🔧 [VERBOSE] Starting resource generation"));
			console.log(
				chalk.gray(`🔧 [VERBOSE] Decisions: ${refined.decisions.length}`)
			);
			console.log(
				chalk.gray(`🔧 [VERBOSE] Action items: ${refined.actionItems.length}`)
			);
			console.log(
				chalk.gray(`🔧 [VERBOSE] Deliverables: ${refined.deliverables.length}`)
			);
			console.log(
				chalk.gray(`🔧 [VERBOSE] Will generate PRD: ${shouldGeneratePrd}`)
			);
		}

		const notes = this.generateMeetingNotes(refined);

		let prd: PRDDocument | undefined;
		if (shouldGeneratePrd) {
			prd = await this.generatePRD(refined);
		}

		const resources: MeetingResources = { notes, prd };
		const markdown = this.renderMarkdown(resources);

		const processingTimeMs = Date.now() - startTime;

		if (this.verbose) {
			console.log(chalk.gray(`🔧 [VERBOSE] Generation completed`));
			console.log(chalk.gray(`🔧 [VERBOSE] Duration: ${processingTimeMs}ms`));
			console.log(
				chalk.gray(`🔧 [VERBOSE] Markdown length: ${markdown.length} chars`)
			);
		}

		return {
			resources,
			markdown,
			processingTimeMs,
			prdGenerated: !!prd,
		};
	}

	generateMeetingNotes(refined: RefinedMeeting): MeetingNotes {
		if (this.verbose) {
			console.log(chalk.gray("🔧 [VERBOSE] Generating meeting notes"));
		}

		const title = this.inferMeetingTitle(refined);

		return {
			title,
			date: undefined,
			attendees: refined.attendees,
			summary: refined.meetingSummary,
			decisions: refined.decisions.map((d) => ({
				id: d.id,
				title: d.decision,
				description: d.rationale || d.decision,
				rationale: d.rationale,
				participants: d.madeBy ? [d.madeBy] : [],
				relatedActionItems: [],
			})),
			actionItems: refined.actionItems.map((a) => ({
				id: a.id,
				owner: a.owner || "TBD",
				task: a.task,
				dueDate: a.deadline,
				priority: a.priority || "medium",
				status: "open" as const,
				context: a.quote,
			})),
			keyDiscussionPoints: [],
			openQuestions: refined.openQuestions,
		};
	}

	private inferMeetingTitle(refined: RefinedMeeting): string {
		if (refined.deliverables.length > 0) {
			const mainDeliverable = refined.deliverables[0];
			return `Meeting Notes: ${mainDeliverable.name}`;
		}

		if (refined.decisions.length > 0) {
			const mainDecision = refined.decisions[0];
			const shortDecision =
				mainDecision.decision.length > 50
					? `${mainDecision.decision.substring(0, 47)}...`
					: mainDecision.decision;
			return `Meeting Notes: ${shortDecision}`;
		}

		return "Meeting Notes";
	}

	async generatePRD(refined: RefinedMeeting): Promise<PRDDocument | undefined> {
		if (refined.deliverables.length === 0) {
			if (this.verbose) {
				console.log(
					chalk.gray("🔧 [VERBOSE] No deliverables - skipping PRD generation")
				);
			}
			return undefined;
		}

		if (this.verbose) {
			console.log(
				chalk.gray(
					`🔧 [VERBOSE] Generating PRD for ${refined.deliverables.length} deliverables`
				)
			);
		}

		const prompt = this.buildPRDPrompt(refined);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, this.requestTimeoutMs);

		try {
			if (this.verbose) {
				console.log(chalk.gray("🔧 [VERBOSE] Sending PRD generation request"));
				console.log(
					chalk.gray(`🔧 [VERBOSE] Prompt length: ${prompt.length} characters`)
				);
			}

			const { object, usage } = await generateObject({
				model: this.model,
				schema: PRDSchema,
				system: PRD_GENERATION_SYSTEM_PROMPT,
				prompt,
				temperature: 0.2,
				maxTokens: this.config.maxTokens,
				abortSignal: abortController.signal,
			});

			if (this.verbose) {
				console.log(chalk.gray("🔧 [VERBOSE] PRD generation completed"));
				if (usage) {
					console.log(
						chalk.gray(
							`🔧 [VERBOSE] Tokens - prompt: ${usage.promptTokens}, completion: ${usage.completionTokens}`
						)
					);
				}
				console.log(
					chalk.gray(
						`🔧 [VERBOSE] Requirements generated: ${object.requirements.length}`
					)
				);
			}

			return this.convertToPRDDocument(object);
		} catch (error: unknown) {
			if (this.verbose) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.log(
					chalk.red(`🔧 [VERBOSE] PRD generation failed: ${errorMessage}`)
				);
			}
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private buildPRDPrompt(refined: RefinedMeeting): string {
		const parts: string[] = [];

		parts.push("DELIVERABLES DISCUSSED IN MEETING:\n");

		for (const d of refined.deliverables) {
			parts.push(`## ${d.name}`);
			parts.push(`Description: ${d.description}`);
			if (d.timeline) parts.push(`Timeline: ${d.timeline}`);
			if (d.owner) parts.push(`Owner: ${d.owner}`);
			parts.push(`Supporting quote: "${d.quote}"`);
			parts.push("");
		}

		if (refined.decisions.length > 0) {
			parts.push("\nRELATED DECISIONS:");
			for (const d of refined.decisions) {
				parts.push(`- ${d.decision}`);
				if (d.rationale) parts.push(`  Rationale: ${d.rationale}`);
			}
		}

		if (refined.actionItems.length > 0) {
			parts.push("\nRELATED ACTION ITEMS:");
			for (const a of refined.actionItems) {
				parts.push(`- ${a.task}`);
				if (a.owner) parts.push(`  Owner: ${a.owner}`);
				if (a.deadline) parts.push(`  Deadline: ${a.deadline}`);
			}
		}

		if (refined.openQuestions.length > 0) {
			parts.push("\nOPEN QUESTIONS FROM MEETING:");
			for (const q of refined.openQuestions) {
				parts.push(`- ${q}`);
			}
		}

		parts.push("\n---");
		parts.push(
			"Based on the above meeting discussion, create a focused PRD for the main deliverable(s). If multiple deliverables are related, combine them into a single coherent PRD. If they're unrelated, focus on the most significant one."
		);

		return parts.join("\n");
	}

	private convertToPRDDocument(prd: PRD): PRDDocument {
		return {
			featureName: prd.featureName,
			overview: prd.overview,
			requirements: prd.requirements.map((r) => ({
				id: r.id,
				requirement: r.description,
				priority: r.priority,
				status: "open" as const,
			})),
			timeline: prd.timeline
				? {
						target: prd.timeline,
						milestones: [],
					}
				: undefined,
			dependencies: prd.dependencies,
			openQuestions: prd.openQuestions,
		};
	}

	renderMarkdown(resources: MeetingResources): string {
		const sections: string[] = [];

		sections.push(this.renderNotesMarkdown(resources.notes));

		if (resources.prd) {
			sections.push("\n---\n");
			sections.push(this.renderPRDMarkdown(resources.prd));
		}

		return sections.join("\n");
	}

	private renderNotesMarkdown(notes: MeetingNotes): string {
		const lines: string[] = [];

		lines.push(`# ${notes.title}`);
		lines.push("");

		if (notes.date) {
			lines.push(`**Date:** ${notes.date}`);
		}

		if (notes.attendees.length > 0) {
			lines.push(`**Attendees:** ${notes.attendees.join(", ")}`);
		}

		lines.push("");
		lines.push("## Summary");
		lines.push("");
		lines.push(notes.summary);

		if (notes.decisions.length > 0) {
			lines.push("");
			lines.push("## Decisions");
			lines.push("");

			for (let i = 0; i < notes.decisions.length; i++) {
				const d = notes.decisions[i];
				lines.push(`${i + 1}. **${d.title}**`);
				if (d.rationale && d.rationale !== d.title) {
					lines.push(`   > ${d.rationale}`);
				}
				if (d.participants.length > 0) {
					lines.push(`   - *Decision by: ${d.participants.join(", ")}*`);
				}
			}
		}

		if (notes.actionItems.length > 0) {
			lines.push("");
			lines.push("## Action Items");
			lines.push("");
			lines.push("| Owner | Task | Due | Priority |");
			lines.push("|-------|------|-----|----------|");

			for (const a of notes.actionItems) {
				const priority = a.priority || "medium";
				const due = a.dueDate || "-";
				lines.push(`| ${a.owner} | ${a.task} | ${due} | ${priority} |`);
			}
		}

		if (notes.keyDiscussionPoints.length > 0) {
			lines.push("");
			lines.push("## Key Discussion Points");
			lines.push("");

			for (const point of notes.keyDiscussionPoints) {
				lines.push(`### ${point.topic}`);
				lines.push("");
				lines.push(point.summary);
				lines.push("");
			}
		}

		if (notes.openQuestions.length > 0) {
			lines.push("");
			lines.push("## Open Questions");
			lines.push("");

			for (const q of notes.openQuestions) {
				lines.push(`- [ ] ${q}`);
			}
		}

		return lines.join("\n");
	}

	private renderPRDMarkdown(prd: PRDDocument): string {
		const lines: string[] = [];

		lines.push(`# Product Requirements: ${prd.featureName}`);
		lines.push("");
		lines.push("## Overview");
		lines.push("");
		lines.push(prd.overview);

		if (prd.requirements.length > 0) {
			lines.push("");
			lines.push("## Requirements");
			lines.push("");
			lines.push("| ID | Requirement | Priority |");
			lines.push("|----|-------------|----------|");

			for (const r of prd.requirements) {
				const priorityLabel = r.priority.charAt(0).toUpperCase() + r.priority.slice(1);
				lines.push(`| ${r.id} | ${r.requirement} | ${priorityLabel} |`);
			}
		}

		if (prd.timeline?.target) {
			lines.push("");
			lines.push("## Timeline");
			lines.push("");
			lines.push(`**Target:** ${prd.timeline.target}`);

			if (prd.timeline.milestones.length > 0) {
				lines.push("");
				lines.push("**Milestones:**");
				for (const m of prd.timeline.milestones) {
					lines.push(`- ${m}`);
				}
			}
		}

		if (prd.dependencies.length > 0) {
			lines.push("");
			lines.push("## Dependencies");
			lines.push("");

			for (const d of prd.dependencies) {
				lines.push(`- ${d}`);
			}
		}

		if (prd.openQuestions.length > 0) {
			lines.push("");
			lines.push("## Open Questions");
			lines.push("");

			for (const q of prd.openQuestions) {
				lines.push(`- ${q}`);
			}
		}

		return lines.join("\n");
	}

	getConfig(): Omit<GeneratorConfig, "resolvedModel"> {
		return {
			provider: this.config.provider,
			model: this.config.model,
			maxTokens: this.config.maxTokens,
			verbose: this.config.verbose,
		};
	}
}

export function createGenerator(
	config?: GeneratorConfig
): Promise<MeetingGenerator> {
	return MeetingGenerator.create(config);
}
