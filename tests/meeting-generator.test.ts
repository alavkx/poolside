import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import {
	MeetingGenerator,
	createGenerator,
	type GeneratorResult,
} from "../src/meeting-generator";
import type {
	RefinedMeeting,
	PRD,
} from "../src/meeting-schemas";

const mockRefinedMeeting: RefinedMeeting = {
	decisions: [
		{
			id: "D1",
			decision: "Use React for the frontend",
			madeBy: "Sarah",
			rationale: "Better ecosystem and team familiarity",
			quote: "Let's go with React for the frontend",
		},
		{
			id: "D2",
			decision: "Target Q1 for dashboard release",
			madeBy: "John",
			quote: "We're targeting Q1 for the dashboard redesign",
		},
	],
	actionItems: [
		{
			id: "A1",
			task: "Create wireframes for dashboard",
			owner: "Mike",
			deadline: "Friday",
			priority: "high",
			quote: "Mike, can you have the wireframes ready by Friday?",
		},
		{
			id: "A2",
			task: "Set up React project scaffolding",
			owner: "Sarah",
			deadline: "Next week",
			priority: "medium",
			quote: "Sarah will set up the initial project structure",
		},
	],
	deliverables: [
		{
			id: "DEL1",
			name: "Dashboard Redesign",
			description: "New analytics dashboard with real-time metrics",
			timeline: "Q1 2026",
			owner: "Frontend Team",
			quote: "We're targeting Q1 for the dashboard redesign",
		},
	],
	meetingSummary:
		"Team decided to use React for the frontend redesign. Dashboard release targeted for Q1 2026. Mike will create wireframes by Friday.",
	attendees: ["Sarah", "Mike", "John"],
	openQuestions: ["What analytics provider should we use?"],
};

const mockRefinedMeetingNoDeliverables: RefinedMeeting = {
	decisions: [
		{
			id: "D1",
			decision: "Cancel the legacy API migration",
			madeBy: "Sarah",
			quote: "We decided to cancel the legacy API migration",
		},
	],
	actionItems: [
		{
			id: "A1",
			task: "Notify stakeholders about decision",
			owner: "John",
			deadline: "EOD",
			priority: "high",
			quote: "John will notify the stakeholders today",
		},
	],
	deliverables: [],
	meetingSummary: "Team decided to cancel the legacy API migration project.",
	attendees: ["Sarah", "John"],
	openQuestions: ["How do we handle existing integrations?"],
};

const mockPRD: PRD = {
	featureName: "Dashboard Redesign",
	overview:
		"New analytics dashboard providing real-time metrics and improved user experience for tracking key performance indicators.",
	requirements: [
		{
			id: "R1",
			description: "Real-time data refresh every 30 seconds",
			priority: "must",
		},
		{
			id: "R2",
			description: "Export data to CSV format",
			priority: "should",
		},
		{
			id: "R3",
			description: "Custom date range selection",
			priority: "must",
		},
	],
	timeline: "Q1 2026",
	dependencies: ["Analytics service API", "User authentication system"],
	openQuestions: ["What analytics provider should we use?"],
};

describe("MeetingGenerator", () => {
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
									text: JSON.stringify(mockPRD),
									annotations: [],
								},
							],
						},
					],
					usage: {
						input_tokens: 300,
						output_tokens: 200,
						total_tokens: 500,
					},
				});
			})
		);
	});

	describe("constructor", () => {
		it("should create generator with default options", () => {
			const generator = new MeetingGenerator("test-api-key");
			const config = generator.getConfig();

			expect(config.provider).toBe("openai");
			expect(config.model).toBe("gpt-5.2");
			expect(config.maxTokens).toBe(4000);
			expect(config.verbose).toBe(false);
		});

		it("should accept custom options", () => {
			const generator = new MeetingGenerator("test-api-key", {
				provider: "openai",
				model: "gpt-5.2-mini",
				maxTokens: 2000,
				verbose: true,
			});
			const config = generator.getConfig();

			expect(config.model).toBe("gpt-5.2-mini");
			expect(config.maxTokens).toBe(2000);
			expect(config.verbose).toBe(true);
		});

		it("should throw error without API key", () => {
			expect(() => new MeetingGenerator("")).toThrow("API key required");
		});
	});

	describe("generateMeetingNotes", () => {
		it("should generate meeting notes from refined data", () => {
			const generator = new MeetingGenerator("test-api-key");

			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			expect(notes.title).toContain("Dashboard Redesign");
			expect(notes.attendees).toEqual(["Sarah", "Mike", "John"]);
			expect(notes.summary).toBe(mockRefinedMeeting.meetingSummary);
			expect(notes.decisions).toHaveLength(2);
			expect(notes.actionItems).toHaveLength(2);
			expect(notes.openQuestions).toEqual(["What analytics provider should we use?"]);
		});

		it("should map decisions correctly", () => {
			const generator = new MeetingGenerator("test-api-key");

			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			expect(notes.decisions[0].id).toBe("D1");
			expect(notes.decisions[0].title).toBe("Use React for the frontend");
			expect(notes.decisions[0].rationale).toBe("Better ecosystem and team familiarity");
			expect(notes.decisions[0].participants).toContain("Sarah");
		});

		it("should map action items correctly", () => {
			const generator = new MeetingGenerator("test-api-key");

			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			expect(notes.actionItems[0].id).toBe("A1");
			expect(notes.actionItems[0].task).toBe("Create wireframes for dashboard");
			expect(notes.actionItems[0].owner).toBe("Mike");
			expect(notes.actionItems[0].dueDate).toBe("Friday");
			expect(notes.actionItems[0].priority).toBe("high");
			expect(notes.actionItems[0].status).toBe("open");
		});

		it("should infer title from first deliverable when present", () => {
			const generator = new MeetingGenerator("test-api-key");

			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			expect(notes.title).toBe("Meeting Notes: Dashboard Redesign");
		});

		it("should infer title from first decision when no deliverables", () => {
			const generator = new MeetingGenerator("test-api-key");

			const notes = generator.generateMeetingNotes(mockRefinedMeetingNoDeliverables);

			expect(notes.title).toContain("Meeting Notes:");
			expect(notes.title).toContain("Cancel the legacy API migration");
		});

		it("should handle missing optional fields", () => {
			const generator = new MeetingGenerator("test-api-key");
			const minimalRefined: RefinedMeeting = {
				decisions: [],
				actionItems: [],
				deliverables: [],
				meetingSummary: "A brief meeting",
				attendees: [],
				openQuestions: [],
			};

			const notes = generator.generateMeetingNotes(minimalRefined);

			expect(notes.title).toBe("Meeting Notes");
			expect(notes.decisions).toHaveLength(0);
			expect(notes.actionItems).toHaveLength(0);
		});

		it("should set TBD for action items without owner", () => {
			const generator = new MeetingGenerator("test-api-key");
			const refinedWithoutOwner: RefinedMeeting = {
				...mockRefinedMeetingNoDeliverables,
				actionItems: [
					{
						id: "A1",
						task: "Investigate issue",
						priority: "medium",
						quote: "Someone should look into this",
					},
				],
			};

			const notes = generator.generateMeetingNotes(refinedWithoutOwner);

			expect(notes.actionItems[0].owner).toBe("TBD");
		});
	});

	describe("generate", () => {
		it("should generate full result with PRD when deliverables exist", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const result = await generator.generate(mockRefinedMeeting);

			expect(result.resources.notes).toBeDefined();
			expect(result.resources.prd).toBeDefined();
			expect(result.prdGenerated).toBe(true);
			expect(result.markdown).toBeDefined();
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
		});

		it("should skip PRD generation when no deliverables", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const result = await generator.generate(mockRefinedMeetingNoDeliverables);

			expect(result.resources.notes).toBeDefined();
			expect(result.resources.prd).toBeUndefined();
			expect(result.prdGenerated).toBe(false);
		});

		it("should skip PRD generation when explicitly disabled", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const result = await generator.generate(mockRefinedMeeting, { generatePrd: false });

			expect(result.resources.notes).toBeDefined();
			expect(result.resources.prd).toBeUndefined();
			expect(result.prdGenerated).toBe(false);
		});

		it("should generate markdown output", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const result = await generator.generate(mockRefinedMeeting);

			expect(result.markdown).toContain("# Meeting Notes:");
			expect(result.markdown).toContain("## Summary");
			expect(result.markdown).toContain("## Decisions");
			expect(result.markdown).toContain("## Action Items");
			expect(result.markdown).toContain("## Open Questions");
		});

		it("should include PRD section in markdown when generated", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const result = await generator.generate(mockRefinedMeeting);

			expect(result.markdown).toContain("# Product Requirements:");
			expect(result.markdown).toContain("## Overview");
			expect(result.markdown).toContain("## Requirements");
		});
	});

	describe("generatePRD", () => {
		it("should generate PRD from deliverables", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const prd = await generator.generatePRD(mockRefinedMeeting);

			expect(prd).toBeDefined();
			expect(prd?.featureName).toBe("Dashboard Redesign");
			expect(prd?.requirements).toHaveLength(3);
		});

		it("should return undefined when no deliverables", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const prd = await generator.generatePRD(mockRefinedMeetingNoDeliverables);

			expect(prd).toBeUndefined();
		});

		it("should convert PRD schema to PRDDocument format", async () => {
			const generator = new MeetingGenerator("test-api-key");

			const prd = await generator.generatePRD(mockRefinedMeeting);

			expect(prd?.requirements[0].requirement).toBe("Real-time data refresh every 30 seconds");
			expect(prd?.requirements[0].priority).toBe("must");
			expect(prd?.requirements[0].status).toBe("open");
			expect(prd?.timeline?.target).toBe("Q1 2026");
		});
	});

	describe("renderMarkdown", () => {
		it("should render meeting notes as markdown", () => {
			const generator = new MeetingGenerator("test-api-key");
			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			const markdown = generator.renderMarkdown({ notes });

			expect(markdown).toContain("# Meeting Notes: Dashboard Redesign");
			expect(markdown).toContain("**Attendees:** Sarah, Mike, John");
			expect(markdown).toContain("## Summary");
			expect(markdown).toContain("Team decided to use React");
		});

		it("should render action items as a table", () => {
			const generator = new MeetingGenerator("test-api-key");
			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			const markdown = generator.renderMarkdown({ notes });

			expect(markdown).toContain("| Owner | Task | Due | Priority |");
			expect(markdown).toContain("| Mike | Create wireframes for dashboard | Friday | high |");
		});

		it("should render open questions as checkboxes", () => {
			const generator = new MeetingGenerator("test-api-key");
			const notes = generator.generateMeetingNotes(mockRefinedMeeting);

			const markdown = generator.renderMarkdown({ notes });

			expect(markdown).toContain("- [ ] What analytics provider should we use?");
		});

		it("should render PRD requirements as a table", async () => {
			const generator = new MeetingGenerator("test-api-key");
			const notes = generator.generateMeetingNotes(mockRefinedMeeting);
			const prd = await generator.generatePRD(mockRefinedMeeting);

			const markdown = generator.renderMarkdown({ notes, prd });

			expect(markdown).toContain("| ID | Requirement | Priority |");
			expect(markdown).toContain("| R1 | Real-time data refresh every 30 seconds | Must |");
		});

		it("should separate notes and PRD with divider", async () => {
			const generator = new MeetingGenerator("test-api-key");
			const notes = generator.generateMeetingNotes(mockRefinedMeeting);
			const prd = await generator.generatePRD(mockRefinedMeeting);

			const markdown = generator.renderMarkdown({ notes, prd });

			expect(markdown).toContain("---");
			expect(markdown.indexOf("Meeting Notes")).toBeLessThan(markdown.indexOf("---"));
			expect(markdown.indexOf("---")).toBeLessThan(markdown.indexOf("Product Requirements"));
		});
	});

	describe("verbose mode", () => {
		it("should run in verbose mode without errors", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const generator = new MeetingGenerator("test-api-key", { verbose: true });

			await generator.generate(mockRefinedMeeting);

			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should log generation progress in verbose mode", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const generator = new MeetingGenerator("test-api-key", { verbose: true });

			await generator.generate(mockRefinedMeeting);

			const calls = consoleSpy.mock.calls.flat().join(" ");
			expect(calls).toContain("Starting resource generation");
			expect(calls).toContain("Deliverables:");
			consoleSpy.mockRestore();
		});
	});

	describe("createGenerator factory", () => {
		it("should create generator via factory function", async () => {
			const generator = await createGenerator({
				provider: "openai",
				model: "gpt-5.2",
			});

			expect(generator).toBeInstanceOf(MeetingGenerator);
			expect(generator.getConfig().provider).toBe("openai");
		});
	});
});
