import { describe, it, expect } from "vitest";
import {
	formatAsMarkdown,
	formatAsJson,
	formatNotesAsMarkdown,
	formatPrdAsMarkdown,
	formatDecisionsList,
	formatOpenQuestionsList,
	format,
	slugify,
} from "../src/meeting-formatters";
import type {
	MeetingNotes,
	PRDDocument,
	MeetingResources,
	Decision,
} from "../src/meeting-types";

const mockNotes: MeetingNotes = {
	title: "Q1 Planning Review",
	date: "January 15, 2026",
	attendees: ["Sarah", "John", "Mike", "Lisa"],
	summary:
		"Team reviewed Q1 roadmap and agreed to prioritize the new dashboard feature.",
	decisions: [
		{
			id: "D1",
			title: "Dashboard ships in February",
			description: "Team agreed to target Feb 15 launch",
			rationale: "Aligns with Q1 goals and resource availability",
			participants: ["Sarah"],
			relatedActionItems: ["A1"],
		},
		{
			id: "D2",
			title: "API v2 delayed to Q2",
			description: "Moved due to resource constraints",
			participants: ["John"],
			relatedActionItems: [],
		},
	],
	actionItems: [
		{
			id: "A1",
			owner: "Mike",
			task: "Create dashboard wireframes",
			dueDate: "Jan 22",
			priority: "high",
			status: "open",
		},
		{
			id: "A2",
			owner: "Lisa",
			task: "Write API migration guide",
			dueDate: "Feb 1",
			priority: "medium",
			status: "open",
		},
	],
	keyDiscussionPoints: [
		{
			topic: "Resource Allocation",
			summary: "Discussed reallocating team members from legacy project.",
		},
	],
	openQuestions: [
		"Do we need legal review for the new terms?",
		"What is the backup plan if the vendor delays?",
	],
};

const mockPrd: PRDDocument = {
	featureName: "Dashboard Redesign",
	overview:
		"New analytics dashboard providing real-time metrics and improved UX.",
	requirements: [
		{
			id: "R1",
			requirement: "Real-time data refresh",
			priority: "must",
			status: "open",
		},
		{
			id: "R2",
			requirement: "Export to CSV",
			priority: "should",
			status: "open",
		},
		{
			id: "R3",
			requirement: "Custom date ranges",
			priority: "must",
			status: "open",
		},
	],
	timeline: {
		target: "February 15, 2026",
		milestones: ["Design complete by Jan 25", "Beta by Feb 1"],
	},
	dependencies: ["Analytics service API", "Authentication system"],
	openQuestions: ["Data retention policy for dashboard metrics?"],
};

const mockResources: MeetingResources = {
	notes: mockNotes,
	prd: mockPrd,
};

const mockResourcesNoPrd: MeetingResources = {
	notes: mockNotes,
};

describe("formatAsMarkdown", () => {
	it("should format meeting notes as markdown", () => {
		const result = formatAsMarkdown(mockResourcesNoPrd);

		expect(result).toContain("# Q1 Planning Review");
		expect(result).toContain("**Date:** January 15, 2026");
		expect(result).toContain("**Attendees:** Sarah, John, Mike, Lisa");
		expect(result).toContain("## Summary");
		expect(result).toContain("## Decisions");
		expect(result).toContain("## Action Items");
		expect(result).toContain("## Open Questions");
	});

	it("should include PRD when present", () => {
		const result = formatAsMarkdown(mockResources);

		expect(result).toContain("# Q1 Planning Review");
		expect(result).toContain("---");
		expect(result).toContain("# Product Requirements: Dashboard Redesign");
	});

	it("should render decisions with rationale as blockquote", () => {
		const result = formatAsMarkdown(mockResources);

		expect(result).toContain("1. **Dashboard ships in February**");
		expect(result).toContain("> Aligns with Q1 goals and resource availability");
		expect(result).toContain("*Decision by: Sarah*");
	});

	it("should render action items as a table", () => {
		const result = formatAsMarkdown(mockResources);

		expect(result).toContain("| Owner | Task | Due | Priority |");
		expect(result).toContain("|-------|------|-----|----------|");
		expect(result).toContain(
			"| Mike | Create dashboard wireframes | Jan 22 | high |"
		);
	});

	it("should render open questions as checkboxes", () => {
		const result = formatAsMarkdown(mockResources);

		expect(result).toContain("- [ ] Do we need legal review for the new terms?");
		expect(result).toContain("- [ ] What is the backup plan if the vendor delays?");
	});

	it("should render key discussion points", () => {
		const result = formatAsMarkdown(mockResources);

		expect(result).toContain("## Key Discussion Points");
		expect(result).toContain("### Resource Allocation");
		expect(result).toContain(
			"Discussed reallocating team members from legacy project."
		);
	});

	it("should respect includeRationale option", () => {
		const result = formatAsMarkdown(mockResources, { includeRationale: false });

		expect(result).not.toContain(
			"> Aligns with Q1 goals and resource availability"
		);
	});

	it("should respect compactTables option", () => {
		const result = formatAsMarkdown(mockResources, { compactTables: true });

		expect(result).toContain("| Owner | Task | Due |");
		expect(result).not.toContain("| Owner | Task | Due | Priority |");
	});
});

describe("formatAsJson", () => {
	it("should format resources as JSON", () => {
		const result = formatAsJson(mockResources);
		const parsed = JSON.parse(result);

		expect(parsed.notes).toBeDefined();
		expect(parsed.notes.title).toBe("Q1 Planning Review");
		expect(parsed.prd).toBeDefined();
		expect(parsed.prd.featureName).toBe("Dashboard Redesign");
	});

	it("should format resources without PRD", () => {
		const result = formatAsJson(mockResourcesNoPrd);
		const parsed = JSON.parse(result);

		expect(parsed.notes).toBeDefined();
		expect(parsed.prd).toBeUndefined();
	});

	it("should respect indent parameter", () => {
		const result2 = formatAsJson(mockResources, 2);
		const result4 = formatAsJson(mockResources, 4);

		expect(result4.length).toBeGreaterThan(result2.length);
	});

	it("should produce valid JSON", () => {
		const result = formatAsJson(mockResources);

		expect(() => JSON.parse(result)).not.toThrow();
	});
});

describe("formatNotesAsMarkdown", () => {
	it("should format notes without date when not provided", () => {
		const notesWithoutDate: MeetingNotes = {
			...mockNotes,
			date: undefined,
		};

		const result = formatNotesAsMarkdown(notesWithoutDate);

		expect(result).not.toContain("**Date:**");
	});

	it("should handle empty attendees list", () => {
		const notesWithoutAttendees: MeetingNotes = {
			...mockNotes,
			attendees: [],
		};

		const result = formatNotesAsMarkdown(notesWithoutAttendees);

		expect(result).not.toContain("**Attendees:**");
	});

	it("should handle empty decisions list", () => {
		const notesWithoutDecisions: MeetingNotes = {
			...mockNotes,
			decisions: [],
		};

		const result = formatNotesAsMarkdown(notesWithoutDecisions);

		expect(result).not.toContain("## Decisions");
	});

	it("should handle empty action items list", () => {
		const notesWithoutActions: MeetingNotes = {
			...mockNotes,
			actionItems: [],
		};

		const result = formatNotesAsMarkdown(notesWithoutActions);

		expect(result).not.toContain("## Action Items");
	});

	it("should handle empty open questions list", () => {
		const notesWithoutQuestions: MeetingNotes = {
			...mockNotes,
			openQuestions: [],
		};

		const result = formatNotesAsMarkdown(notesWithoutQuestions);

		expect(result).not.toContain("## Open Questions");
	});

	it("should handle missing due date in action items", () => {
		const notesWithMissingDue: MeetingNotes = {
			...mockNotes,
			actionItems: [
				{
					id: "A1",
					owner: "Mike",
					task: "Some task",
					priority: "high",
					status: "open",
				},
			],
		};

		const result = formatNotesAsMarkdown(notesWithMissingDue);

		expect(result).toContain("| Mike | Some task | - | high |");
	});

	it("should escape pipe characters in table cells", () => {
		const notesWithPipe: MeetingNotes = {
			...mockNotes,
			actionItems: [
				{
					id: "A1",
					owner: "Mike|Sarah",
					task: "Task with | pipe",
					dueDate: "Jan 22",
					priority: "high",
					status: "open",
				},
			],
		};

		const result = formatNotesAsMarkdown(notesWithPipe);

		expect(result).toContain("Mike\\|Sarah");
		expect(result).toContain("Task with \\| pipe");
	});
});

describe("formatPrdAsMarkdown", () => {
	it("should format PRD with all sections", () => {
		const result = formatPrdAsMarkdown(mockPrd);

		expect(result).toContain("# Product Requirements: Dashboard Redesign");
		expect(result).toContain("## Overview");
		expect(result).toContain("## Requirements");
		expect(result).toContain("## Timeline");
		expect(result).toContain("## Dependencies");
		expect(result).toContain("## Open Questions");
	});

	it("should render requirements table with capitalized priority", () => {
		const result = formatPrdAsMarkdown(mockPrd);

		expect(result).toContain("| R1 | Real-time data refresh | Must |");
		expect(result).toContain("| R2 | Export to CSV | Should |");
	});

	it("should render timeline with milestones", () => {
		const result = formatPrdAsMarkdown(mockPrd);

		expect(result).toContain("**Target:** February 15, 2026");
		expect(result).toContain("**Milestones:**");
		expect(result).toContain("- Design complete by Jan 25");
		expect(result).toContain("- Beta by Feb 1");
	});

	it("should handle PRD without timeline", () => {
		const prdWithoutTimeline: PRDDocument = {
			...mockPrd,
			timeline: undefined,
		};

		const result = formatPrdAsMarkdown(prdWithoutTimeline);

		expect(result).not.toContain("## Timeline");
	});

	it("should handle PRD with empty dependencies", () => {
		const prdWithoutDeps: PRDDocument = {
			...mockPrd,
			dependencies: [],
		};

		const result = formatPrdAsMarkdown(prdWithoutDeps);

		expect(result).not.toContain("## Dependencies");
	});

	it("should handle PRD with empty open questions", () => {
		const prdWithoutQuestions: PRDDocument = {
			...mockPrd,
			openQuestions: [],
		};

		const result = formatPrdAsMarkdown(prdWithoutQuestions);

		expect(result).not.toContain("## Open Questions");
	});

	it("should respect compactTables option for requirements", () => {
		const result = formatPrdAsMarkdown(mockPrd, { compactTables: true });

		expect(result).toContain("| ID | Requirement |");
		expect(result).not.toContain("| ID | Requirement | Priority |");
	});
});

describe("formatDecisionsList", () => {
	it("should format decisions as numbered list", () => {
		const decisions: Decision[] = [
			{
				id: "D1",
				title: "First decision",
				description: "Description",
				participants: ["Alice"],
				relatedActionItems: [],
			},
			{
				id: "D2",
				title: "Second decision",
				description: "Description",
				rationale: "Because reasons",
				participants: ["Bob", "Carol"],
				relatedActionItems: [],
			},
		];

		const result = formatDecisionsList(decisions);

		expect(result).toContain("1. **First decision**");
		expect(result).toContain("2. **Second decision**");
		expect(result).toContain("> Because reasons");
		expect(result).toContain("*Decision by: Alice*");
		expect(result).toContain("*Decision by: Bob, Carol*");
	});

	it("should skip rationale if it matches title", () => {
		const decisions: Decision[] = [
			{
				id: "D1",
				title: "Same text",
				description: "Description",
				rationale: "Same text",
				participants: [],
				relatedActionItems: [],
			},
		];

		const result = formatDecisionsList(decisions);

		expect(result).toContain("1. **Same text**");
		expect(result.match(/Same text/g)?.length).toBe(1);
	});
});

describe("formatOpenQuestionsList", () => {
	it("should format questions as checkboxes", () => {
		const questions = ["Question 1?", "Question 2?"];

		const result = formatOpenQuestionsList(questions);

		expect(result).toBe("- [ ] Question 1?\n- [ ] Question 2?");
	});

	it("should handle empty list", () => {
		const result = formatOpenQuestionsList([]);

		expect(result).toBe("");
	});
});

describe("format", () => {
	it("should format as markdown when format is markdown", () => {
		const result = format(mockResources, "markdown");

		expect(result).toContain("# Q1 Planning Review");
		expect(result).toContain("---");
	});

	it("should format as JSON when format is json", () => {
		const result = format(mockResources, "json");
		const parsed = JSON.parse(result);

		expect(parsed.notes.title).toBe("Q1 Planning Review");
	});

	it("should throw error for unsupported format", () => {
		expect(() => format(mockResources, "xml" as "markdown" | "json")).toThrow(
			"Unsupported output format: xml"
		);
	});

	it("should pass options to markdown formatter", () => {
		const result = format(mockResources, "markdown", { compactTables: true });

		expect(result).toContain("| Owner | Task | Due |");
		expect(result).not.toContain("| Owner | Task | Due | Priority |");
	});
});

describe("slugify", () => {
	it("should convert title to URL-friendly slug", () => {
		expect(slugify("Project Kickoff Meeting")).toBe("project-kickoff-meeting");
	});

	it("should strip 'Meeting Notes:' prefix", () => {
		expect(slugify("Meeting Notes: Q1 Planning")).toBe("q1-planning");
		expect(slugify("Meeting Notes Q1 Planning")).toBe("q1-planning");
	});

	it("should handle special characters", () => {
		expect(slugify("Design Review (v2.0)")).toBe("design-review-v2-0");
		expect(slugify("Sprint #5 - Retrospective")).toBe("sprint-5-retrospective");
	});

	it("should collapse multiple hyphens", () => {
		expect(slugify("Project   Update")).toBe("project-update");
		expect(slugify("One---Two")).toBe("one-two");
	});

	it("should trim leading and trailing hyphens", () => {
		expect(slugify("---title---")).toBe("title");
		expect(slugify("  title  ")).toBe("title");
	});

	it("should return 'meeting' for empty or whitespace-only input", () => {
		expect(slugify("")).toBe("meeting");
		expect(slugify("   ")).toBe("meeting");
		expect(slugify("---")).toBe("meeting");
	});
});
