import type {
	MeetingNotes,
	PRDDocument,
	MeetingResources,
	Decision,
	ActionItem,
} from "./meeting-types.js";

export type OutputFormat = "markdown" | "json";

export interface FormatterOptions {
	includeQuotes?: boolean;
	includeRationale?: boolean;
	compactTables?: boolean;
}

export function formatAsMarkdown(
	resources: MeetingResources,
	options: FormatterOptions = {}
): string {
	const sections: string[] = [];

	sections.push(formatNotesAsMarkdown(resources.notes, options));

	if (resources.prd) {
		sections.push("\n---\n");
		sections.push(formatPrdAsMarkdown(resources.prd, options));
	}

	return sections.join("\n");
}

export function formatAsJson(
	resources: MeetingResources,
	indent = 2
): string {
	return JSON.stringify(
		{
			notes: resources.notes,
			prd: resources.prd,
		},
		null,
		indent
	);
}

export function formatNotesAsMarkdown(
	notes: MeetingNotes,
	options: FormatterOptions = {}
): string {
	const lines: string[] = [];

	lines.push(...formatNotesHeader(notes));
	lines.push(...formatNotesSummary(notes));
	lines.push(...formatNotesDecisions(notes, options));
	lines.push(...formatNotesActionItems(notes, options));
	lines.push(...formatNotesDiscussionPoints(notes));
	lines.push(...formatNotesOpenQuestions(notes));

	return lines.join("\n");
}

function formatNotesHeader(notes: MeetingNotes): string[] {
	const lines: string[] = [];
	lines.push(`# ${notes.title}`);
	lines.push("");

	if (notes.date) {
		lines.push(`**Date:** ${notes.date}`);
	}

	if (notes.attendees.length > 0) {
		lines.push(`**Attendees:** ${notes.attendees.join(", ")}`);
	}

	return lines;
}

function formatNotesSummary(notes: MeetingNotes): string[] {
	return ["", "## Summary", "", notes.summary];
}

function formatNotesDecisions(notes: MeetingNotes, options: FormatterOptions): string[] {
	if (notes.decisions.length === 0) return [];

	const lines: string[] = ["", "## Decisions", ""];

	for (let i = 0; i < notes.decisions.length; i++) {
		const d = notes.decisions[i];
		lines.push(`${i + 1}. **${d.title}**`);
		if (options.includeRationale !== false && d.rationale && d.rationale !== d.title) {
			lines.push(`   > ${d.rationale}`);
		}
		if (d.participants.length > 0) {
			lines.push(`   - *Decision by: ${d.participants.join(", ")}*`);
		}
	}

	return lines;
}

function formatNotesActionItems(notes: MeetingNotes, options: FormatterOptions): string[] {
	if (notes.actionItems.length === 0) return [];
	return ["", "## Action Items", "", formatActionItemsTable(notes.actionItems, options)];
}

function formatNotesDiscussionPoints(notes: MeetingNotes): string[] {
	if (notes.keyDiscussionPoints.length === 0) return [];

	const lines: string[] = ["", "## Key Discussion Points", ""];

	for (const point of notes.keyDiscussionPoints) {
		lines.push(`### ${point.topic}`);
		lines.push("");
		lines.push(point.summary);
		lines.push("");
	}

	return lines;
}

function formatNotesOpenQuestions(notes: MeetingNotes): string[] {
	if (notes.openQuestions.length === 0) return [];

	const lines: string[] = ["", "## Open Questions", ""];

	for (const q of notes.openQuestions) {
		lines.push(`- [ ] ${q}`);
	}

	return lines;
}

export function formatPrdAsMarkdown(
	prd: PRDDocument,
	options: FormatterOptions = {}
): string {
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
		lines.push(formatRequirementsTable(prd, options));
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

function formatActionItemsTable(
	actionItems: ActionItem[],
	options: FormatterOptions = {}
): string {
	const lines: string[] = [];

	if (options.compactTables) {
		lines.push("| Owner | Task | Due |");
		lines.push("|-------|------|-----|");
		for (const a of actionItems) {
			const due = a.dueDate || "-";
			lines.push(`| ${escapeTableCell(a.owner)} | ${escapeTableCell(a.task)} | ${due} |`);
		}
	} else {
		lines.push("| Owner | Task | Due | Priority |");
		lines.push("|-------|------|-----|----------|");
		for (const a of actionItems) {
			const priority = a.priority || "medium";
			const due = a.dueDate || "-";
			lines.push(
				`| ${escapeTableCell(a.owner)} | ${escapeTableCell(a.task)} | ${due} | ${priority} |`
			);
		}
	}

	return lines.join("\n");
}

function formatRequirementsTable(
	prd: PRDDocument,
	options: FormatterOptions = {}
): string {
	const lines: string[] = [];

	if (options.compactTables) {
		lines.push("| ID | Requirement |");
		lines.push("|----|-------------|");
		for (const r of prd.requirements) {
			lines.push(`| ${r.id} | ${escapeTableCell(r.requirement)} |`);
		}
	} else {
		lines.push("| ID | Requirement | Priority |");
		lines.push("|----|-------------|----------|");
		for (const r of prd.requirements) {
			const priorityLabel = r.priority.charAt(0).toUpperCase() + r.priority.slice(1);
			lines.push(`| ${r.id} | ${escapeTableCell(r.requirement)} | ${priorityLabel} |`);
		}
	}

	return lines.join("\n");
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatDecisionsList(decisions: Decision[]): string {
	const lines: string[] = [];

	for (let i = 0; i < decisions.length; i++) {
		const d = decisions[i];
		lines.push(`${i + 1}. **${d.title}**`);
		if (d.rationale && d.rationale !== d.title) {
			lines.push(`   > ${d.rationale}`);
		}
		if (d.participants.length > 0) {
			lines.push(`   - *Decision by: ${d.participants.join(", ")}*`);
		}
	}

	return lines.join("\n");
}

export function formatOpenQuestionsList(questions: string[]): string {
	return questions.map((q) => `- [ ] ${q}`).join("\n");
}

export function format(
	resources: MeetingResources,
	outputFormat: OutputFormat,
	options: FormatterOptions = {}
): string {
	switch (outputFormat) {
		case "markdown":
			return formatAsMarkdown(resources, options);
		case "json":
			return formatAsJson(resources);
		default:
			throw new Error(`Unsupported output format: ${outputFormat}`);
	}
}
