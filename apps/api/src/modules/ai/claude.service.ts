import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SystemSettingsService } from '../system-settings/system-settings.service';

interface AiConfig {
  enabled: boolean;
  anthropicApiKey: string;
  modelPrimary: string;
  modelFast: string;
}

/**
 * Bọc Anthropic SDK với degrade gracefully: thiếu ANTHROPIC_API_KEY (hoặc AI tắt)
 * → client = null, mọi lời gọi trả null để caller rơi về heuristic.
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  readonly modelPrimary: string;
  readonly modelFast: string;

  constructor(config: ConfigService, private readonly settings: SystemSettingsService) {
    const ai = config.get<AiConfig>('ai');
    this.modelPrimary = ai?.modelPrimary || 'claude-opus-4-8';
    this.modelFast = ai?.modelFast || 'claude-haiku-4-5';
    const key = ai?.anthropicApiKey?.trim();
    this.client = ai?.enabled && key ? new Anthropic({ apiKey: key }) : null;
    if (!this.client) {
      this.logger.warn('Claude chưa cấu hình (thiếu ANTHROPIC_API_KEY hoặc AI tắt) → dùng heuristic.');
    }
  }

  /** Khả dụng khi có client VÀ admin không bật kill-switch AI (degrade về heuristic khi tắt). */
  available(): boolean {
    return this.client !== null && !this.settings.flags().aiKillSwitch;
  }

  /**
   * Trích xuất có cấu trúc qua forced tool-use (đáng tin hơn parse JSON tự do).
   * Trả null nếu không khả dụng hoặc gặp lỗi (caller degrade về heuristic).
   */
  async extract<T>(opts: {
    system: string;
    prompt: string;
    toolName: string;
    toolDescription: string;
    schema: Record<string, unknown>;
    model?: string;
    maxTokens?: number;
  }): Promise<T | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.messages.create({
        model: opts.model ?? this.modelPrimary,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system,
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: opts.toolName },
        messages: [{ role: 'user', content: opts.prompt }],
      });
      const block = res.content.find((b) => b.type === 'tool_use');
      return block && block.type === 'tool_use' ? (block.input as T) : null;
    } catch (e) {
      this.logger.warn(`Claude extract lỗi: ${(e as Error).message}`);
      return null;
    }
  }

  /** Sinh văn bản tự do. Trả null nếu không khả dụng hoặc lỗi. */
  async complete(opts: {
    system: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<string | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.messages.create({
        model: opts.model ?? this.modelPrimary,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return text || null;
    } catch (e) {
      this.logger.warn(`Claude complete lỗi: ${(e as Error).message}`);
      return null;
    }
  }
}
