import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import {
	MeetingEditor,
	createEditor,
	type EditorResult,
} from "../src/meeting-editor";
import type { MeetingNotes, PRDDocument, MeetingResources } from "../src/meeting-types";

const mockMeetingNotes: MeetingNotes = {
	title: "Meeting Notes: Dashboard Redesign",
	date: "January 15, 2026",
	attendees: ["Sarah", "Mike", "John"],
	summary:
		"Team decided to use React for the frontend redesign. Dashboard release targeted for Q1 2026.",
	decisions: [
		{
			id: "D1",
			title: "Use React for the frontend",
			description: "Better ecosystem and team familiarity",
			rationale: "Better ecosystem and team familiarity",
			participants: ["Sarah"],
			relatedActionItems: ["A2"],
		},
		{
			id: "D2",
			title: "Target Q1 for dashboard release",
			description: "Aggressive but achievable timeline",
			participants: ["John"],
			relatedActionItems: [],
		},
	],
	actionItems: [
		{
			id: "A1",
			owner: "Mike",
			task: "Create wireframes for dashboard",
			dueDate: "Friday",
			priority: "high",
			status: "open",
			context: "Mike, can you have the wireframes ready by Friday?",
		},
		{
			id: "A2",
			owner: "Sarah",
			task: "Set up React project scaffolding",
			dueDate: "Next week",
			priority: "medium",
			status: "open",
		},
	],
	keyDiscussionPoints: [
		{
			topic: "Frontend Framework",
			summary: "Team evaluated React, Vue, and Svelte before deciding on React.",
		},
	],
	openQuestions: ["What analytics provider should we use?"],
};

const mockPRD: PRDDocument = {
	featureName: "Dashboard Redesign",
	overview: "New analytics dashboard with real-time metrics and improved UX.",
	requirements: [
		{
			id: "R1",
			requirement: "Real-time data refresh every 30 seconds",
			priority: "must",
			status: "open",
		},
		{
			id: "R2",
			requirement: "Export to CSV functionality",
			priority: "should",
			status: "open",
		},
	],
	timeline: {
		target: "Q1 2026",
		milestones: ["Wireframes by Jan 20", "MVP by Feb 15"],
	},
	dependencies: ["Analytics API", "Design system update"],
	openQuestions: ["Data retention policy?"],
};

const mockEditedResponse = {
	notes: {
		title: "Dashboard Redesign Planning Meeting",
		date: "January 15, 2026",
		attendees: ["Sarah Chen", "Mike Johnson", "John Smith"],
		summary:
			"The team decided to use React for the frontend dashboard redesign, targeting Q1 2026 for release. Key next steps include wireframe creation and project scaffolding.",
		decisions: [
			{
				id: "D1",
				title: "Adopt React as the frontend framework",
				description: "Selected for its mature ecosystem and team expertise",
				rationale: "Better ecosystem and team familiarity with React",
				participants: ["Sarah Chen"],
				relatedActionItems: ["A2"],
			},
			{
				id: "D2",
				title: "Target Q1 2026 for dashboard release",
				description: "Aggressive but achievable timeline agreed upon",
				participants: ["John Smith"],
				relatedActionItems: [],
			},
		],
		actionItems: [
			{
				id: "A1",
				owner: "Mike Johnson",
				task: "Create initial wireframes for the new dashboard layout",
				dueDate: "January 17, 2026",
				priority: "high" as const,
				status: "open" as const,
				context: "First milestone before development begins",
			},
			{
				id: "A2",
				owner: "Sarah Chen",
				task: "Set up React project with TypeScript and build tooling",
				dueDate: "January 24, 2026",
				priority: "medium" as const,
				status: "open" as const,
			},
		],
		keyDiscussionPoints: [
			{
				topic: "Frontend Framework Selection",
				summary:
					"Team evaluated React, Vue, and Svelte. React was chosen due to ecosystem maturity and existing team expertise.",
			},
		],
		openQuestions: ["Which analytics provider should be integrated?"],
	},
	prd: {
		featureName: "Dashboard Redesign",
		overview:
			"A redesigned analytics dashboard providing real-time metrics, improved data visualization, and enhanced user experience.",
		requirements: [
			{
				id: "R1",
				requirement: "Implement real-time data refresh with 30-second intervals",
				priority: "must" as const,
				status: "open" as const,
			},
			{
				id: "R2",
				requirement: "Add CSV export functionality for all dashboard data",
				priority: "should" as const,
				status: "open" as const,
			},
		],
		timeline: {
			target: "Q1 2026",
			milestones: ["Wireframes complete by January 20", "MVP ready by February 15"],
		},
		dependencies: ["Analytics API integration", "Design system v2 update"],
		openQuestions: ["What is the data retention policy for dashboard metrics?"],
	},
	changesApplied: [
		"Standardized attendee names to full names",
		"Clarified action item tasks to be more specific",
		"Converted relative dates to absolute dates where possible",
		"Improved summary to be more actionable",
		"Aligned open questions between notes and PRD to avoid duplication",
	],
};

function createMockResources(
	notesOverrides: Partial<MeetingNotes> = {},
	prd?: PRDDocument
): MeetingResources {
	return {
		notes: { ...mockMeetingNotes, ...notesOverrides },
		prd,
	};
}

describe("MeetingEditor", () => {
	beforeEach(() => {
		vi.stubEnv("POOLSIDE_OPENAI_API_KEY", "test-api-key");
		vi.stubEnv("OPENAI_API_KEY", "test-api-key");

		server.use(
			http.post("https://api.openai.com/v1/responses", () => {
				return HttpResponse.json({
					id: "resp-test",
					object: "response",
					created_at: Date.now(),
					status: "completed",
					output: [
						{
							type: "message",
							id: "msg-test",
							status: "completed",
							role: "assistant",
							content: [
								{
									type: "output_text",
									text: JSON.stringify(mockEditedResponse),
									annotations: [],
								},
							],
						},
					],
					usage: {
						input_tokens: 1000,
						output_tokens: 800,
						total_tokens: 1800,
					},
				});
			})
		);
	});

	describe("constructor", () => {
		it("should create editor with default options", () => {
			const editor = new MeetingEditor("test-api-key");
			const config = editor.getConfig();

			expect(config.provider).toBe("openai");
			expect(config.model).toBe("gpt-5.2");
			expect(config.maxTokens).toBe(8000);
			expect(config.verbose).toBe(false);
		});

		it("should accept custom options", () => {
			const editor = new MeetingEditor("test-api-key", {
				provider: "openai",
				model: "gpt-5.2-mini",
				maxTokens: 4000,
				verbose: true,
			});
			const config = editor.getConfig();

			expect(config.model).toBe("gpt-5.2-mini");
			expect(config.maxTokens).toBe(4000);
			expect(config.verbose).toBe(true);
		});

		it("should throw error without API key", () => {
			expect(() => new MeetingEditor("")).toThrow("API key required");
		});
	});

	describe("edit", () => {
		it("should edit meeting notes without PRD", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const result = await editor.edit(resources);

			expect(result.output).toBeDefined();
			expect(result.output.notes).toBeDefined();
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
		});

		it("should edit meeting notes with PRD", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const result = await editor.edit(resources);

			expect(result.output.notes).toBeDefined();
			expect(result.output.prd).toBeDefined();
		});

		it("should return changes applied list", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const result = await editor.edit(resources);

			expect(result.changesApplied).toBeDefined();
			expect(Array.isArray(result.changesApplied)).toBe(true);
			expect(result.changesApplied.length).toBeGreaterThan(0);
		});

		it("should generate markdown output", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const result = await editor.edit(resources);

			expect(result.output.markdown).toBeDefined();
			expect(result.output.markdown).toContain("# ");
			expect(result.output.markdown).toContain("## Summary");
		});

		it("should generate JSON output", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const result = await editor.edit(resources);

			expect(result.output.json).toBeDefined();
			const parsed = JSON.parse(result.output.json);
			expect(parsed.notes).toBeDefined();
		});

		it("should polish attendee names", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const result = await editor.edit(resources);

			expect(result.output.notes.attendees).toContain("Sarah Chen");
			expect(result.output.notes.attendees).toContain("Mike Johnson");
		});

		it("should improve action item clarity", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const result = await editor.edit(resources);

			const actionItem = result.output.notes.actionItems[0];
			expect(actionItem.task).toContain("wireframes");
			expect(actionItem.owner).toBe("Mike Johnson");
		});
	});

	describe("renderMarkdown", () => {
		it("should render notes as markdown", () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const markdown = editor.renderMarkdown(resources);

			expect(markdown).toContain("# Meeting Notes: Dashboard Redesign");
			expect(markdown).toContain("**Attendees:**");
			expect(markdown).toContain("## Summary");
			expect(markdown).toContain("## Decisions");
			expect(markdown).toContain("## Action Items");
		});

		it("should include action items table", () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const markdown = editor.renderMarkdown(resources);

			expect(markdown).toContain("| Owner | Task | Due | Priority |");
			expect(markdown).toContain("| Mike |");
		});

		it("should include open questions with checkboxes", () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources();

			const markdown = editor.renderMarkdown(resources);

			expect(markdown).toContain("## Open Questions");
			expect(markdown).toContain("- [ ]");
		});

		it("should render PRD when present", () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const markdown = editor.renderMarkdown(resources);

			expect(markdown).toContain("# Product Requirements: Dashboard Redesign");
			expect(markdown).toContain("## Overview");
			expect(markdown).toContain("## Requirements");
			expect(markdown).toContain("| ID | Requirement | Priority |");
		});

		it("should include separator between notes and PRD", () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({}, mockPRD);

			const markdown = editor.renderMarkdown(resources);

			expect(markdown).toContain("---");
		});
	});

	describe("edge cases", () => {
		it("should handle notes with no decisions", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({ decisions: [] });

			const result = await editor.edit(resources);

			expect(result.output).toBeDefined();
		});

		it("should handle notes with no action items", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({ actionItems: [] });

			const result = await editor.edit(resources);

			expect(result.output).toBeDefined();
		});

		it("should handle notes with empty open questions", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({ openQuestions: [] });

			const result = await editor.edit(resources);

			expect(result.output).toBeDefined();
		});

		it("should handle empty key discussion points", async () => {
			const editor = new MeetingEditor("test-api-key");
			const resources = createMockResources({ keyDiscussionPoints: [] });

			const result = await editor.edit(resources);

			expect(result.output).toBeDefined();
		});
	});

	describe("verbose mode", () => {
		it("should run in verbose mode without errors", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const editor = new MeetingEditor("test-api-key", { verbose: true });
			const resources = createMockResources();

			await editor.edit(resources);

			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should log editing progress in verbose mode", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const editor = new MeetingEditor("test-api-key", { verbose: true });
			const resources = createMockResources({}, mockPRD);

			await editor.edit(resources);

			const calls = consoleSpy.mock.calls.flat().join(" ");
			expect(calls).toContain("editing pass");
			expect(calls).toContain("PRD present");
			consoleSpy.mockRestore();
		});

		it("should log changes applied in verbose mode", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const editor = new MeetingEditor("test-api-key", { verbose: true });
			const resources = createMockResources({}, mockPRD);

			await editor.edit(resources);

			const calls = consoleSpy.mock.calls.flat().join(" ");
			expect(calls).toContain("Changes applied");
			consoleSpy.mockRestore();
		});
	});

	describe("createEditor factory", () => {
		it("should create editor via factory function", async () => {
			const editor = await createEditor({
				provider: "openai",
				model: "gpt-5.2",
			});

			expect(editor).toBeInstanceOf(MeetingEditor);
			expect(editor.getConfig().provider).toBe("openai");
		});
	});
});
