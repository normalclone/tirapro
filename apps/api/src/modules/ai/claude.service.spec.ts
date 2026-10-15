import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { ClaudeService, withStrictObjects } from './claude.service';

const CTX = { workspaceId: 'ws1', userId: 'u1', feature: 'summarize' };

function make(
  opts: { create?: ReturnType<typeof vi.fn>; killSwitch?: boolean; quotaError?: Error } = {},
) {
  const create = opts.create ?? vi.fn();
  const logCreate = vi.fn().mockResolvedValue({});
  const quota = {
    assertWithinQuota: vi
      .fn()
      .mockImplementation(() =>
        opts.quotaError ? Promise.reject(opts.quotaError) : Promise.resolve(),
      ),
  };
  const config = {
    getOrThrow: () => ({
      enabled: true,
      anthropicApiKey: 'sk-test',
      modelPrimary: 'primary-m',
      modelFast: 'fast-m',
    }),
  };
  const settings = { flags: () => ({ aiKillSwitch: !!opts.killSwitch }) };
  const prisma = { aiGenerationLog: { create: logCreate } };
  const svc = new ClaudeService(
    config as never,
    settings as never,
    prisma as never,
    quota as never,
  );
  // Thay client thật bằng mock (không có khóa/mạng trong test).
  (svc as unknown as { client: unknown }).client = { messages: { create } };
  return { svc, create, logCreate, quota };
}

const okMessage = (text: string) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
  stop_reason: 'end_turn',
});

describe('ClaudeService', () => {
  it('complete: gọi model được truyền vào, ghi AiGenerationLog sau khi thành công', async () => {
    const { svc, create, logCreate } = make({
      create: vi.fn().mockResolvedValue(okMessage(' xin chào ')),
    });
    const out = await svc.complete({ ctx: CTX, model: svc.modelFast, system: 's', prompt: 'p' });
    expect(out).toEqual({ data: 'xin chào' });
    expect(create.mock.calls[0]![0].model).toBe('fast-m');
    const data = logCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      userId: 'u1',
      feature: 'summarize',
      model: 'fast-m',
      inputTokens: 10,
      outputTokens: 5,
      success: true,
    });
  });

  it('extract: dùng output_config.format (không ép tool_choice), parse JSON', async () => {
    const { svc, create } = make({ create: vi.fn().mockResolvedValue(okMessage('{"a":1}')) });
    const out = await svc.extract<{ a: number }>({
      ctx: CTX,
      system: 's',
      prompt: 'p',
      schema: { type: 'object', properties: { a: { type: 'number' } } },
    });
    expect(out.data).toEqual({ a: 1 });
    const params = create.mock.calls[0]![0];
    expect(params.tool_choice).toBeUndefined();
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema.additionalProperties).toBe(false);
  });

  it('extract: JSON hỏng (cụt) → data null, reason error', async () => {
    const { svc } = make({ create: vi.fn().mockResolvedValue(okMessage('{"a":')) });
    expect(
      await svc.extract({ ctx: CTX, system: 's', prompt: 'p', schema: { type: 'object' } }),
    ).toEqual({
      data: null,
      reason: 'error',
    });
  });

  it('quá thời gian chờ → heuristic kèm reason timeout, không ghi log', async () => {
    const { svc, logCreate } = make({
      create: vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError()),
    });
    expect(await svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).toEqual({
      data: null,
      reason: 'timeout',
    });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('AuthenticationError → 500 AI_MISCONFIGURED', async () => {
    const err = new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
    const { svc } = make({ create: vi.fn().mockRejectedValue(err) });
    await expect(svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'AI_MISCONFIGURED',
      status: 500,
    });
  });

  it('RateLimitError → 503 AI_RATE_LIMITED', async () => {
    const err = new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
    const { svc } = make({ create: vi.fn().mockRejectedValue(err) });
    await expect(svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
      status: 503,
    });
  });

  it('hết hạn mức → ném BusinessRuleException trước khi gọi API', async () => {
    const { svc, create } = make({ quotaError: new BusinessRuleException('hết hạn mức') });
    await expect(svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('kill-switch bật → không gọi API, không kiểm quota, data null (heuristic)', async () => {
    const { svc, create, quota } = make({ killSwitch: true });
    expect(await svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).toEqual({ data: null });
    expect(create).not.toHaveBeenCalled();
    expect(quota.assertWithinQuota).not.toHaveBeenCalled();
  });

  it('lỗi ghi log không làm hỏng kết quả', async () => {
    const { svc, logCreate } = make({ create: vi.fn().mockResolvedValue(okMessage('ok')) });
    logCreate.mockRejectedValue(new Error('db down'));
    expect(await svc.complete({ ctx: CTX, system: 's', prompt: 'p' })).toEqual({ data: 'ok' });
  });
});

interface StrictShape {
  additionalProperties: boolean;
  properties: {
    xs: { items: { additionalProperties: boolean } };
    y: { additionalProperties: boolean };
  };
}

describe('withStrictObjects', () => {
  it('thêm additionalProperties:false cho object lồng nhau, giữ nguyên nếu đã khai', () => {
    const out = withStrictObjects({
      type: 'object',
      properties: {
        xs: { type: 'array', items: { type: 'object', properties: {} } },
        y: { type: 'object', additionalProperties: true },
      },
    }) as unknown as StrictShape;
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.xs.items.additionalProperties).toBe(false);
    expect(out.properties.y.additionalProperties).toBe(true);
  });
});
