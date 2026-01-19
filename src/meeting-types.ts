export interface MeetingMetadata {
  title?: string;
  date?: string;
  attendees: string[];
  duration?: string;
  source?: string;
}

export interface TranscriptChunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
  speakersPresent: string[];
  hasOverlap: boolean;
  overlapContent?: string;
}

export interface DecisionFragment {
  text: string;
  speaker?: string;
  context: string;
  confidence: number;
}

export interface ActionItemFragment {
  text: string;
  owner?: string;
  dueDate?: string;
  priority?: "high" | "medium" | "low";
  context: string;
}

export interface DeliverableFragment {
  text: string;
  type: string;
  timeline?: string;
  owner?: string;
  dependencies: string[];
}

export interface ChunkResult {
  decisions: DecisionFragment[];
  actionItems: ActionItemFragment[];
  deliverables: DeliverableFragment[];
  keyPoints: string[];
  openQuestions: string[];
}

export interface IntermediateRepresentation {
  chunks: ChunkResult[];
  metadata: MeetingMetadata;
  rawChunkCount: number;
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  rationale?: string;
  participants: string[];
  relatedActionItems: string[];
}

export interface ActionItem {
  id: string;
  owner: string;
  task: string;
  dueDate?: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "completed";
  context?: string;
}

export interface Deliverable {
  id: string;
  name: string;
  description: string;
  type: string;
  timeline?: string;
  owner?: string;
  dependencies: string[];
  requirements: string[];
}

export interface RefinedMeeting {
  decisions: Decision[];
  actionItems: ActionItem[];
  deliverables: Deliverable[];
  summary: string;
  openQuestions: string[];
  keyDiscussionPoints: Array<{
    topic: string;
    summary: string;
  }>;
  metadata: MeetingMetadata;
}

export interface MeetingNotes {
  title: string;
  date?: string;
  attendees: string[];
  summary: string;
  decisions: Decision[];
  actionItems: ActionItem[];
  keyDiscussionPoints: Array<{
    topic: string;
    summary: string;
  }>;
  openQuestions: string[];
}

export interface PRDDocument {
  featureName: string;
  overview: string;
  requirements: Array<{
    id: string;
    requirement: string;
    priority: "must" | "should" | "could" | "wont";
    status: "open" | "in_progress" | "completed";
  }>;
  timeline?: {
    target?: string;
    milestones: string[];
  };
  dependencies: string[];
  openQuestions: string[];
}

export interface MeetingResources {
  notes: MeetingNotes;
  prd?: PRDDocument;
}

export interface FinalOutput {
  notes: MeetingNotes;
  prd?: PRDDocument;
  markdown: string;
  json: string;
}

export interface ProcessedMeeting {
  output: FinalOutput;
  metadata: MeetingMetadata;
  stats: ProcessingStats;
}

export interface ProcessingStats {
  totalChunks: number;
  refinementPasses: number;
  totalTokensUsed?: number;
  processingTimeMs: number;
  decisionsFound: number;
  actionItemsFound: number;
  deliverablesFound: number;
  prdGenerated: boolean;
}

export interface ChunkerOptions {
  chunkSize: number;
  overlapSize: number;
  preserveSpeakerContext: boolean;
}

export interface MeetingProcessorOptions {
  chunkSize?: number;
  overlapSize?: number;
  maxRefinements?: number;
  generatePrd?: boolean;
  verbose?: boolean;
}
