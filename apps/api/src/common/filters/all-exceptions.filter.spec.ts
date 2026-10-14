import { HttpException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter, INTERNAL_ERROR_MESSAGE } from './all-exceptions.filter';

// Lỗi 500 trong test sẽ in stack ra console — tắt cho gọn.
Logger.overrideLogger(false);

function run(exception: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json };
  const req = { id: 'req-123', method: 'GET', url: '/x' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  };
  new AllExceptionsFilter().catch(exception, host as never);
  return { status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prod: lỗi không phải HttpException → thông báo chung + requestId, không lộ message nội bộ', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { status, body } = run(new Error('relation "users" does not exist'));
    expect(status).toBe(500);
    expect(body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(body.error.requestId).toBe('req-123');
    expect(JSON.stringify(body)).not.toContain('relation');
  });

  it('dev: giữ message gốc để dễ debug', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { body } = run(new Error('boom'));
    expect(body.error.message).toBe('boom');
  });

  it('HttpException vẫn giữ nguyên message ở prod', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { status, body } = run(new HttpException('Không tìm thấy', 404));
    expect(status).toBe(404);
    expect(body.error.message).toBe('Không tìm thấy');
  });
});
