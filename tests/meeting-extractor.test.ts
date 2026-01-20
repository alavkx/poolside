import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import {
	MeetingExtractor,
	createExtractor,
	type ExtractionResult,
} from "../src/meeting-extractor";
import type { TranscriptChunk } from "../src/meeting-types";
import type { ChunkExtraction } from "../src/meeting-schemas";

const mockExtraction: ChunkExtraction = {
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
	keyPoints: ["Team discussed frontend framework options", "Timeline is aggressive but achievable"],
	summaryForNextChunk: "Team decided on React for frontend. Mike is creating wireframes by Friday. Dashboard redesign targeted for Q1.",
};

function createMockChunk(index: number, content: string): TranscriptChunk {
	return {
		index,
		content,
		startOffset: 0,
		endOffset: content.length,
		speakersPresent: ["Sarah", "Mike", "John"],
		hasOverlap: false,
	};
}

describe("MeetingExtractor", () => {
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
									text: JSON.stringify(mockExtraction),
									annotations: [],
								},
							],
						},
					],
					usage: {
						input_tokens: 100,
						output_tokens: 200,
						total_tokens: 300,
					},
				});
			})
		);
	});

	describe("constructor", () => {
		it("should create extractor with default options", () => {
			const extractor = new MeetingExtractor("test-api-key");
			const config = extractor.getConfig();

			expect(config.provider).toBe("openai");
			expect(config.model).toBe("gpt-5.2");
			expect(config.maxTokens).toBe(4000);
			expect(config.verbose).toBe(false);
		});

		it("should accept custom options", () => {
			const extractor = new MeetingExtractor("test-api-key", {
				provider: "openai",
				model: "gpt-5.2-mini",
				maxTokens: 2000,
				verbose: true,
			});
			const config = extractor.getConfig();

			expect(config.model).toBe("gpt-5.2-mini");
			expect(config.maxTokens).toBe(2000);
			expect(config.verbose).toBe(true);
		});

		it("should throw error without API key", () => {
			expect(() => new MeetingExtractor("")).toThrow("API key required");
		});
	});

	describe("extractFromChunks", () => {
		it("should extract from single chunk", async () => {
			const extractor = new MeetingExtractor("test-api-key");
			const chunks = [
				createMockChunk(0, `Sarah: Let's go with React for the frontend.
Mike: Sounds good. I'll start on the wireframes.
Sarah: Mike, can you have the wireframes ready by Friday?
Mike: Sure, no problem.
John: We're targeting Q1 for the dashboard redesign.`),
			];

			const result = await extractor.extractFromChunks(chunks);

			expect(result.totalChunks).toBe(1);
			expect(result.extractions).toHaveLength(1);
			expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
		});

		it("should extract from multiple chunks with running context", async () => {
			const extractor = new MeetingExtractor("test-api-key");
			const chunks = [
				createMockChunk(0, "Sarah: Let's discuss the frontend framework."),
				createMockChunk(1, "Mike: I've looked into React and Vue."),
				createMockChunk(2, "John: Let's go with React then."),
			];

			const result = await extractor.extractFromChunks(chunks);

			expect(result.totalChunks).toBe(3);
			expect(result.extractions).toHaveLength(3);
		});

		it("should return extraction result structure", async () => {
			const extractor = new MeetingExtractor("test-api-key");
			const chunks = [createMockChunk(0, "Sarah: Test content here.")];

			const result = await extractor.extractFromChunks(chunks);

			expect(result).toHaveProperty("extractions");
			expect(result).toHaveProperty("totalChunks");
			expect(result).toHaveProperty("processingTimeMs");
		});

		it("should populate extraction fields correctly", async () => {
			const extractor = new MeetingExtractor("test-api-key");
			const chunks = [createMockChunk(0, "Sarah: We decided to use React.")];

			const result = await extractor.extractFromChunks(chunks);
			const extraction = result.extractions[0];

			expect(extraction.decisions).toHaveLength(1);
			expect(extraction.decisions[0].decision).toBe("Use React for the frontend");
			expect(extraction.decisions[0].madeBy).toBe("Sarah");
			expect(extraction.decisions[0].quote).toBeDefined();

			expect(extraction.actionItems).toHaveLength(1);
			expect(extraction.actionItems[0].task).toBe("Create wireframes for dashboard");
			expect(extraction.actionItems[0].owner).toBe("Mike");

			expect(extraction.deliverables).toHaveLength(1);
			expect(extraction.deliverables[0].name).toBe("Dashboard Redesign");

			expect(extraction.keyPoints.length).toBeGreaterThan(0);
			expect(extraction.summaryForNextChunk).toBeDefined();
		});
	});

	describe("empty and edge cases", () => {
		it("should handle empty chunks array", async () => {
			const extractor = new MeetingExtractor("test-api-key");

			const result = await extractor.extractFromChunks([]);

			expect(result.totalChunks).toBe(0);
			expect(result.extractions).toHaveLength(0);
		});

		it("should handle chunk with minimal content", async () => {
			const extractor = new MeetingExtractor("test-api-key");
			const chunks = [createMockChunk(0, "John: Hello.")];

			const result = await extractor.extractFromChunks(chunks);

			expect(result.totalChunks).toBe(1);
			expect(result.extractions).toHaveLength(1);
		});
	});

	describe("verbose mode", () => {
		it("should run in verbose mode without errors", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const extractor = new MeetingExtractor("test-api-key", { verbose: true });
			const chunks = [createMockChunk(0, "Sarah: Test content.")];

			await extractor.extractFromChunks(chunks);

			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});

	describe("createExtractor factory", () => {
		it("should create extractor via factory function", async () => {
			const extractor = await createExtractor({
				provider: "openai",
				model: "gpt-5.2",
			});

			expect(extractor).toBeInstanceOf(MeetingExtractor);
			expect(extractor.getConfig().provider).toBe("openai");
		});
	});
});
