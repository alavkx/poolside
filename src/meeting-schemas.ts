import { z } from "zod";

export const ExtractedDecisionSchema = z.object({
	decision: z.string().describe("What was decided"),
	madeBy: z.string().nullable().describe("Who made/announced the decision"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const ExtractedActionItemSchema = z.object({
	task: z.string().describe("What needs to be done"),
	owner: z.string().nullable().describe("Who is responsible"),
	deadline: z.string().nullable().describe("When it's due"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const ExtractedDeliverableSchema = z.object({
	name: z.string().describe("Feature or deliverable name"),
	description: z.string().describe("What it is"),
	timeline: z.string().nullable().describe("Rough timeline mentioned"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const ChunkExtractionSchema = z.object({
	decisions: z
		.array(ExtractedDecisionSchema)
		.describe("Decisions made in this section of the meeting"),
	actionItems: z
		.array(ExtractedActionItemSchema)
		.describe("Action items assigned in this section"),
	deliverables: z
		.array(ExtractedDeliverableSchema)
		.describe("Features or deliverables discussed in this section"),
	keyPoints: z
		.array(z.string())
		.describe("Important discussion points worth noting"),
	summaryForNextChunk: z
		.string()
		.describe(
			"2-3 sentence summary of context to pass to next chunk for continuity",
		),
});

export const RefinedDecisionSchema = z.object({
	id: z.string().describe("Unique identifier for this decision"),
	decision: z.string().describe("Clear statement of what was decided"),
	madeBy: z.string().nullable().describe("Who made or announced the decision"),
	rationale: z.string().nullable().describe("Why this decision was made"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const RefinedActionItemSchema = z.object({
	id: z.string().describe("Unique identifier for this action item"),
	task: z.string().describe("Clear description of what needs to be done"),
	owner: z.string().nullable().describe("Person responsible for this task"),
	deadline: z.string().nullable().describe("When this is due"),
	priority: z
		.enum(["high", "medium", "low"])
		.nullable()
		.describe("Priority level based on discussion context"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const RefinedDeliverableSchema = z.object({
	id: z.string().describe("Unique identifier for this deliverable"),
	name: z.string().describe("Name of the feature or deliverable"),
	description: z.string().describe("What this deliverable is and does"),
	timeline: z.string().nullable().describe("Target timeline if mentioned"),
	owner: z.string().nullable().describe("Person or team responsible"),
	quote: z.string().describe("Supporting quote from transcript"),
});

export const RefinedMeetingSchema = z.object({
	decisions: z
		.array(RefinedDecisionSchema)
		.describe("Consolidated and deduplicated decisions"),
	actionItems: z
		.array(RefinedActionItemSchema)
		.describe("Consolidated and deduplicated action items"),
	deliverables: z
		.array(RefinedDeliverableSchema)
		.describe("Consolidated and deduplicated deliverables"),
	meetingSummary: z
		.string()
		.describe("Executive summary of the meeting in 2-4 sentences"),
	attendees: z
		.array(z.string())
		.describe("List of meeting participants identified from transcript"),
	openQuestions: z
		.array(z.string())
		.describe("Unresolved questions that need follow-up"),
});

export const PRDRequirementSchema = z.object({
	id: z.string().describe("Requirement identifier (e.g., R1, R2)"),
	description: z.string().describe("Clear description of the requirement"),
	priority: z
		.enum(["must", "should", "could"])
		.describe("MoSCoW priority level"),
});

export const PRDSchema = z.object({
	featureName: z.string().describe("Name of the feature being specified"),
	overview: z
		.string()
		.describe("High-level description of the feature and its purpose"),
	requirements: z
		.array(PRDRequirementSchema)
		.describe("List of functional requirements"),
	timeline: z.string().nullable().describe("Target delivery timeline"),
	dependencies: z
		.array(z.string())
		.describe("External dependencies or blockers"),
	openQuestions: z
		.array(z.string())
		.describe("Questions that need answers before implementation"),
});

export const EditedMeetingNotesSchema = z.object({
	title: z.string().describe("Meeting title"),
	date: z.string().nullable().describe("Meeting date if mentioned"),
	attendees: z.array(z.string()).describe("List of attendees"),
	summary: z.string().describe("Polished executive summary"),
	decisions: z.array(RefinedDecisionSchema).describe("Polished decisions list"),
	actionItems: z
		.array(RefinedActionItemSchema)
		.describe("Polished action items"),
	openQuestions: z.array(z.string()).describe("Open questions for follow-up"),
});

export const FinalOutputSchema = z.object({
	notes: EditedMeetingNotesSchema.describe("Polished meeting notes"),
	prd: PRDSchema.nullable().describe(
		"PRD document if deliverables were discussed",
	),
});

export type ExtractedDecision = z.infer<typeof ExtractedDecisionSchema>;
export type ExtractedActionItem = z.infer<typeof ExtractedActionItemSchema>;
export type ExtractedDeliverable = z.infer<typeof ExtractedDeliverableSchema>;
export type ChunkExtraction = z.infer<typeof ChunkExtractionSchema>;

export type RefinedDecision = z.infer<typeof RefinedDecisionSchema>;
export type RefinedActionItem = z.infer<typeof RefinedActionItemSchema>;
export type RefinedDeliverable = z.infer<typeof RefinedDeliverableSchema>;
export type RefinedMeeting = z.infer<typeof RefinedMeetingSchema>;

export type PRDRequirement = z.infer<typeof PRDRequirementSchema>;
export type PRD = z.infer<typeof PRDSchema>;

export type EditedMeetingNotes = z.infer<typeof EditedMeetingNotesSchema>;
export type FinalOutput = z.infer<typeof FinalOutputSchema>;
