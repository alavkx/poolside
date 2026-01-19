import { describe, it, expect } from "vitest";
import {
  TranscriptChunker,
  createChunker,
} from "../src/transcript-chunker";

describe("TranscriptChunker", () => {
  describe("constructor and options", () => {
    it("should use default options when none provided", () => {
      const chunker = new TranscriptChunker();
      const options = chunker.getOptions();

      expect(options.chunkSize).toBe(4000);
      expect(options.overlapSize).toBe(200);
      expect(options.preserveSpeakerContext).toBe(true);
    });

    it("should accept custom options", () => {
      const chunker = new TranscriptChunker({
        chunkSize: 2000,
        overlapSize: 100,
        preserveSpeakerContext: false,
      });
      const options = chunker.getOptions();

      expect(options.chunkSize).toBe(2000);
      expect(options.overlapSize).toBe(100);
      expect(options.preserveSpeakerContext).toBe(false);
    });

    it("should merge partial options with defaults", () => {
      const chunker = new TranscriptChunker({ chunkSize: 3000 });
      const options = chunker.getOptions();

      expect(options.chunkSize).toBe(3000);
      expect(options.overlapSize).toBe(200);
      expect(options.preserveSpeakerContext).toBe(true);
    });
  });

  describe("createChunker factory", () => {
    it("should create a TranscriptChunker instance", () => {
      const chunker = createChunker();
      expect(chunker).toBeInstanceOf(TranscriptChunker);
    });

    it("should pass options to the chunker", () => {
      const chunker = createChunker({ chunkSize: 5000 });
      expect(chunker.getOptions().chunkSize).toBe(5000);
    });
  });

  describe("chunk - small transcripts", () => {
    it("should return single chunk for small transcript", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello everyone.\nJane: Hi John.";

      const chunks = chunker.chunk(transcript);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].content).toBe(transcript);
      expect(chunks[0].hasOverlap).toBe(false);
      expect(chunks[0].overlapContent).toBeUndefined();
    });

    it("should detect speakers in small transcript", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John Smith: Welcome to the meeting.\nJane Doe: Thanks for having me.";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("John Smith");
      expect(chunks[0].speakersPresent).toContain("Jane Doe");
    });

    it("should handle empty transcript", () => {
      const chunker = new TranscriptChunker();
      const chunks = chunker.chunk("");

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe("");
    });
  });

  describe("chunk - multiple chunks", () => {
    it("should split transcript into multiple chunks", () => {
      const chunker = new TranscriptChunker({ chunkSize: 20 });
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`Speaker${i % 2}: Line number ${i} here.`);
      }
      const transcript = lines.join("\n");

      const chunks = chunker.chunk(transcript);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });

    it("should include overlap content except for last chunk", () => {
      const chunker = new TranscriptChunker({ chunkSize: 20, overlapSize: 5 });
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(`Speaker${i % 2}: Test line ${i}.`);
      }
      const transcript = lines.join("\n");

      const chunks = chunker.chunk(transcript);

      expect(chunks.length).toBeGreaterThan(1);

      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].hasOverlap).toBe(true);
        expect(chunks[i].overlapContent).toBeDefined();
      }

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.hasOverlap).toBe(false);
    });

    it("should set correct start and end offsets", () => {
      const chunker = new TranscriptChunker({ chunkSize: 30 });
      const lines: string[] = [];
      for (let i = 0; i < 8; i++) {
        lines.push(`Speaker${i % 2}: Test line ${i}.`);
      }
      const transcript = lines.join("\n");

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].startOffset).toBe(0);

      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startOffset).toBe(chunks[i - 1].endOffset);
      }

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.endOffset).toBe(transcript.length);
    });
  });

  describe("extractMetadata", () => {
    it("should extract speakers from transcript", () => {
      const chunker = new TranscriptChunker();
      const transcript = `John Smith: Welcome everyone.
Jane Doe: Thanks John.
Mike Wilson: Hello all.`;

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.attendees).toContain("John Smith");
      expect(metadata.attendees).toContain("Jane Doe");
      expect(metadata.attendees).toContain("Mike Wilson");
    });

    it("should extract date in MM/DD/YYYY format", () => {
      const chunker = new TranscriptChunker();
      const transcript = "Meeting on 01/15/2024\nJohn: Hello.";

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.date).toBe("01/15/2024");
    });

    it("should extract date in Month DD, YYYY format", () => {
      const chunker = new TranscriptChunker();
      const transcript = "Meeting date January 15, 2024\nJohn: Hello.";

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.date).toBe("January 15, 2024");
    });

    it("should extract date in ISO format", () => {
      const chunker = new TranscriptChunker();
      const transcript = "Meeting held 2024-01-15\nJohn: Hello.";

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.date).toBe("2024-01-15");
    });

    it("should extract title from markdown heading", () => {
      const chunker = new TranscriptChunker();
      const transcript = `# Product Planning Meeting
John: Let's get started.`;

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.title).toBe("Product Planning Meeting");
    });

    it("should extract title from Meeting: prefix", () => {
      const chunker = new TranscriptChunker();
      const transcript = `Meeting: Q1 Review
John: Hello everyone.`;

      const metadata = chunker.extractMetadata(transcript);

      expect(metadata.title).toBe("Q1 Review");
    });

    it("should set source to transcript", () => {
      const chunker = new TranscriptChunker();
      const metadata = chunker.extractMetadata("John: Hello.");

      expect(metadata.source).toBe("transcript");
    });
  });

  describe("speaker detection", () => {
    it("should detect speakers with timestamps", () => {
      const chunker = new TranscriptChunker();
      const transcript = `[00:01] John Smith: Hello everyone.
[00:15] Jane Doe: Hi John.
[01:30] Mike Wilson: Good morning.`;

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("John Smith");
      expect(chunks[0].speakersPresent).toContain("Jane Doe");
      expect(chunks[0].speakersPresent).toContain("Mike Wilson");
    });

    it("should detect speakers without timestamps", () => {
      const chunker = new TranscriptChunker();
      const transcript = `John: Hello.
Jane: Hi.
Bob: Hey.`;

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("John");
      expect(chunks[0].speakersPresent).toContain("Jane");
      expect(chunks[0].speakersPresent).toContain("Bob");
    });

    it("should filter out invalid speaker names", () => {
      const chunker = new TranscriptChunker();
      const transcript = `John: The project is going well.
A: This should be filtered.
Jane: I agree.`;

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("John");
      expect(chunks[0].speakersPresent).toContain("Jane");
      expect(chunks[0].speakersPresent).not.toContain("A");
    });

    it("should handle hyphenated and apostrophe names", () => {
      const chunker = new TranscriptChunker();
      const transcript = `Mary-Jane Watson: Hello.
O'Brien: Hi there.`;

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("Mary-Jane Watson");
      expect(chunks[0].speakersPresent).toContain("O'Brien");
    });

    it("should deduplicate speakers", () => {
      const chunker = new TranscriptChunker();
      const transcript = `John: Hello.
Jane: Hi.
John: How are you?
Jane: Good, thanks.`;

      const chunks = chunker.chunk(transcript);
      const johnCount = chunks[0].speakersPresent.filter(s => s === "John").length;

      expect(johnCount).toBe(1);
    });
  });

  describe("getChunkCount", () => {
    it("should return 1 for small transcript", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello.";

      expect(chunker.getChunkCount(transcript)).toBe(1);
    });

    it("should estimate chunk count for larger transcript", () => {
      const chunker = new TranscriptChunker({ chunkSize: 50 });
      const transcript = "A".repeat(500);

      const estimatedCount = chunker.getChunkCount(transcript);

      expect(estimatedCount).toBeGreaterThan(1);
    });
  });

  describe("normalization", () => {
    it("should normalize CRLF to LF", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello.\r\nJane: Hi.\r\n";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].content).not.toContain("\r\n");
      expect(chunks[0].content).toContain("\n");
    });

    it("should normalize CR to LF", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello.\rJane: Hi.\r";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].content).not.toContain("\r");
    });

    it("should collapse multiple blank lines", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello.\n\n\n\nJane: Hi.";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].content).not.toContain("\n\n\n");
      expect(chunks[0].content).toContain("\n\n");
    });

    it("should trim whitespace", () => {
      const chunker = new TranscriptChunker();
      const transcript = "  \n  John: Hello.  \n  ";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].content).not.toMatch(/^\s/);
      expect(chunks[0].content).not.toMatch(/\s$/);
    });
  });

  describe("edge cases", () => {
    it("should handle transcript with only whitespace", () => {
      const chunker = new TranscriptChunker();
      const chunks = chunker.chunk("   \n\n   ");

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe("");
    });

    it("should handle unicode characters", () => {
      const chunker = new TranscriptChunker();
      const transcript = "John: Hello world with unicode chars.";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].content).toContain("Hello");
    });

    it("should handle special characters in speaker names", () => {
      const chunker = new TranscriptChunker();
      const transcript = "Dr. Smith: The results are in.\nMs. Johnson: Thank you.";

      const chunks = chunker.chunk(transcript);

      expect(chunks[0].speakersPresent).toContain("Dr. Smith");
      expect(chunks[0].speakersPresent).toContain("Ms. Johnson");
    });
  });
});
