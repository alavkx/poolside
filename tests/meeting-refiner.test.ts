import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import {
	MeetingRefiner,
	createRefiner,
	type RefinementResult,
} from "../src/meeting-refiner";
import type { ChunkExtraction, RefinedMeeting } from "../src/meeting-schemas";

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
			rationale: null,
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

const mockExtractions: ChunkExtraction[] = [
	{
		decisions: [
			{
				decision: "Use React for the frontend",
				madeBy: "Sarah",
				quote: "Let's go with React for the frontend",
			},
		],
		actionItems: [
			{
				task: "Create wireframes for dashboard",
				owner: "Mike",
				deadline: "Friday",
				quote: "Mike, can you have the wireframes ready by Friday?",
			},
		],
		deliverables: [
			{
				name: "Dashboard Redesign",
				description: "New analytics dashboard with real-time metrics",
				timeline: "Q1 2026",
				quote: "We're targeting Q1 for the dashboard redesign",
			},
		],
		keyPoints: ["Team discussed frontend framework options"],
		summaryForNextChunk:
			"Team decided on React for frontend. Mike is creating wireframes by Friday.",
	},
	{
		decisions: [
			{
				decision: "Target Q1 for dashboard release",
				madeBy: "John",
				quote: "We're targeting Q1 for the dashboard redesign",
			},
		],
		actionItems: [
			{
				task: "Set up React project scaffolding",
				owner: "Sarah",
				deadline: "Next week",
				quote: "Sarah will set up the initial project structure",
			},
		],
		deliverables: [],
		keyPoints: ["Timeline is aggressive but achievable"],
		summaryForNextChunk:
			"Dashboard targeted for Q1. Sarah will set up project structure.",
	},
];

function createMockExtraction(overrides: Partial<ChunkExtraction> = {}): ChunkExtraction {
	return {
		decisions: [],
		actionItems: [],
		deliverables: [],
		keyPoints: [],
		summaryForNextChunk: "Test summary",
		...overrides,
	};
}

const mockRefinedMeetingWithNulls: RefinedMeeting = {
	decisions: [
		{
			id: "D1",
			decision: "Use React for the frontend",
			madeBy: null,
			rationale: null,
			quote: "Let's go with React for the frontend",
		},
	],
	actionItems: [
		{
			id: "A1",
			task: "Create wireframes for dashboard",
			owner: null,
			deadline: null,
			priority: null,
			quote: "Someone should create wireframes",
		},
	],
	deliverables: [
		{
			id: "DEL1",
			name: "Dashboard Redesign",
			description: "New analytics dashboard with real-time metrics",
			timeline: null,
			owner: null,
			quote: "We need a dashboard redesign",
		},
	],
	meetingSummary: "Team decided to use React.",
	attendees: ["Sarah"],
	openQuestions: [],
};

describe("MeetingRefiner", () => {
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
									text: JSON.stringify(mockRefinedMeeting),
									annotations: [],
								},
							],
						},
					],
					usage: {
						input_tokens: 500,
						output_tokens: 400,
						total_tokens: 900,
					},
				});
			})
		);
	});

	describe("constructor", () => {
		it("should create refiner with default options", () => {
			const refiner = new MeetingRefiner("test-api-key");
			const config = refiner.getConfig();

			expect(config.provider).toBe("openai");
			expect(config.model).toBe("gpt-5.2");
			expect(config.maxTokens).toBe(8000);
			expect(config.verbose).toBe(false);
		});

		it("should accept custom options", () => {
			const refiner = new MeetingRefiner("test-api-key", {
				provider: "openai",
				model: "gpt-5.2-mini",
				maxTokens: 4000,
				verbose: true,
			});
			const config = refiner.getConfig();

			expect(config.model).toBe("gpt-5.2-mini");
			expect(config.maxTokens).toBe(4000);
			expect(config.verbose).toBe(true);
		});

		it("should throw error without API key", () => {
			expect(() => new MeetingRefiner("")).toThrow("API key required");
		});
	});

	describe("refine", () => {
		it("should refine multiple extractions into single result", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.inputExtractionCount).toBe(2);
			expect(result.refined).toBeDefined();
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
		});

		it("should return refined meeting structure with all fields", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined).toHaveProperty("decisions");
			expect(result.refined).toHaveProperty("actionItems");
			expect(result.refined).toHaveProperty("deliverables");
			expect(result.refined).toHaveProperty("meetingSummary");
			expect(result.refined).toHaveProperty("attendees");
			expect(result.refined).toHaveProperty("openQuestions");
		});

		it("should consolidate decisions correctly", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined.decisions).toHaveLength(2);
			expect(result.refined.decisions[0].id).toBe("D1");
			expect(result.refined.decisions[0].decision).toBe("Use React for the frontend");
			expect(result.refined.decisions[0].madeBy).toBe("Sarah");
			expect(result.refined.decisions[0].quote).toBeDefined();
		});

		it("should consolidate action items correctly", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined.actionItems).toHaveLength(2);
			expect(result.refined.actionItems[0].id).toBe("A1");
			expect(result.refined.actionItems[0].task).toBe("Create wireframes for dashboard");
			expect(result.refined.actionItems[0].owner).toBe("Mike");
			expect(result.refined.actionItems[0].priority).toBe("high");
		});

		it("should consolidate deliverables correctly", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined.deliverables).toHaveLength(1);
			expect(result.refined.deliverables[0].id).toBe("DEL1");
			expect(result.refined.deliverables[0].name).toBe("Dashboard Redesign");
		});

		it("should extract attendees", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined.attendees).toEqual(["Sarah", "Mike", "John"]);
		});

		it("should generate meeting summary", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine(mockExtractions);

			expect(result.refined.meetingSummary).toBeDefined();
			expect(result.refined.meetingSummary.length).toBeGreaterThan(0);
		});
	});

	describe("empty and edge cases", () => {
		it("should handle empty extractions array", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine([]);

			expect(result.inputExtractionCount).toBe(0);
			expect(result.refined.decisions).toHaveLength(0);
			expect(result.refined.actionItems).toHaveLength(0);
			expect(result.refined.deliverables).toHaveLength(0);
			expect(result.refined.meetingSummary).toBeDefined();
		});

		it("should handle single extraction", async () => {
			const refiner = new MeetingRefiner("test-api-key");

			const result = await refiner.refine([mockExtractions[0]]);

			expect(result.inputExtractionCount).toBe(1);
			expect(result.refined).toBeDefined();
		});

		it("should handle extractions with no decisions", async () => {
			const refiner = new MeetingRefiner("test-api-key");
			const extractionsNoDecisions = [
				createMockExtraction({
					actionItems: [
						{
							task: "Review code",
							owner: "Alice",
							quote: "Alice will review the code",
						},
					],
				}),
			];

			const result = await refiner.refine(extractionsNoDecisions);

			expect(result.refined).toBeDefined();
		});

		it("should handle extractions with no action items", async () => {
			const refiner = new MeetingRefiner("test-api-key");
			const extractionsNoActions = [
				createMockExtraction({
					decisions: [
						{
							decision: "Proceed with plan A",
							quote: "We'll go with plan A",
						},
					],
				}),
			];

			const result = await refiner.refine(extractionsNoActions);

			expect(result.refined).toBeDefined();
		});
	});

	describe("verbose mode", () => {
		it("should run in verbose mode without errors", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const refiner = new MeetingRefiner("test-api-key", { verbose: true });

			await refiner.refine(mockExtractions);

			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should log extraction stats in verbose mode", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const refiner = new MeetingRefiner("test-api-key", { verbose: true });

			await refiner.refine(mockExtractions);

			const calls = consoleSpy.mock.calls.flat().join(" ");
			expect(calls).toContain("Raw decisions");
			expect(calls).toContain("Raw action items");
			consoleSpy.mockRestore();
		});
	});

	describe("createRefiner factory", () => {
		it("should create refiner via factory function", async () => {
			const refiner = await createRefiner({
				provider: "openai",
				model: "gpt-5.2",
			});

			expect(refiner).toBeInstanceOf(MeetingRefiner);
			expect(refiner.getConfig().provider).toBe("openai");
		});
	});
});
