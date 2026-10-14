import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ERROR_CODES } from '@tirapro/types';
import type { AiFallbackReason } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AiQuotaService } from './ai-quota.service';

interface AiConfig {
  enabled: boolean;
  anthropicApiKey: string;
  modelPrimary: string;
  modelFast: string;
}

/** Thời gian chờ tối đa cho MỖI lần gọi Claude (ms). SDK thử lại tối đa 1 lần → worst case ~60s. */
export const CLAUDE_TIMEOUT_MS = 30_000;
export const CLAUDE_MAX_RETRIES = 1;

/** Ngữ cảnh ghi `AiGenerationLog` + kiểm hạn mức cho mỗi lần gọi. */
export interface AiCallContext {
  workspaceId: string;
  userId?: string | null;
  /** Tên tính năng để thống kê: 'generate-issues' | 'summarize' | 'suggest' … */
  feature: string;
}

/**
 * Kết quả một lời gọi. `data = null` nghĩa là caller phải rơi về heuristic;
 * `reason` cho biết vì sao (chỉ có khi AI đã bật mà lời gọi hỏng).
 */
export interface ClaudeOutcome<T> {
  data: T | null;
  reason?: AiFallbackReason;
}

/** Structured outputs yêu cầu mọi object có `additionalProperties: false` — thêm đệ quy nếu thiếu. */
export function withStrictObjects(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
    if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

/**
 * Bọc Anthropic SDK với degrade gracefully: thiếu ANTHROPIC_API_KEY (hoặc AI tắt)
 * → client = null, mọi lời gọi trả `data: null` để caller rơi về heuristic.
 *
 * Lỗi SDK:
 *  - AuthenticationError → 500 `AI_MISCONFIGURED` (khóa sai là lỗi cấu hình, không phải lỗi người dùng)
 *  - RateLimitError      → 503 `AI_RATE_LIMITED`
 *  - Quá thời gian chờ   → heuristic + `reason: 'timeout'`
 *  - Lỗi khác            → heuristic + `reason: 'error'`
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  readonly modelPrimary: string;
  readonly modelFast: string;

  constructor(
    config: ConfigService,
    private readonly settings: SystemSettingsService,
    private readonly prisma: PrismaService,
    private readonly quota: AiQuotaService,
  ) {
    // Default model nằm ở một chỗ duy nhất: env.validation.ts → configuration.ts.
    const ai = config.getOrThrow<AiConfig>('ai');
    this.modelPrimary = ai.modelPrimary;
    this.modelFast = ai.modelFast;
    const key = ai.anthropicApiKey?.trim();
    this.client = ai.enabled && key
      ? new Anthropic({ apiKey: key, timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES })
      : null;
    if (!this.client) {
      this.logger.warn('Claude chưa cấu hình (thiếu ANTHROPIC_API_KEY hoặc AI tắt) → dùng heuristic.');
    }
  }

  /** Khả dụng khi có client VÀ admin không bật kill-switch AI (degrade về heuristic khi tắt). */
  available(): boolean {
    return this.client !== null && !this.settings.flags().aiKillSwitch;
  }

  /**
   * Trích xuất có cấu trúc qua structured outputs (`output_config.format`) —
   * model hiện tại (Opus 4.8+/Sonnet 5.5) từ chối forced `tool_choice`, còn structured outputs
   * đảm bảo JSON đúng schema trên mọi model (kể cả Haiku 4.5).
   */
  async extract<T>(opts: {
    ctx: AiCallContext;
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    model?: string;
    maxTokens?: number;
  }): Promise<ClaudeOutcome<T>> {
    const text = await this.call(opts.ctx, {
      model: opts.model ?? this.modelPrimary,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
      output_config: { format: { type: 'json_schema', schema: withStrictObjects(opts.schema) } },
    });
    if (text.data === null) return { data: null, reason: text.reason };
    try {
      return { data: JSON.parse(text.data) as T };
    } catch {
      // Cụt do max_tokens hoặc bị từ chối → không parse được → heuristic.
      this.logger.warn('Claude extract trả JSON không hợp lệ (có thể bị cắt do max_tokens).');
      return { data: null, reason: 'error' };
    }
  }

  /** Sinh văn bản tự do. */
  async complete(opts: {
    ctx: AiCallContext;
    system: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<ClaudeOutcome<string>> {
    return this.call(opts.ctx, {
      model: opts.model ?? this.modelPrimary,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
    });
  }

  /** Một lời gọi Messages API: kiểm hạn mức → gọi → ghi log → trả text; ánh xạ lỗi SDK. */
  private async call(
    ctx: AiCallContext,
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<ClaudeOutcome<string>> {
    // Cả thiếu khóa lẫn kill-switch của admin đều degrade về heuristic, không gọi API.
    if (!this.client || !this.available()) return { data: null };
    await this.quota.assertWithinQuota(ctx.workspaceId);

    const started = Date.now();
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create(params);
    } catch (e) {
      return this.handleError(e);
    }

    await this.recordUsage(ctx, params.model, res, Date.now() - started);

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text ? { data: text } : { data: null, reason: 'error' };
  }

  private handleError(e: unknown): ClaudeOutcome<string> {
    // Thứ tự: cụ thể → chung (APIConnectionTimeoutError là con của APIConnectionError).
    if (e instanceof Anthropic.AuthenticationError) {
      this.logger.error(`Anthropic từ chối khóa API: ${e.message}`);
      throw new AppException(
        ERROR_CODES.AI_MISCONFIGURED,
        'Tính năng AI đang được cấu hình sai (khóa API không hợp lệ). Hãy báo quản trị viên kiểm tra lại ANTHROPIC_API_KEY.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (e instanceof Anthropic.RateLimitError) {
      this.logger.warn(`Anthropic giới hạn tốc độ: ${e.message}`);
      throw new AppException(
        ERROR_CODES.AI_RATE_LIMITED,
        'Dịch vụ AI đang quá tải. Hãy đợi một lát rồi thử lại.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      this.logger.warn(`Claude quá thời gian chờ (${CLAUDE_TIMEOUT_MS}ms) → dùng heuristic.`);
      return { data: null, reason: 'timeout' };
    }
    this.logger.warn(`Claude lỗi: ${(e as Error).message}`);
    return { data: null, reason: 'error' };
  }

  /** Ghi nhật ký dùng AI; lỗi ghi log không được làm hỏng response cho người dùng. */
  private async recordUsage(
    ctx: AiCallContext,
    model: string,
    res: Anthropic.Message,
    latencyMs: number,
  ): Promise<void> {
    try {
      await this.prisma.aiGenerationLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId ?? null,
          feature: ctx.feature,
          model,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? null,
          latencyMs,
          success: true,
          stopReason: res.stop_reason ?? null,
          // SDK gắn `_request_id` (non-enumerable) lên response nhưng chưa khai trong kiểu Message.
          requestId: (res as { _request_id?: string | null })._request_id ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Không ghi được AiGenerationLog: ${(err as Error).message}`);
    }
  }
}
