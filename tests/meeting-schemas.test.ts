import { describe, it, expect } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
	ExtractedDecisionSchema,
	ExtractedActionItemSchema,
	ExtractedDeliverableSchema,
	ChunkExtractionSchema,
	RefinedDecisionSchema,
	RefinedActionItemSchema,
	RefinedDeliverableSchema,
	RefinedMeetingSchema,
	PRDSchema,
	EditedMeetingNotesSchema,
	FinalOutputSchema,
} from "../src/meeting-schemas";

type JsonSchemaObject = {
	type?: string;
	properties?: Record<string, JsonSchemaObject>;
	required?: string[];
	items?: JsonSchemaObject;
	anyOf?: JsonSchemaObject[];
};

function getAllPropertyNames(schema: JsonSchemaObject): string[] {
	if (!schema.properties) return [];
	return Object.keys(schema.properties);
}

function validateOpenAIStructuredOutputCompatibility(
	schema: JsonSchemaObject,
	path = "root"
): string[] {
	const errors: string[] = [];

	if (schema.type === "object" && schema.properties) {
		const propertyNames = getAllPropertyNames(schema);
		const requiredProps = schema.required || [];

		for (const prop of propertyNames) {
			if (!requiredProps.includes(prop)) {
				errors.push(`${path}.${prop} is not in required array`);
			}

			const propSchema = schema.properties[prop];
			if (propSchema) {
				errors.push(
					...validateOpenAIStructuredOutputCompatibility(propSchema, `${path}.${prop}`)
				);
			}
		}
	}

	if (schema.items) {
		errors.push(
			...validateOpenAIStructuredOutputCompatibility(schema.items, `${path}[]`)
		);
	}

	if (schema.anyOf) {
		for (let i = 0; i < schema.anyOf.length; i++) {
			errors.push(
				...validateOpenAIStructuredOutputCompatibility(
					schema.anyOf[i],
					`${path}.anyOf[${i}]`
				)
			);
		}
	}

	return errors;
}

describe("Meeting Schemas - OpenAI Structured Output Compatibility", () => {
	describe("ExtractedDecisionSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(ExtractedDecisionSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse decision with null madeBy", () => {
			const result = ExtractedDecisionSchema.safeParse({
				decision: "Use React",
				madeBy: null,
				quote: "Let's use React",
			});
			expect(result.success).toBe(true);
		});

		it("should parse decision with madeBy value", () => {
			const result = ExtractedDecisionSchema.safeParse({
				decision: "Use React",
				madeBy: "Sarah",
				quote: "Let's use React",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("ExtractedActionItemSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(ExtractedActionItemSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse action item with null optional fields", () => {
			const result = ExtractedActionItemSchema.safeParse({
				task: "Create wireframes",
				owner: null,
				deadline: null,
				quote: "Can you create wireframes?",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("ExtractedDeliverableSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(ExtractedDeliverableSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse deliverable with null timeline", () => {
			const result = ExtractedDeliverableSchema.safeParse({
				name: "Dashboard",
				description: "New dashboard feature",
				timeline: null,
				quote: "We need a new dashboard",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("ChunkExtractionSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(ChunkExtractionSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});
	});

	describe("RefinedDecisionSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(RefinedDecisionSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null madeBy and rationale", () => {
			const result = RefinedDecisionSchema.safeParse({
				id: "D1",
				decision: "Use React",
				madeBy: null,
				rationale: null,
				quote: "Let's use React",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("RefinedActionItemSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(RefinedActionItemSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null optional fields", () => {
			const result = RefinedActionItemSchema.safeParse({
				id: "A1",
				task: "Create wireframes",
				owner: null,
				deadline: null,
				priority: null,
				quote: "We need wireframes",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("RefinedDeliverableSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(RefinedDeliverableSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null timeline and owner", () => {
			const result = RefinedDeliverableSchema.safeParse({
				id: "DEL1",
				name: "Dashboard",
				description: "New dashboard",
				timeline: null,
				owner: null,
				quote: "We need a dashboard",
			});
			expect(result.success).toBe(true);
		});
	});

	describe("RefinedMeetingSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(RefinedMeetingSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});
	});

	describe("PRDSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(PRDSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null timeline", () => {
			const result = PRDSchema.safeParse({
				featureName: "Dashboard",
				overview: "A new dashboard",
				requirements: [],
				timeline: null,
				dependencies: [],
				openQuestions: [],
			});
			expect(result.success).toBe(true);
		});
	});

	describe("EditedMeetingNotesSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(EditedMeetingNotesSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null date", () => {
			const result = EditedMeetingNotesSchema.safeParse({
				title: "Team Meeting",
				date: null,
				attendees: ["Alice", "Bob"],
				summary: "Discussed project plans",
				decisions: [],
				actionItems: [],
				openQuestions: [],
			});
			expect(result.success).toBe(true);
		});
	});

	describe("FinalOutputSchema", () => {
		it("should have all properties in required array", () => {
			const jsonSchema = zodToJsonSchema(FinalOutputSchema) as JsonSchemaObject;
			const errors = validateOpenAIStructuredOutputCompatibility(jsonSchema);
			expect(errors).toEqual([]);
		});

		it("should parse with null prd", () => {
			const result = FinalOutputSchema.safeParse({
				notes: {
					title: "Team Meeting",
					date: null,
					attendees: ["Alice"],
					summary: "Discussed plans",
					decisions: [],
					actionItems: [],
					openQuestions: [],
				},
				prd: null,
			});
			expect(result.success).toBe(true);
		});
	});
});

describe("Meeting Schemas - Null handling in consuming code", () => {
	it("should treat null madeBy as falsy for conditional rendering", () => {
		const decision = {
			decision: "Use React",
			madeBy: null as string | null,
			quote: "Let's use React",
		};

		const parts: string[] = [];
		if (decision.madeBy) parts.push(`Made by: ${decision.madeBy}`);

		expect(parts).toEqual([]);
	});

	it("should handle null with || fallback pattern", () => {
		const actionItem = {
			task: "Create wireframes",
			owner: null as string | null,
			priority: null as string | null,
		};

		const owner = actionItem.owner || "TBD";
		const priority = actionItem.priority || "medium";

		expect(owner).toBe("TBD");
		expect(priority).toBe("medium");
	});

	it("should handle null with ternary for array creation", () => {
		const decision = {
			decision: "Use React",
			madeBy: null as string | null,
		};

		const participants = decision.madeBy ? [decision.madeBy] : [];
		expect(participants).toEqual([]);
	});
});
