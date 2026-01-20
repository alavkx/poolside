import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { TranscriptChunker } from "../src/transcript-chunker";
import { MeetingExtractor } from "../src/meeting-extractor";
import { MeetingRefiner } from "../src/meeting-refiner";
import { MeetingGenerator } from "../src/meeting-generator";
import { MeetingEditor } from "../src/meeting-editor";
import { formatAsMarkdown, formatAsJson } from "../src/meeting-formatters";
import type { ChunkExtraction, RefinedMeeting } from "../src/meeting-schemas";
import type { MeetingResources, PRDDocument, MeetingNotes } from "../src/meeting-types";

const REALISTIC_TRANSCRIPT = `
Meeting: Q1 Dashboard Planning
Date: January 15, 2026

Sarah: Good morning everyone. Let's get started with our Q1 planning session. We have a lot to cover today.

Mike: Thanks Sarah. I've put together some initial thoughts on the dashboard redesign we've been discussing.

Sarah: Great, let's hear it.

Mike: So the main goal is to give users real-time visibility into their metrics. Right now they have to wait for the nightly batch process, which isn't cutting it anymore.

John: I agree. We've had multiple customer complaints about the lag. What's the technical approach?

Mike: I'm proposing we move to a WebSocket-based architecture. This will let us push updates as they happen rather than polling.

Sarah: That sounds like a significant change. What's the timeline looking like?

Mike: If we start next week, I think we can have a beta ready by February 15th. Full release by end of Q1.

Lisa: I have concerns about the backend infrastructure. Our current setup might not handle the connection load from WebSockets.

John: Good point Lisa. We should do a capacity assessment first.

Sarah: Agreed. Lisa, can you lead that assessment? We need it before we commit to the WebSocket approach.

Lisa: Sure, I can have that done by next Friday, January 24th.

Sarah: Perfect. Let's make a decision then. For now, let's assume WebSockets is the direction unless Lisa's assessment shows a blocker.

Mike: Sounds good. I'll start on the frontend components in parallel. The dashboard should have three main sections: real-time metrics, historical trends, and alerts.

John: Should we include export functionality? Customers have been asking for CSV exports.

Sarah: Yes, that's a must-have. Add it to the requirements.

Mike: Got it. I'll also need design support. The current mockups are outdated.

Sarah: Mike, can you work with the design team to get updated wireframes by January 22nd?

Mike: Will do.

Lisa: One more thing - do we need legal review for any data privacy implications of real-time data?

Sarah: That's a good question. I'm not sure. Let's flag that as an open item to investigate.

John: I can reach out to the legal team tomorrow and find out.

Sarah: Thanks John. So to summarize: we're moving forward with the dashboard redesign targeting Q1. Lisa will assess infrastructure by January 24th, Mike will have wireframes by January 22nd, and John will check with legal tomorrow. The key features are real-time metrics via WebSockets, historical trends, alerts, and CSV export.

Mike: One more decision - should this be a separate app or integrated into the existing portal?

Sarah: Let's integrate it. Less friction for users and easier to maintain single auth.

John: Agreed.

Sarah: Great. Any other items before we wrap up?

Lisa: Should we set up weekly syncs to track progress?

Sarah: Good idea. Let's do Tuesdays at 10am starting next week.

Mike: Works for me.

John: Same here.

Sarah: Alright, thanks everyone. Let's make this dashboard happen!
`;

const mockChunkExtraction1: ChunkExtraction = {
	decisions: [
		{
			decision: "Move to WebSocket-based architecture for real-time updates",
			madeBy: "Mike",
			quote: "I'm proposing we move to a WebSocket-based architecture",
		},
	],
	actionItems: [
		{
			task: "Lead infrastructure capacity assessment for WebSocket support",
			owner: "Lisa",
			deadline: "January 24th",
			quote: "Lisa, can you lead that assessment? We need it before we commit",
		},
	],
	deliverables: [
		{
			name: "Real-time Dashboard",
			description: "Dashboard with real-time visibility into metrics using WebSockets",
			timeline: "Q1 2026, beta by February 15th",
			quote: "If we start next week, I think we can have a beta ready by February 15th",
		},
	],
	keyPoints: [
		"Current batch processing causing customer complaints about data lag",
		"WebSocket architecture will push updates in real-time instead of polling",
	],
	summaryForNextChunk:
		"Team is planning a Q1 dashboard redesign with WebSocket architecture. Lisa assessing infrastructure capacity by Jan 24. Beta target is Feb 15.",
};

const mockChunkExtraction2: ChunkExtraction = {
	decisions: [
		{
			decision: "CSV export is a must-have feature",
			madeBy: "Sarah",
			quote: "Yes, that's a must-have. Add it to the requirements",
		},
		{
			decision: "Dashboard will be integrated into existing portal rather than separate app",
			madeBy: "Sarah",
			quote: "Let's integrate it. Less friction for users and easier to maintain single auth",
		},
	],
	actionItems: [
		{
			task: "Get updated wireframes from design team",
			owner: "Mike",
			deadline: "January 22nd",
			quote: "can you work with the design team to get updated wireframes by January 22nd",
		},
		{
			task: "Check with legal team about data privacy implications",
			owner: "John",
			deadline: "Tomorrow",
			quote: "I can reach out to the legal team tomorrow and find out",
		},
	],
	deliverables: [],
	keyPoints: [
		"Dashboard will have three sections: real-time metrics, historical trends, and alerts",
		"Weekly syncs scheduled for Tuesdays at 10am",
	],
	summaryForNextChunk:
		"Dashboard features confirmed: real-time metrics, historical trends, alerts, CSV export. Will integrate into existing portal. Mike getting wireframes by Jan 22, John checking legal.",
};

const mockRefinedMeeting: RefinedMeeting = {
	decisions: [
		{
			id: "D1",
			decision: "Adopt WebSocket-based architecture for real-time dashboard updates",
			madeBy: "Team consensus",
			rationale: "Replace nightly batch process to address customer complaints about data lag",
			quote: "I'm proposing we move to a WebSocket-based architecture. This will let us push updates as they happen",
		},
		{
			id: "D2",
			decision: "CSV export functionality is a must-have requirement",
			madeBy: "Sarah",
			rationale: "Responding to customer feature requests",
			quote: "Yes, that's a must-have. Add it to the requirements",
		},
		{
			id: "D3",
			decision: "Integrate dashboard into existing portal instead of standalone app",
			madeBy: "Sarah",
			rationale: "Reduces user friction and simplifies authentication",
			quote: "Let's integrate it. Less friction for users and easier to maintain single auth",
		},
	],
	actionItems: [
		{
			id: "A1",
			task: "Complete infrastructure capacity assessment for WebSocket support",
			owner: "Lisa",
			deadline: "January 24, 2026",
			priority: "high",
			quote: "Lisa, can you lead that assessment? We need it before we commit to the WebSocket approach",
		},
		{
			id: "A2",
			task: "Create updated wireframes for dashboard with design team",
			owner: "Mike",
			deadline: "January 22, 2026",
			priority: "high",
			quote: "can you work with the design team to get updated wireframes by January 22nd",
		},
		{
			id: "A3",
			task: "Consult legal team regarding data privacy implications of real-time data",
			owner: "John",
			deadline: "January 16, 2026",
			priority: "medium",
			quote: "I can reach out to the legal team tomorrow and find out",
		},
	],
	deliverables: [
		{
			id: "DEL1",
			name: "Real-time Analytics Dashboard",
			description:
				"New dashboard with three main sections: real-time metrics via WebSockets, historical trends, and alerts. Includes CSV export functionality.",
			timeline: "Q1 2026 (Beta: February 15, Full release: End of Q1)",
			owner: "Mike",
			quote: "If we start next week, I think we can have a beta ready by February 15th. Full release by end of Q1",
		},
	],
	meetingSummary:
		"The team planned the Q1 dashboard redesign, deciding to adopt WebSocket architecture for real-time metrics. Key features include historical trends, alerts, and CSV export. The dashboard will integrate into the existing portal. Lisa will assess infrastructure capacity by Jan 24, Mike will deliver wireframes by Jan 22, and John will verify legal requirements.",
	attendees: ["Sarah", "Mike", "John", "Lisa"],
	openQuestions: [
		"Does real-time data feature require legal review for data privacy implications?",
		"Will current backend infrastructure handle WebSocket connection load?",
	],
};

const mockPRD = {
	featureName: "Real-time Analytics Dashboard",
	overview:
		"A new dashboard providing real-time visibility into user metrics, replacing the current batch-based system. The dashboard will feature live data updates via WebSockets, historical trend analysis, customizable alerts, and CSV export functionality.",
	requirements: [
		{ id: "R1", description: "Real-time metrics display with WebSocket updates", priority: "must" as const },
		{ id: "R2", description: "Historical trends visualization", priority: "must" as const },
		{ id: "R3", description: "Configurable alert system", priority: "must" as const },
		{ id: "R4", description: "CSV export for all data views", priority: "must" as const },
		{ id: "R5", description: "Integration with existing portal authentication", priority: "must" as const },
		{ id: "R6", description: "Mobile-responsive design", priority: "should" as const },
	],
	timeline: "Q1 2026 - Beta: February 15, Full Release: March 31",
	dependencies: [
		"Infrastructure capacity assessment (Lisa, due Jan 24)",
		"Legal review of data privacy requirements",
		"Design team wireframe delivery",
	],
	openQuestions: [
		"Data privacy implications for real-time user data",
		"Backend scaling strategy for WebSocket connections",
	],
};

const mockEditedNotes: MeetingNotes = {
	title: "Q1 Dashboard Planning - Real-time Analytics Dashboard",
	date: "January 15, 2026",
	attendees: ["Sarah", "Mike", "John", "Lisa"],
	summary:
		"The team finalized plans for the Q1 dashboard redesign. Key decisions include adopting WebSocket architecture for real-time updates, integrating into the existing portal, and including CSV export as a must-have feature. Three critical action items were assigned with deadlines over the next week.",
	decisions: [
		{
			id: "D1",
			title: "Adopt WebSocket architecture for real-time updates",
			description: "Replace nightly batch process to address customer complaints about data lag",
			rationale: "Customers have complained about data lag from current batch processing",
			participants: ["Mike", "Sarah"],
			relatedActionItems: ["A1"],
		},
		{
			id: "D2",
			title: "Include CSV export as must-have feature",
			description: "Responding to customer feature requests",
			rationale: "Multiple customers have requested this functionality",
			participants: ["Sarah"],
			relatedActionItems: [],
		},
		{
			id: "D3",
			title: "Integrate into existing portal",
			description: "Reduces user friction and simplifies authentication",
			rationale: "Single auth model is easier to maintain",
			participants: ["Sarah", "John"],
			relatedActionItems: [],
		},
	],
	actionItems: [
		{
			id: "A1",
			owner: "Lisa",
			task: "Complete infrastructure capacity assessment for WebSocket support",
			dueDate: "January 24, 2026",
			priority: "high",
			status: "open",
			context: "Needed before committing to WebSocket approach",
		},
		{
			id: "A2",
			owner: "Mike",
			task: "Create updated wireframes with design team",
			dueDate: "January 22, 2026",
			priority: "high",
			status: "open",
			context: "Current mockups are outdated",
		},
		{
			id: "A3",
			owner: "John",
			task: "Consult legal team on data privacy implications",
			dueDate: "January 16, 2026",
			priority: "medium",
			status: "open",
			context: "Verify requirements for real-time data",
		},
	],
	keyDiscussionPoints: [],
	openQuestions: [
		"Does real-time data feature require legal review for data privacy?",
		"Can current infrastructure handle WebSocket connection load?",
	],
};

const mockEditedPRD: PRDDocument = {
	featureName: "Real-time Analytics Dashboard",
	overview:
		"A new dashboard providing real-time visibility into user metrics via WebSockets, featuring historical trends, alerts, and CSV export. Integrates into the existing portal.",
	requirements: [
		{ id: "R1", requirement: "Real-time metrics display with WebSocket updates", priority: "must", status: "open" },
		{ id: "R2", requirement: "Historical trends visualization", priority: "must", status: "open" },
		{ id: "R3", requirement: "Configurable alert system", priority: "must", status: "open" },
		{ id: "R4", requirement: "CSV export for all data views", priority: "must", status: "open" },
		{ id: "R5", requirement: "Integration with existing portal authentication", priority: "must", status: "open" },
		{ id: "R6", requirement: "Mobile-responsive design", priority: "should", status: "open" },
	],
	timeline: { target: "Q1 2026", milestones: ["Beta: February 15", "Full Release: March 31"] },
	dependencies: [
		"Infrastructure capacity assessment completion",
		"Legal review sign-off",
		"Design wireframe approval",
	],
	openQuestions: [
		"Data privacy requirements for real-time user data",
		"Backend scaling approach for WebSocket connections",
	],
};

describe("Meeting Transcript Pipeline E2E", () => {
	let extractionCallCount = 0;

	beforeEach(() => {
		extractionCallCount = 0;
		vi.stubEnv("POOLSIDE_OPENAI_API_KEY", "test-api-key");
		vi.stubEnv("OPENAI_API_KEY", "test-api-key");

		server.use(
			http.post("https://api.openai.com/v1/chat/completions", async ({ request }) => {
				const body = await request.json() as { messages?: Array<{ content?: string }> };
				const systemPrompt = body.messages?.[0]?.content || "";

				if (systemPrompt.includes("expert meeting analyst") && systemPrompt.includes("extract structured information")) {
					extractionCallCount++;
					const mockData = extractionCallCount === 1 ? mockChunkExtraction1 : mockChunkExtraction2;
					return HttpResponse.json({
						id: `chatcmpl-extract-${extractionCallCount}`,
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: `call_extract_${extractionCallCount}`,
											type: "function",
											function: {
												name: "json",
												arguments: JSON.stringify(mockData),
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 500, completion_tokens: 400, total_tokens: 900 },
					});
				}

				if (systemPrompt.includes("consolidating and refining meeting notes")) {
					return HttpResponse.json({
						id: "chatcmpl-refine",
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_refine",
											type: "function",
											function: {
												name: "json",
												arguments: JSON.stringify(mockRefinedMeeting),
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
					});
				}

				if (systemPrompt.includes("product manager creating a concise Product Requirements Document")) {
					return HttpResponse.json({
						id: "chatcmpl-prd",
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_prd",
											type: "function",
											function: {
												name: "json",
												arguments: JSON.stringify(mockPRD),
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 600, completion_tokens: 500, total_tokens: 1100 },
					});
				}

				if (systemPrompt.includes("expert editor specializing in meeting documentation")) {
					return HttpResponse.json({
						id: "chatcmpl-edit",
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_edit",
											type: "function",
											function: {
												name: "json",
												arguments: JSON.stringify({
													notes: mockEditedNotes,
													prd: mockEditedPRD,
													changesApplied: [
														"Standardized date format to 'January 15, 2026'",
														"Added meeting title with feature name for clarity",
														"Linked action items to related decisions",
														"Consolidated duplicate open questions between notes and PRD",
													],
												}),
											},
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 1500, completion_tokens: 1200, total_tokens: 2700 },
					});
				}

				return HttpResponse.json({
					id: "chatcmpl-fallback",
					object: "chat.completion",
					created: Date.now(),
					model: "gpt-5.2",
					choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				});
			})
		);
	});

	it("should process a meeting transcript through the complete pipeline", async () => {
		const chunker = new TranscriptChunker({ chunkSize: 2000, overlapSize: 100 });
		const chunks = chunker.chunk(REALISTIC_TRANSCRIPT);
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(chunks[0].speakersPresent).toContain("Sarah");

		const metadata = chunker.extractMetadata(REALISTIC_TRANSCRIPT);
		expect(metadata.title).toBe("Q1 Dashboard Planning");
		expect(metadata.date).toBe("January 15, 2026");
		expect(metadata.attendees).toContain("Sarah");
		expect(metadata.attendees).toContain("Mike");

		const extractor = new MeetingExtractor("test-api-key", { provider: "openai", model: "gpt-5.2" });
		const extractionResult = await extractor.extractFromChunks(chunks);
		expect(extractionResult.extractions.length).toBe(chunks.length);
		expect(extractionResult.processingTimeMs).toBeGreaterThanOrEqual(0);

		const allDecisions = extractionResult.extractions.flatMap(e => e.decisions);
		const allActionItems = extractionResult.extractions.flatMap(e => e.actionItems);
		const allDeliverables = extractionResult.extractions.flatMap(e => e.deliverables);
		expect(allDecisions.length).toBeGreaterThan(0);
		expect(allActionItems.length).toBeGreaterThan(0);

		const refiner = new MeetingRefiner("test-api-key", { provider: "openai", model: "gpt-5.2" });
		const refinementResult = await refiner.refine(extractionResult.extractions);
		expect(refinementResult.refined.decisions.length).toBeGreaterThan(0);
		expect(refinementResult.refined.actionItems.length).toBeGreaterThan(0);
		expect(refinementResult.refined.attendees.length).toBeGreaterThan(0);
		expect(refinementResult.refined.meetingSummary).toBeTruthy();

		for (const decision of refinementResult.refined.decisions) {
			expect(decision.id).toMatch(/^D\d+$/);
			expect(decision.decision).toBeTruthy();
			expect(decision.quote).toBeTruthy();
		}
		for (const actionItem of refinementResult.refined.actionItems) {
			expect(actionItem.id).toMatch(/^A\d+$/);
			expect(actionItem.task).toBeTruthy();
		}

		const generator = new MeetingGenerator("test-api-key", { provider: "openai", model: "gpt-5.2" });
		const generatorResult = await generator.generate(refinementResult.refined, { generatePrd: true });
		expect(generatorResult.resources.notes).toBeDefined();
		expect(generatorResult.resources.notes.title).toBeTruthy();
		expect(generatorResult.resources.notes.summary).toBeTruthy();
		expect(generatorResult.resources.notes.decisions.length).toBeGreaterThan(0);
		expect(generatorResult.resources.notes.actionItems.length).toBeGreaterThan(0);

		expect(generatorResult.prdGenerated).toBe(true);
		expect(generatorResult.resources.prd).toBeDefined();
		expect(generatorResult.resources.prd?.featureName).toBeTruthy();
		expect(generatorResult.resources.prd?.requirements.length).toBeGreaterThan(0);

		const editor = new MeetingEditor("test-api-key", { provider: "openai", model: "gpt-5.2" });
		const editorResult = await editor.edit(generatorResult.resources);
		expect(editorResult.output.notes).toBeDefined();
		expect(editorResult.output.prd).toBeDefined();
		expect(editorResult.output.markdown).toBeTruthy();
		expect(editorResult.output.json).toBeTruthy();
		expect(editorResult.changesApplied.length).toBeGreaterThan(0);

		expect(editorResult.output.notes.title).toContain("Dashboard");
		expect(editorResult.output.notes.attendees).toContain("Lisa");
		expect(editorResult.output.prd?.featureName).toContain("Dashboard");

		const markdown = formatAsMarkdown(editorResult.output);
		expect(markdown).toContain("# ");
		expect(markdown).toContain("## Summary");
		expect(markdown).toContain("## Decisions");
		expect(markdown).toContain("## Action Items");
		expect(markdown).toContain("| Owner | Task |");
		expect(markdown).toContain("Product Requirements:");
		expect(markdown).toContain("## Requirements");

		const json = formatAsJson(editorResult.output);
		const parsed = JSON.parse(json);
		expect(parsed.notes).toBeDefined();
		expect(parsed.notes.decisions).toBeInstanceOf(Array);
		expect(parsed.notes.actionItems).toBeInstanceOf(Array);
		expect(parsed.prd).toBeDefined();
		expect(parsed.prd.requirements).toBeInstanceOf(Array);
	});

	it("should handle transcript without deliverables (no PRD generation)", async () => {
		const simpleTranscript = `
Sarah: Let's discuss the bug fixes for this sprint.

Mike: I found the issue with the login timeout. It's a race condition.

Sarah: Great find. Can you fix it by Friday?

Mike: Yes, I'll have a PR up by Thursday.

Sarah: Perfect. Let's also update the documentation.

John: I can handle the docs update by end of week.

Sarah: Thanks everyone. Let's sync again Monday.
`;

		const mockSimpleExtraction: ChunkExtraction = {
			decisions: [
				{
					decision: "Fix login timeout bug caused by race condition",
					madeBy: "Sarah",
					quote: "Great find. Can you fix it by Friday?",
				},
			],
			actionItems: [
				{
					task: "Fix login timeout race condition",
					owner: "Mike",
					deadline: "Thursday",
					quote: "I'll have a PR up by Thursday",
				},
				{
					task: "Update documentation",
					owner: "John",
					deadline: "End of week",
					quote: "I can handle the docs update by end of week",
				},
			],
			deliverables: [],
			keyPoints: ["Login timeout caused by race condition"],
			summaryForNextChunk: "Team addressing login bug fix and documentation update.",
		};

		const mockSimpleRefined: RefinedMeeting = {
			decisions: [
				{
					id: "D1",
					decision: "Fix login timeout bug caused by race condition",
					madeBy: "Sarah",
					rationale: "Bug identified, needs resolution",
					quote: "Great find. Can you fix it by Friday?",
				},
			],
			actionItems: [
				{
					id: "A1",
					task: "Fix login timeout race condition",
					owner: "Mike",
					deadline: "Thursday",
					priority: "high",
					quote: "I'll have a PR up by Thursday",
				},
				{
					id: "A2",
					task: "Update documentation",
					owner: "John",
					deadline: "End of week",
					priority: "medium",
					quote: "I can handle the docs update by end of week",
				},
			],
			deliverables: [],
			meetingSummary: "Sprint sync focused on login bug fix and documentation updates.",
			attendees: ["Sarah", "Mike", "John"],
			openQuestions: [],
		};

		server.use(
			http.post("https://api.openai.com/v1/chat/completions", async ({ request }) => {
				const body = await request.json() as { messages?: Array<{ content?: string }> };
				const systemPrompt = body.messages?.[0]?.content || "";

				if (systemPrompt.includes("extract structured information")) {
					return HttpResponse.json({
						id: "chatcmpl-simple-extract",
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_simple_extract",
											type: "function",
											function: { name: "json", arguments: JSON.stringify(mockSimpleExtraction) },
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
					});
				}

				if (systemPrompt.includes("consolidating and refining")) {
					return HttpResponse.json({
						id: "chatcmpl-simple-refine",
						object: "chat.completion",
						created: Date.now(),
						model: "gpt-5.2",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_simple_refine",
											type: "function",
											function: { name: "json", arguments: JSON.stringify(mockSimpleRefined) },
										},
									],
								},
								finish_reason: "tool_calls",
							},
						],
						usage: { prompt_tokens: 400, completion_tokens: 300, total_tokens: 700 },
					});
				}

				return HttpResponse.json({
					id: "chatcmpl-fallback",
					choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
				});
			})
		);

		const chunker = new TranscriptChunker();
		const chunks = chunker.chunk(simpleTranscript);

		const extractor = new MeetingExtractor("test-api-key", { provider: "openai" });
		const extractionResult = await extractor.extractFromChunks(chunks);

		const refiner = new MeetingRefiner("test-api-key", { provider: "openai" });
		const refinementResult = await refiner.refine(extractionResult.extractions);
		expect(refinementResult.refined.deliverables).toHaveLength(0);

		const generator = new MeetingGenerator("test-api-key", { provider: "openai" });
		const generatorResult = await generator.generate(refinementResult.refined, { generatePrd: true });

		expect(generatorResult.prdGenerated).toBe(false);
		expect(generatorResult.resources.prd).toBeUndefined();
		expect(generatorResult.resources.notes.decisions).toHaveLength(1);
		expect(generatorResult.resources.notes.actionItems).toHaveLength(2);
	});

	it("should preserve quote anchoring through the pipeline for verification", async () => {
		const chunker = new TranscriptChunker({ chunkSize: 2000 });
		const chunks = chunker.chunk(REALISTIC_TRANSCRIPT);

		const extractor = new MeetingExtractor("test-api-key", { provider: "openai" });
		const extractionResult = await extractor.extractFromChunks(chunks);

		for (const extraction of extractionResult.extractions) {
			for (const decision of extraction.decisions) {
				expect(decision.quote).toBeTruthy();
				expect(typeof decision.quote).toBe("string");
				expect(decision.quote.length).toBeGreaterThan(5);
			}
			for (const actionItem of extraction.actionItems) {
				expect(actionItem.quote).toBeTruthy();
				expect(typeof actionItem.quote).toBe("string");
			}
		}

		const refiner = new MeetingRefiner("test-api-key", { provider: "openai" });
		const refinementResult = await refiner.refine(extractionResult.extractions);

		for (const decision of refinementResult.refined.decisions) {
			expect(decision.quote).toBeTruthy();
		}
	});

	it("should correctly accumulate running context across chunks", async () => {
		const longTranscript = REALISTIC_TRANSCRIPT + "\n\n" + REALISTIC_TRANSCRIPT.replace(/Sarah/g, "Emma") + "\n\n" + REALISTIC_TRANSCRIPT.replace(/Mike/g, "Alex");

		const chunker = new TranscriptChunker({ chunkSize: 800, overlapSize: 50 });
		const chunks = chunker.chunk(longTranscript);
		expect(chunks.length).toBeGreaterThan(1);

		const extractor = new MeetingExtractor("test-api-key", { provider: "openai" });
		const extractionResult = await extractor.extractFromChunks(chunks);

		expect(extractionResult.extractions.length).toBe(chunks.length);

		for (const extraction of extractionResult.extractions) {
			expect(extraction.summaryForNextChunk).toBeTruthy();
			expect(extraction.summaryForNextChunk.length).toBeGreaterThan(10);
		}
	});

	it("should generate valid markdown output structure", async () => {
		const resources: MeetingResources = {
			notes: mockEditedNotes,
			prd: mockEditedPRD,
		};

		const markdown = formatAsMarkdown(resources);

		expect(markdown).toMatch(/^# /m);
		expect(markdown).toContain("## Summary");
		expect(markdown).toContain("## Decisions");
		expect(markdown).toContain("## Action Items");
		expect(markdown).toContain("| Owner | Task | Due | Priority |");
		expect(markdown).toContain("|-------|------|-----|----------|");
		expect(markdown).toContain("## Open Questions");
		expect(markdown).toContain("- [ ]");

		expect(markdown).toContain("# Product Requirements:");
		expect(markdown).toContain("## Overview");
		expect(markdown).toContain("## Requirements");
		expect(markdown).toContain("| ID | Requirement | Priority |");
		expect(markdown).toContain("## Timeline");
		expect(markdown).toContain("## Dependencies");
	});

	it("should generate valid JSON output that can be parsed", async () => {
		const resources: MeetingResources = {
			notes: mockEditedNotes,
			prd: mockEditedPRD,
		};

		const json = formatAsJson(resources);
		const parsed = JSON.parse(json);

		expect(parsed).toHaveProperty("notes");
		expect(parsed).toHaveProperty("prd");

		expect(parsed.notes).toHaveProperty("title");
		expect(parsed.notes).toHaveProperty("attendees");
		expect(parsed.notes).toHaveProperty("summary");
		expect(parsed.notes).toHaveProperty("decisions");
		expect(parsed.notes).toHaveProperty("actionItems");

		expect(Array.isArray(parsed.notes.decisions)).toBe(true);
		expect(Array.isArray(parsed.notes.actionItems)).toBe(true);
		expect(Array.isArray(parsed.notes.attendees)).toBe(true);

		expect(parsed.prd).toHaveProperty("featureName");
		expect(parsed.prd).toHaveProperty("requirements");
		expect(Array.isArray(parsed.prd.requirements)).toBe(true);
	});

	it("should handle empty extractions gracefully in refiner", async () => {
		const refiner = new MeetingRefiner("test-api-key", { provider: "openai" });
		const result = await refiner.refine([]);

		expect(result.refined.decisions).toHaveLength(0);
		expect(result.refined.actionItems).toHaveLength(0);
		expect(result.refined.deliverables).toHaveLength(0);
		expect(result.refined.meetingSummary).toBeTruthy();
		expect(result.inputExtractionCount).toBe(0);
	});
});
