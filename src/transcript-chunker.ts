import type {
  TranscriptChunk,
  ChunkerOptions,
  MeetingMetadata,
} from "./meeting-types.js";

const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP_SIZE = 200;

const SPEAKER_LINE_PATTERN = /^(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?([A-Z][a-zA-Z\s.'-]+):\s*/;

export class TranscriptChunker {
  private options: ChunkerOptions;

  constructor(options: Partial<ChunkerOptions> = {}) {
    this.options = {
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      overlapSize: options.overlapSize ?? DEFAULT_OVERLAP_SIZE,
      preserveSpeakerContext: options.preserveSpeakerContext ?? true,
    };
  }

  chunk(transcript: string): TranscriptChunk[] {
    const normalizedTranscript = this.normalizeTranscript(transcript);
    const tokens = this.estimateTokens(normalizedTranscript);

    if (tokens <= this.options.chunkSize) {
      return [this.createSingleChunk(normalizedTranscript)];
    }

    return this.splitIntoChunks(normalizedTranscript);
  }

  extractMetadata(transcript: string): MeetingMetadata {
    const speakers = this.extractSpeakers(transcript);
    const date = this.extractDate(transcript);
    const title = this.extractTitle(transcript);

    return {
      title,
      date,
      attendees: speakers,
      source: "transcript",
    };
  }

  private normalizeTranscript(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private createSingleChunk(text: string): TranscriptChunk {
    return {
      index: 0,
      content: text,
      startOffset: 0,
      endOffset: text.length,
      speakersPresent: this.extractSpeakers(text),
      hasOverlap: false,
    };
  }

  private splitIntoChunks(transcript: string): TranscriptChunk[] {
    const chunks: TranscriptChunk[] = [];
    const targetChunkLength = this.options.chunkSize * 4;
    const overlapLength = this.options.overlapSize * 4;

    let currentPosition = 0;
    let chunkIndex = 0;

    while (currentPosition < transcript.length) {
      const endPosition = Math.min(
        currentPosition + targetChunkLength,
        transcript.length
      );

      let chunkEnd = endPosition;

      if (endPosition < transcript.length) {
        chunkEnd = this.findOptimalBreakPoint(
          transcript,
          currentPosition,
          endPosition
        );
      }

      const chunkContent = transcript.slice(currentPosition, chunkEnd);

      let overlapContent: string | undefined;
      if (chunkEnd < transcript.length) {
        const overlapEnd = Math.min(chunkEnd + overlapLength, transcript.length);
        overlapContent = transcript.slice(chunkEnd, overlapEnd);
      }

      const speakersPresent = this.extractSpeakers(chunkContent);

      if (this.options.preserveSpeakerContext && chunkIndex > 0) {
        const lastSpeaker = this.findLastSpeakerBeforePosition(
          transcript,
          currentPosition
        );
        if (lastSpeaker && !speakersPresent.includes(lastSpeaker)) {
          speakersPresent.unshift(lastSpeaker);
        }
      }

      chunks.push({
        index: chunkIndex,
        content: chunkContent,
        startOffset: currentPosition,
        endOffset: chunkEnd,
        speakersPresent,
        hasOverlap: overlapContent !== undefined,
        overlapContent,
      });

      currentPosition = chunkEnd;
      chunkIndex++;
    }

    return chunks;
  }

  private findOptimalBreakPoint(
    text: string,
    start: number,
    targetEnd: number
  ): number {
    const searchWindow = Math.min(500, targetEnd - start);
    const searchStart = Math.max(start, targetEnd - searchWindow);
    const searchText = text.slice(searchStart, targetEnd);

    const speakerMatch = this.findLastSpeakerBreak(searchText);
    if (speakerMatch !== -1) {
      return searchStart + speakerMatch;
    }

    const paragraphBreak = searchText.lastIndexOf("\n\n");
    if (paragraphBreak !== -1) {
      return searchStart + paragraphBreak + 2;
    }

    const lineBreak = searchText.lastIndexOf("\n");
    if (lineBreak !== -1) {
      return searchStart + lineBreak + 1;
    }

    const sentenceEnders = [". ", "! ", "? "];
    let lastSentenceEnd = -1;
    for (const ender of sentenceEnders) {
      const pos = searchText.lastIndexOf(ender);
      if (pos > lastSentenceEnd) {
        lastSentenceEnd = pos;
      }
    }
    if (lastSentenceEnd !== -1) {
      return searchStart + lastSentenceEnd + 2;
    }

    return targetEnd;
  }

  private findLastSpeakerBreak(text: string): number {
    const lines = text.split("\n");
    let lastSpeakerIndex = -1;
    let currentOffset = 0;

    for (const line of lines) {
      if (SPEAKER_LINE_PATTERN.test(line)) {
        lastSpeakerIndex = currentOffset;
      }
      currentOffset += line.length + 1;
    }

    return lastSpeakerIndex;
  }

  private findLastSpeakerBeforePosition(
    text: string,
    position: number
  ): string | null {
    const searchStart = Math.max(0, position - 5000);
    const textBefore = text.slice(searchStart, position);
    const lines = textBefore.split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(SPEAKER_LINE_PATTERN);
      if (match && this.isValidSpeakerName(match[1].trim())) {
        return match[1].trim();
      }
    }

    return null;
  }

  private extractSpeakers(text: string): string[] {
    const speakers = new Set<string>();
    const lines = text.split("\n");

    for (const line of lines) {
      const match = line.match(SPEAKER_LINE_PATTERN);
      if (match) {
        const speaker = match[1].trim();
        if (this.isValidSpeakerName(speaker)) {
          speakers.add(speaker);
        }
      }
    }

    return [...speakers];
  }

  private isValidSpeakerName(name: string): boolean {
    if (name.length < 2 || name.length > 50) return false;

    const invalidPatterns = [
      /^(the|a|an|this|that|it|he|she|they|we|you|i)$/i,
      /^(okay|ok|yes|no|yeah|nope|sure|well|so|but|and|or)$/i,
      /^\d+$/,
      /^[A-Z]{1}$/,
    ];

    return !invalidPatterns.some((pattern) => pattern.test(name));
  }

  private extractDate(text: string): string | undefined {
    const datePatterns = [
      /(?:meeting\s+(?:on|date|held))?\s*(\d{4}-\d{2}-\d{2})/i,
      /(?:meeting\s+(?:on|date|held))?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
      /(?:meeting\s+(?:on|date|held))?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractTitle(text: string): string | undefined {
    const firstLines = text.slice(0, 500);

    const titlePatterns = [
      /^#\s*(.+)$/m,
      /^(?:meeting|call|discussion):\s*(.+)$/im,
      /^(?:subject|topic|re):\s*(.+)$/im,
    ];

    for (const pattern of titlePatterns) {
      const match = firstLines.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  getChunkCount(transcript: string): number {
    const tokens = this.estimateTokens(transcript);
    if (tokens <= this.options.chunkSize) return 1;

    const effectiveOverlap = Math.min(this.options.overlapSize, this.options.chunkSize / 2);
    const step = this.options.chunkSize - effectiveOverlap;
    return Math.ceil(tokens / step);
  }

  getOptions(): ChunkerOptions {
    return { ...this.options };
  }
}

export function createChunker(options?: Partial<ChunkerOptions>): TranscriptChunker {
  return new TranscriptChunker(options);
}
