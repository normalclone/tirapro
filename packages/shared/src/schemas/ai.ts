import { z } from 'zod';

/** NL → danh sách issue đề xuất (preview, KHÔNG tự persist). */
export const generateIssuesSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(3, 'Mô tả quá ngắn').max(10_000),
});

export type GenerateIssuesInput = z.infer<typeof generateIssuesSchema>;

/** Một issue do AI đề xuất (hoặc heuristic) — client review rồi mới tạo thật. */
export interface AiGeneratedIssue {
  summary: string;
  type?: string;
  description?: string;
  acceptanceCriteria?: string[];
  storyPoints?: number;
  priority?: string;
}

export interface AiGenerateIssuesResult {
  source: 'claude' | 'heuristic';
  issues: AiGeneratedIssue[];
}

export interface AiSummaryResult {
  source: 'claude' | 'heuristic';
  summary: string;
}

export interface AiSuggestResult {
  source: 'claude' | 'heuristic';
  priority?: string;
  storyPoints?: number;
  assigneeHint?: string;
  rationale: string;
}

export interface AiCapabilities {
  available: boolean;
  mode: 'claude' | 'heuristic';
  model: string;
  features: string[];
}
