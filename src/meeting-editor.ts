import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import chalk from "chalk";
import { z } from "zod";
import type {
	MeetingNotes,
	PRDDocument,
	MeetingResources,
	FinalOutput,
} from "./meeting-types.js";
import {
	type AIProvider,
	type ResolvedModel,
	ConfigManager,
} from "./model-config.js";
import type { PipelineProgress } from "./meeting-progress.js";
import { wrapError } from "./meeting-errors.js";

export interface EditorConfig {
	provider?: AIProvider;
	model?: string;
	maxTokens?: number;
	verbose?: boolean;
	resolvedModel?: ResolvedModel;
	progress?: PipelineProgress;
}

export interface EditorResult {
	output: FinalOutput;
	processingTimeMs: number;
	changesApplied: string[];
}

const EditedNotesSchema = z.object({
	title: z.string().describe("Polished meeting title"),
	date: z.string().optional().describe("Meeting date if mentioned"),
	attendees: z.array(z.string()).describe("List of attendees"),
	summary: z.string().describe("Polished executive summary - clear and actionable"),
	decisions: z.array(
		z.object({
			id: z.string(),
			title: z.string().describe("Clear, actionable decision statement"),
			description: z.string(),
			rationale: z.string().optional(),
			participants: z.array(z.string()),
			relatedActionItems: z.array(z.string()),
		})
	),
	actionItems: z.array(
		z.object({
			id: z.string(),
			owner: z.string(),
			task: z.string().describe("Clear, actionable task description"),
			dueDate: z.string().optional(),
			priority: z.enum(["high", "medium", "low"]),
			status: z.enum(["open", "in_progress", "completed"]),
			context: z.string().optional(),
		})
	),
	keyDiscussionPoints: z.array(
		z.object({
			topic: z.string(),
			summary: z.string(),
		})
	),
	openQuestions: z.array(z.string()).describe("Open questions for follow-up"),
});

const EditedPRDSchema = z.object({
	featureName: z.string().describe("Clear feature name"),
	overview: z.string().describe("Polished overview paragraph"),
	requirements: z.array(
		z.object({
			id: z.string(),
			requirement: z.string().describe("Clear, testable requirement"),
			priority: z.enum(["must", "should", "could", "wont"]),
			status: z.enum(["open", "in_progress", "completed"]),
		})
	),
	timeline: z
		.object({
			target: z.string().optional(),
			milestones: z.array(z.string()),
		})
		.optional(),
	dependencies: z.array(z.string()),
	openQuestions: z.array(z.string()),
});

const EditingResultSchema = z.object({
	notes: EditedNotesSchema,
	prd: EditedPRDSchema.optional(),
	changesApplied: z
		.array(z.string())
		.describe("List of specific changes made for consistency and clarity"),
});

const EDITING_SYSTEM_PROMPT = `You are an expert editor specializing in meeting documentation. Your task is to perform a final polish pass on meeting notes and (if present) a PRD document.

CRITICAL REQUIREMENTS:

1. CONSISTENCY CHECK:
   - Ensure attendee names are consistently formatted (e.g., don't mix "John" and "John Smith")
   - Verify action item owners match people in the attendees list
   - Check that deliverables mentioned in notes align with the PRD (if present)
   - Ensure dates and timelines are consistent between notes and PRD

2. REDUNDANCY REMOVAL:
   - Remove duplicate information between sections
   - Consolidate overlapping action items
   - Avoid repeating the same point in summary and decisions

3. ACTIONABILITY:
   - Ensure action items have clear, specific tasks (not vague like "look into X")
   - Verify each action item has an owner (or mark as "TBD" if unassigned)
   - Make sure open questions are actually questions, not statements

4. CLARITY:
   - Rewrite unclear sentences
   - Use consistent terminology throughout
   - Ensure decision statements are definitive, not wishy-washy

5. CROSS-DOCUMENT ALIGNMENT (when PRD is present):
   - PRD feature name should align with meeting discussion
   - Requirements in PRD should reflect decisions from meeting
   - Open questions should not duplicate between notes and PRD

DO NOT:
- Invent new information not present in the original
- Remove valid content
- Change the fundamental meaning of decisions or action items
- Add unnecessary filler or corporate jargon

Track all changes you make in the changesApplied array.`;

export class MeetingEditor {
	private verbose: boolean;
	private config: Required<Omit<EditorConfig, "resolvedModel" | "progress">> & {
		resolvedModel?: ResolvedModel;
	};
	private model: Parameters<typeof generateObject>[0]["model"];
	private requestTimeoutMs: number;
	private progress?: PipelineProgress;

	static async create(config: EditorConfig = {}): Promise<MeetingEditor> {
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

		return new MeetingEditor(apiKey, {
			...config,
			provider,
			model,
		});
	}

	constructor(apiKey: string, config: EditorConfig = {}) {
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

		this.debugLog(`Meeting Editor initialized`);
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
		const fallback = 180_000;
		if (!value) return fallback;
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
		if (parsed < 1_000) return fallback;
		return Math.floor(parsed);
	}

	async edit(resources: MeetingResources): Promise<EditorResult> {
		const startTime = Date.now();

		this.debugLog(`Starting editing pass`);
		this.debugLog(`Notes title: ${resources.notes.title}`);
		this.debugLog(`Decisions: ${resources.notes.decisions.length}`);
		this.debugLog(`Action items: ${resources.notes.actionItems.length}`);
		this.debugLog(`PRD present: ${!!resources.prd}`);

		const prompt = this.buildEditingPrompt(resources);

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			abortController.abort();
		}, this.requestTimeoutMs);

		try {
			this.debugLog(`Sending editing request...`);
			this.debugLog(`Prompt length: ${prompt.length} characters`);

			const { object, usage } = await generateObject({
				model: this.model,
				schema: EditingResultSchema,
				system: EDITING_SYSTEM_PROMPT,
				prompt,
				temperature: 0.1,
				maxTokens: this.config.maxTokens,
				abortSignal: abortController.signal,
			});

			const processingTimeMs = Date.now() - startTime;

			this.debugLog(`Editing response received in ${processingTimeMs}ms`);
			if (usage) {
				this.debugLog(`Tokens - prompt: ${usage.promptTokens}, completion: ${usage.completionTokens}`);
			}
			this.debugLog(`Changes applied: ${object.changesApplied.length}`);
			for (const change of object.changesApplied) {
				this.debugLog(`  - ${change}`);
			}

			const editedNotes = this.mapToMeetingNotes(object.notes);
			const editedPrd = object.prd ? this.mapToPRDDocument(object.prd) : undefined;

			const markdown = this.renderMarkdown({ notes: editedNotes, prd: editedPrd });
			const json = JSON.stringify({ notes: editedNotes, prd: editedPrd }, null, 2);

			return {
				output: {
					notes: editedNotes,
					prd: editedPrd,
					markdown,
					json,
				},
				processingTimeMs,
				changesApplied: object.changesApplied,
			};
		} catch (error: unknown) {
			const duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			this.debugLog(`Editing failed: ${errorMessage}`);
			this.debugLog(`Duration before error: ${duration}ms`);

			if (error instanceof Error && error.name === "AbortError") {
				this.debugLog(`Request aborted due to timeout after ${this.requestTimeoutMs}ms`);
			}

			throw wrapError(error, "editing", {
				model: this.config.model,
				provider: this.config.provider,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private buildEditingPrompt(resources: MeetingResources): string {
		const parts: string[] = [];

		parts.push("MEETING NOTES TO EDIT:\n");
		parts.push("```json");
		parts.push(JSON.stringify(resources.notes, null, 2));
		parts.push("```\n");

		if (resources.prd) {
			parts.push("PRD DOCUMENT TO EDIT:\n");
			parts.push("```json");
			parts.push(JSON.stringify(resources.prd, null, 2));
			parts.push("```\n");
		}

		parts.push("---");
		parts.push(
			"Please review and polish the above documents for consistency, clarity, and actionability. Ensure alignment between the meeting notes and PRD (if present). Track all changes you make."
		);

		return parts.join("\n");
	}

	private mapToMeetingNotes(
		edited: z.infer<typeof EditedNotesSchema>
	): MeetingNotes {
		return {
			title: edited.title,
			date: edited.date,
			attendees: edited.attendees,
			summary: edited.summary,
			decisions: edited.decisions.map((d) => ({
				id: d.id,
				title: d.title,
				description: d.description,
				rationale: d.rationale,
				participants: d.participants,
				relatedActionItems: d.relatedActionItems,
			})),
			actionItems: edited.actionItems.map((a) => ({
				id: a.id,
				owner: a.owner,
				task: a.task,
				dueDate: a.dueDate,
				priority: a.priority,
				status: a.status,
				context: a.context,
			})),
			keyDiscussionPoints: edited.keyDiscussionPoints,
			openQuestions: edited.openQuestions,
		};
	}

	private mapToPRDDocument(
		edited: z.infer<typeof EditedPRDSchema>
	): PRDDocument {
		return {
			featureName: edited.featureName,
			overview: edited.overview,
			requirements: edited.requirements.map((r) => ({
				id: r.id,
				requirement: r.requirement,
				priority: r.priority,
				status: r.status,
			})),
			timeline: edited.timeline,
			dependencies: edited.dependencies,
			openQuestions: edited.openQuestions,
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
				const priorityLabel =
					r.priority.charAt(0).toUpperCase() + r.priority.slice(1);
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

	getConfig(): Omit<EditorConfig, "resolvedModel"> {
		return {
			provider: this.config.provider,
			model: this.config.model,
			maxTokens: this.config.maxTokens,
			verbose: this.config.verbose,
		};
	}
}

export function createEditor(config?: EditorConfig): Promise<MeetingEditor> {
	return MeetingEditor.create(config);
}
